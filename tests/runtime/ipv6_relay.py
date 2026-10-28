"""真实 odhcpd DHCPv6 中继租约交换；仅使用一次性 QEMU 的第三网口。

报文格式与 Interface-ID 处理依据 OpenWrt odhcpd src/dhcpv6.c：
https://github.com/openwrt/odhcpd/blob/master/src/dhcpv6.c
本测试验证 DHCPv6 租约交换及 WAN 入站规则，不冒充 RA/NDP 连通性测试。
"""

import ipaddress
import json
import os
from pathlib import Path
import select
import secrets
import socket
import struct
import subprocess
import sys
import time

from configuration import RpcFailure
from simulation import IPV6_TAP, NAMESPACE, REPORT, BRIDGE, ssh


EXPECTED_ADDRESS = "2001:db8:100::44"
SERVER_DUID = bytes.fromhex("00030001020000000047")
CLIENT_DUID = bytes.fromhex("00030001020000000046")
IAID = bytes.fromhex("00000044")
RULE_NAME = "Router UI DHCPv6 relay"
CONFIGS = ("network", "dhcp", "firewall")


def option(code, payload):
    return struct.pack("!HH", code, len(payload)) + payload


def options(data):
    """严格解析完整 TLV，不能把截断报文误认成一次成功交换。"""
    result = {}
    offset = 0
    while offset < len(data):
        if len(data) - offset < 4:
            raise AssertionError("DHCPv6 option header truncated")
        code, size = struct.unpack_from("!HH", data, offset)
        offset += 4
        if not code or offset + size > len(data):
            raise AssertionError("DHCPv6 option payload truncated")
        result.setdefault(code, []).append(data[offset:offset + size])
        offset += size
    return result


def one(values, code):
    matches = values.get(code, [])
    if len(matches) != 1:
        raise AssertionError(f"Expected exactly one DHCPv6 option {code}")
    return matches[0]


def link_local(interface):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        result = subprocess.run(
            ["ip", "-j", "-6", "addr", "show", "dev", interface],
            capture_output=True, text=True, check=True, timeout=3,
        )
        for link in json.loads(result.stdout):
            for item in link.get("addr_info", []):
                flags = set(item.get("flags", []))
                if (item.get("family") == "inet6" and item.get("scope") == "link"
                        and not flags.intersection({"tentative", "dadfailed"})
                        and not item.get("tentative") and not item.get("dadfailed")):
                    return item["local"]
        time.sleep(0.2)
    raise AssertionError(f"No usable IPv6 link-local address on {interface}")


def udp_socket(interface, port):
    index = socket.if_nametoindex(interface)
    sock = socket.socket(socket.AF_INET6, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BINDTODEVICE, interface.encode() + b"\0")
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_MULTICAST_IF, index)
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_MULTICAST_HOPS, 1)
        sock.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_MULTICAST_LOOP, 0)
        sock.settimeout(0.5)
        sock.bind(("::", port))
        return sock, index
    except BaseException:
        sock.close()
        raise


def server_worker():
    """短时上游服务：仅接收中继封装，不直接与 LAN 客户端通信。"""
    link_local(IPV6_TAP)
    source = "2001:db8:100::1"
    with udp_socket(IPV6_TAP, 547)[0] as sock:
        index = socket.if_nametoindex(IPV6_TAP)
        for group in ("ff02::1:2", "ff05::1:3"):
            sock.setsockopt(
                socket.IPPROTO_IPV6, socket.IPV6_JOIN_GROUP,
                socket.inet_pton(socket.AF_INET6, group) + struct.pack("@I", index),
            )
        # 上游可能用全局地址回包，不能错误地把 WAN 入站规则限制为链路本地源。
        pktinfo = socket.inet_pton(socket.AF_INET6, source) + struct.pack("@I", index)
        print(json.dumps({"ready": True, "source": source, "pid": os.getpid()}), flush=True)
        replies = 0
        interface_id = None
        deadline = time.monotonic() + 40
        while time.monotonic() < deadline:
            if select.select([sys.stdin], [], [], 0)[0]:
                break
            try:
                packet, peer = sock.recvfrom(4096)
            except socket.timeout:
                continue
            if len(packet) < 34 or packet[0] != 12 or peer[1] != 547:
                continue
            outer = options(packet[34:])
            payload = one(outer, 9)
            if len(payload) < 4 or payload[0] != 1:
                continue
            inner = options(payload[4:])
            if inner.get(1) != [CLIENT_DUID]:
                continue
            interface_id = one(outer, 18)
            if len(interface_id) != 4 or one(inner, 14) != b"":
                raise AssertionError("Relay lost Interface-ID or Rapid Commit")
            request_ia = one(inner, 3)
            if len(request_ia) != 12 or request_ia[:4] != IAID:
                raise AssertionError("Relay changed the client's IA_NA")
            if not ipaddress.IPv6Address(packet[18:34]).is_link_local:
                raise AssertionError("Relay peer-address is not the LAN client's link-local")
            iaaddr = option(5, socket.inet_pton(socket.AF_INET6, EXPECTED_ADDRESS) + struct.pack("!II", 900, 1800))
            lease = option(3, IAID + struct.pack("!II", 300, 600) + iaaddr)
            response = b"\x07" + payload[1:4] + option(2, SERVER_DUID) + option(1, CLIENT_DUID) + lease + option(14, b"")
            # Interface-ID 是 odhcpd 的原生 ifindex 字节，必须原样回送，不能转端序。
            envelope = b"\x0d" + packet[1:34] + option(18, interface_id) + option(9, response)
            destination = (peer[0], 547, 0, index)
            sock.sendmsg([envelope], [(socket.IPPROTO_IPV6, socket.IPV6_PKTINFO, pktinfo)], 0, destination)
            replies += 1
        print(json.dumps({"replies": replies, "source": source, "interface_id": interface_id.hex() if interface_id else None}), flush=True)
        if not replies:
            raise AssertionError("Upstream received no DHCPv6 Relay-Forward")


def client_worker():
    source = link_local("eth0")
    with udp_socket("eth0", 546)[0] as sock:
        index = socket.if_nametoindex("eth0")
        transaction = secrets.token_bytes(3)
        solicit = b"\x01" + transaction + option(1, CLIENT_DUID) + option(3, IAID + bytes(8)) + option(14, b"")
        pktinfo = socket.inet_pton(socket.AF_INET6, source) + struct.pack("@I", index)
        deadline = time.monotonic() + 24
        next_send = 0
        while time.monotonic() < deadline:
            if time.monotonic() >= next_send:
                sock.sendmsg([solicit], [(socket.IPPROTO_IPV6, socket.IPV6_PKTINFO, pktinfo)], 0, ("ff02::1:2", 547, 0, index))
                next_send = time.monotonic() + 1
            try:
                packet, peer = sock.recvfrom(4096)
            except socket.timeout:
                continue
            if len(packet) < 4 or packet[:4] != b"\x07" + transaction or peer[1] != 547:
                continue
            reply = options(packet[4:])
            if reply.get(2) != [SERVER_DUID]:
                continue
            if one(reply, 1) != CLIENT_DUID or one(reply, 14) != b"":
                raise AssertionError("DHCPv6 reply lost client identity or Rapid Commit")
            ia = one(reply, 3)
            if len(ia) < 12 or ia[:4] != IAID:
                raise AssertionError("Unexpected IA_NA in DHCPv6 reply")
            address = one(options(ia[12:]), 5)
            if len(address) != 24:
                raise AssertionError("Unexpected IAADDR size")
            leased = socket.inet_ntop(socket.AF_INET6, address[:16])
            preferred, valid = struct.unpack("!II", address[16:])
            if leased != EXPECTED_ADDRESS or not 0 < preferred <= valid:
                raise AssertionError("DHCPv6 relay returned an unexpected address or lifetime")
            print(json.dumps({"address": leased, "server": peer[0], "rapid_commit": True}), flush=True)
            return
        raise AssertionError("LAN client received no relayed DHCPv6 lease within 24 seconds")


def firewall_packets(address):
    data = json.loads(ssh(address, "nft -j list chain inet fw4 input_wan", capture_output=True, timeout=5).stdout)
    matches = [entry["rule"] for entry in data.get("nftables", [])
               if entry.get("rule", {}).get("comment") == "!fw4: " + RULE_NAME]
    if len(matches) != 1:
        raise AssertionError("Managed DHCPv6 relay input rule is missing or duplicated")
    counters = [expr["counter"]["packets"] for expr in matches[0].get("expr", []) if "counter" in expr]
    if len(counters) != 1:
        raise AssertionError("Managed DHCPv6 relay rule has no observable packet counter")
    return counters[0]


def relay_listeners_ready(address):
    # 配置已提交不等于中继已监听；两个接口都须实际加入请求组。
    memberships = ssh(address, "cat /proc/net/igmp6", capture_output=True, timeout=5).stdout
    joined = {parts[1] for line in memberships.splitlines()
              if len(parts := line.split()) >= 3 and parts[2].lower() == "ff020000000000000000000000010002"}
    return {"br-lan", "eth2"}.issubset(joined)


def stage_section(api, config, name, section_type, values):
    existing = api.values(config).get(name)
    if existing:
        if existing.get(".type") != section_type:
            raise AssertionError(f"Unexpected pre-existing {config}.{name}")
        api.set(config, name, values)
    else:
        result = api.call("uci", "add", {"config": config, "name": name, "type": section_type, "values": values})
        if result.get("section") != name:
            raise AssertionError("Named UCI section creation failed")


def run_test(api, address):
    """调用方需提供已登录且没有待确认配置的 Api；所有 UCI 修改最终回滚。"""
    worker = None
    worker_pid = None
    applied = False
    host_rule = False
    firewall = ["ip6tables", "-I", "INPUT", "-i", IPV6_TAP, "-p", "udp", "--sport", "547", "--dport", "547", "-j", "ACCEPT"]
    try:
        global_section = next((name for name, value in api.values("dhcp").items() if value.get(".type") == "odhcpd"), None)
        if global_section:
            api.set("dhcp", global_section, {"loglevel": "7"})
        api.set("network", "wan6", {"proto": "static", "device": "eth2", "ip6addr": ["2001:db8:100::2/64"], "ip6gw": "2001:db8:100::1", "delegate": "0", "auto": "1"})
        for section, key in (("lan", "ip6assign"), ("wan6", "ip6prefix")):
            if key in api.values("network").get(section, {}):
                api.call("uci", "delete", {"config": "network", "section": section, "option": key})
        api.set("dhcp", "lan", {"ra": "relay", "dhcpv6": "relay", "ndp": "relay"})
        stage_section(api, "dhcp", "router_ui_ipv6_uplink", "dhcp", {"interface": "wan6", "master": "1", "ra": "relay", "dhcpv6": "relay", "ndp": "relay"})
        stage_section(api, "firewall", "router_ui_ipv6_relay", "rule", {"name": RULE_NAME, "src": "wan", "family": "ipv6", "proto": "udp", "src_port": "547", "dest_port": "547", "target": "ACCEPT", "enabled": "1"})
        applied = True
        api.apply(120)
        deadline = time.monotonic() + 25
        baseline = None
        while time.monotonic() < deadline:
            try:
                interfaces = api.call("network.interface", "dump")["interface"]
                wan6 = next(item for item in interfaces if item.get("interface") == "wan6")
                lan = next(item for item in interfaces if item.get("interface") == "lan")
                # 上一个静态 IPv6 用例也使用 eth2；必须等 netifd 实际撤回旧委派，
                # 避免把异步 rollback/apply 期间仍为 up 的旧接口当成中继就绪。
                if (wan6.get("up") and wan6.get("l3_device") == "eth2"
                        and wan6.get("delegation") is False and not wan6.get("ipv6-prefix")
                        and lan.get("up") and not lan.get("ipv6-prefix-assignment")
                        and relay_listeners_ready(address)):
                    baseline = firewall_packets(address)
                    break
            except (RpcFailure, OSError, subprocess.SubprocessError, AssertionError, StopIteration):
                pass
            time.sleep(0.5)
        if baseline is None:
            raise AssertionError("IPv6 relay uplink or managed firewall rule did not become ready")
        subprocess.run(["sudo", *firewall], check=True, capture_output=True, text=True, timeout=5)
        host_rule = True
        script = str(Path(__file__).resolve())
        worker = subprocess.Popen(["sudo", "-n", "python3", "-u", script, "--server"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if not select.select([worker.stdout], [], [], 12)[0]:
            raise AssertionError("DHCPv6 relay upstream worker did not become ready")
        ready_line = worker.stdout.readline()
        if not ready_line:
            _, errors = worker.communicate(timeout=2)
            raise AssertionError("DHCPv6 relay upstream worker failed: " + errors[-2000:])
        ready = json.loads(ready_line)
        if not ready.get("ready") or ready["source"] != "2001:db8:100::1":
            raise AssertionError("Upstream worker did not bind the test global source")
        worker_pid = ready["pid"]
        client = subprocess.run(["sudo", "-n", "ip", "netns", "exec", NAMESPACE, "python3", "-u", script, "--client"], capture_output=True, text=True, timeout=38)
        output, errors = worker.communicate("stop\n", timeout=5)
        hits = firewall_packets(address) - baseline
        (REPORT / "ipv6-relay-exchange.json").write_text(json.dumps({
            "clientCode": client.returncode, "clientOutput": client.stdout[-4096:],
            "clientError": client.stderr[-4096:], "serverCode": worker.returncode,
            "serverOutput": output[-4096:], "serverError": errors[-4096:],
            "firewallReplyPackets": hits,
        }, indent=2) + "\n")
        if client.returncode:
            raise AssertionError("DHCPv6 relay client failed: " + client.stderr[-2000:] + "; upstream: " + output[-1000:] + errors[-1000:] + f"; firewall reply packets: {hits}")
        lease = json.loads(client.stdout)
        if worker.returncode:
            raise AssertionError("DHCPv6 relay upstream failed: " + errors[-3000:])
        upstream = json.loads(output)
        if lease.get("address") != EXPECTED_ADDRESS or upstream.get("replies", 0) < 1:
            raise AssertionError("No complete DHCPv6 Relay-Forward/Reply exchange")
        if hits < 1:
            raise AssertionError("Relayed reply bypassed the managed WAN UDP547 input rule")
        return {"dhcpv6_relay_lease_exchange": "passed", "relay_wan_udp547_firewall": "passed", "relay_address": EXPECTED_ADDRESS, "relay_rule_packets": hits, "relay_upstream_source": upstream["source"]}
    finally:
        failure = sys.exc_info()[1]
        cleanup_errors = []
        if failure:
            try:
                detail = ssh(address, "uci -q show dhcp; ubus call network.interface dump; ip -6 addr show; cat /proc/net/udp6; cat /proc/net/igmp6; logread -e odhcpd | tail -n 100", capture_output=True, timeout=10)
                (REPORT / "ipv6-relay-device.log").write_text(detail.stdout[-65536:])
                bridge = subprocess.run(["sudo", "bridge", "mdb", "show", "dev", BRIDGE], capture_output=True, text=True, timeout=5)
                (REPORT / "ipv6-relay-bridge.log").write_text(bridge.stdout[-16384:] + bridge.stderr[-2048:])
            except (subprocess.SubprocessError, OSError):
                pass
        if worker and worker.poll() is None:
            try:
                worker.communicate("stop\n", timeout=3)
            except (subprocess.TimeoutExpired, ValueError, BrokenPipeError):
                try:
                    # sudo 可能保留监督进程，优先结束握手返回的实际 Python 子进程。
                    subprocess.run(["sudo", "-n", "kill", "-TERM", str(worker_pid or worker.pid)], check=False, capture_output=True, timeout=3)
                    worker.wait(timeout=3)
                except (subprocess.SubprocessError, OSError) as error:
                    cleanup_errors.append(str(error))
                    worker.kill()
                    try:
                        worker.wait(timeout=3)
                    except subprocess.SubprocessError as error:
                        cleanup_errors.append(str(error))
        if host_rule:
            firewall[1] = "-D"
            try:
                subprocess.run(["sudo", *firewall], check=True, capture_output=True, text=True, timeout=5)
            except (subprocess.SubprocessError, OSError) as error:
                cleanup_errors.append(str(error))
        try:
            if applied:
                api.call("uci", "rollback")
        except (RpcFailure, OSError) as error:
            cleanup_errors.append(str(error))
        for config in CONFIGS:
            try:
                api.call("uci", "revert", {"config": config})
            except (RpcFailure, OSError) as error:
                cleanup_errors.append(str(error))
        if cleanup_errors:
            message = "IPv6 relay cleanup failed: " + "; ".join(cleanup_errors)
            if failure:
                failure.add_note(message)
            else:
                raise AssertionError(message)


if __name__ == "__main__":
    if sys.argv[1:] == ["--server"]:
        server_worker()
    elif sys.argv[1:] == ["--client"]:
        client_worker()
    else:
        raise SystemExit("Use run_test(api, address), --server or --client")
