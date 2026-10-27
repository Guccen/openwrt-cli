"""在一次性真实 OpenWrt 虚拟机验证常用配置和数据通路；不连接真实运营商。"""
import json
import os
import subprocess
import time

from configuration import Api, RpcFailure, committed
from routing import wait_pool, dnsmasq_pids
from simulation import REPORT, WORK, NAMESPACE, run, ssh, test_network
from ipv6_relay import run_test as test_ipv6_relay


def wait_until(check, message, timeout=35):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            if check(): return
        except (subprocess.SubprocessError, OSError, RpcFailure):
            pass
        time.sleep(0.5)
    raise AssertionError(message)


def request_url(url, namespace=False):
    command = ["curl", "-g", "--noproxy", "*", "--fail", "--silent", "--insecure", "--max-time", "3", url]
    if namespace: command = ["sudo", "ip", "netns", "exec", NAMESPACE, *command]
    response = subprocess.run(command, capture_output=True, text=True, timeout=5)
    return response.returncode == 0 and response.stdout


def restore(api, configs):
    api.call("uci", "rollback")
    for config in configs: api.call("uci", "revert", {"config": config})


def main(address, role):
    api = Api(address); api.login()
    report = {}
    # 匿名调用不能发起网络请求或读取时间配置。
    for obj, method, args in [("router.diagnostics", "run", {"operation": "ping4", "target": "127.0.0.1"}), ("router.maintenance", "time_status", {})]:
        try: Api(address).call(obj, method, args)
        except RpcFailure as e:
            if e.code not in (6, -32002): raise
        else: raise AssertionError("匿名调用被意外放行")
    for target in ["-c100", "127.0.0.1;reboot", "a\nb"]:
        result = api.call("router.diagnostics", "run", {"operation": "ping4", "target": target})
        if result.get("ok") is not False: raise AssertionError("非法诊断参数被接受")
    for operation, target in [("ping4", "127.0.0.1"), ("ping6", "::1"), ("dns", "localhost"), ("logs", "")]:
        result = api.call("router.diagnostics", "run", {"operation": operation, "target": target})
        if not result.get("ok") or not result.get("success") or not result.get("output"):
            raise AssertionError(f"真实诊断失败：{operation}: {result}")
    report["diagnostics_native_commands"] = "passed"
    original_time = api.call("router.maintenance", "time_status")
    if not original_time.get("ok"): raise AssertionError(f"无法读取实际 UCI 时间设置：{original_time}")
    try:
        change = {**original_time["settings"], "zone": "Asia/Shanghai" if original_time["settings"]["zone"] != "Asia/Shanghai" else "UTC"}
        if not api.call("router.maintenance", "time_save", change).get("ok"): raise AssertionError("时间配置写入失败")
        actual = ssh(address, "uci -q get system.@system[0].zonename; if [ -f /tmp/TZ ]; then cat /tmp/TZ; else readlink /tmp/localtime; fi", capture_output=True).stdout
        if change["zone"] not in actual: raise AssertionError("时区未落盘")
        if change["zone"] == "Asia/Shanghai" and "CST-8" not in actual and "/usr/share/zoneinfo/Asia/Shanghai" not in actual: raise AssertionError("时区未重载到运行系统")
    finally:
        if not api.call("router.maintenance", "time_save", original_time["settings"]).get("ok"): raise AssertionError("原时区未恢复")
    # 原配置可能没有显式 zonename/timezone；验证语义与读取值恢复，原文件可包含新显式值。
    if api.call("router.maintenance", "time_status")["settings"] != original_time["settings"]: raise AssertionError("时间设置恢复不一致")
    report["time_uci_and_runtime_reload"] = "passed"

    if role != "router":
        report["router_data_paths"] = "not applicable to bypass"
        api.call("session", "destroy")
        (REPORT / "router-basics.json").write_text(json.dumps(report, indent=2) + "\n")
        return

    prefix = address.rsplit(".", 1)[0]
    link = json.loads(run("sudo", "ip", "-n", NAMESPACE, "-j", "link", "show", "eth0", capture_output=True).stdout)[0]
    reserved = prefix + ".20"
    old_pids = dnsmasq_pids(address)
    added = api.call("uci", "add", {"config": "dhcp", "name": "router_ci_host", "type": "host", "values": {"name": "router-ci-reserved", "mac": link["address"], "ip": reserved}})
    if added.get("section") != "router_ci_host": raise AssertionError("命名 UCI 新增返回值不一致")
    try:
        api.apply(120)
        wait_pool(address, prefix + ".100", prefix + ".249", old_pids)
        test_network(role, address, expected_pool=(reserved, reserved), report_name="dhcp-reservation")
        report["dhcp_reservation_actual_lease"] = "passed"
        # 固定页面服务运行于 LAN 客户端命名空间，WAN 侧宿主请求必须经过 QEMU 和真实 fw4 DNAT。
        directory = WORK / "lan-server"; directory.mkdir()
        (directory / "forward-marker").write_text("router-ci-forward-ok\n")
        log = (REPORT / "lan-server.log").open("w")
        process = subprocess.Popen(["sudo", "ip", "netns", "exec", NAMESPACE, "python3", "-m", "http.server", "18082", "--bind", reserved, "--directory", str(directory)], stdout=log, stderr=subprocess.STDOUT)
        try:
            api.call("uci", "confirm")
            api.call("uci", "add", {"config": "firewall", "name": "router_ci_redirect", "type": "redirect", "values": {"name": "CI DNAT", "src": "wan", "dest": "lan", "target": "DNAT", "family": "ipv4", "proto": "tcp", "src_dport": "18081", "dest_ip": reserved, "dest_port": "18082"}})
            api.apply(120)
            wait_until(lambda: request_url("http://127.0.0.1:18081/forward-marker") == "router-ci-forward-ok\n", "真实 WAN 到 LAN 端口转发失败")
            restore(api, ["firewall"])
            wait_until(lambda: not request_url("http://127.0.0.1:18081/forward-marker"), "删除端口转发后端口仍可用")
            report["wan_to_lan_dnat_and_rollback"] = "passed"
        finally:
            process.terminate()
            try: process.wait(timeout=5)
            except subprocess.TimeoutExpired: process.kill(); process.wait()
            log.close()
    finally:
        # 地址保留已确认，使用受限删除并再次确认清理；故障时保留原诊断数据。
        if api.values("dhcp").get("router_ci_host"):
            api.call("uci", "delete", {"config": "dhcp", "section": "router_ci_host"}); api.apply(120); api.call("uci", "confirm")
        api.call("uci", "revert", {"config": "dhcp"})

    # 使用独立第三个 WAN 口提供真实 IPv6 上游，验证静态 IPv6 + LAN SLAAC + 双栈管理。
    directory = WORK / "ipv6-server"; directory.mkdir()
    (directory / "ipv6-marker").write_text("router-ci-ipv6-ok\n")
    log = (REPORT / "ipv6-server.log").open("w")
    process = subprocess.Popen(["python3", "-m", "http.server", "18093", "--bind", "2001:db8:100::1", "--directory", str(directory)], stdout=log, stderr=subprocess.STDOUT)
    try:
        api.set("network", "wan6", {"proto": "static", "device": "eth2", "ip6addr": ["2001:db8:100::2/64"], "ip6gw": "2001:db8:100::1", "ip6prefix": ["2001:db8:200::/56"], "delegate": "1", "auto": "1"})
        api.set("network", "lan", {"ip6assign": "64"})
        api.set("dhcp", "lan", {"ra": "server", "dhcpv6": "server", "ra_slaac": "1", "ra_flags": ["managed-config", "other-config"]})
        api.apply(120)
        run("sudo", "ip", "netns", "exec", NAMESPACE, "sysctl", "-qw", "net.ipv6.conf.eth0.accept_ra=2", "net.ipv6.conf.eth0.autoconf=1")
        run("sudo", "ip", "-n", NAMESPACE, "link", "set", "eth0", "down")
        run("sudo", "ip", "-n", NAMESPACE, "link", "set", "eth0", "up")
        wait_until(lambda: request_url("http://[2001:db8:100::1]:18093/ipv6-marker", True) == "router-ci-ipv6-ok\n", "LAN 到上游 IPv6 的实际路由转发失败", 70)
        lan = next(item for item in api.call("network.interface", "dump")["interface"] if item["interface"] == "lan")
        assignment = next(p for p in lan.get("ipv6-prefix-assignment", []) if p["address"].startswith("2001:db8:200:"))
        management = assignment["local-address"]["address"]
        if not request_url(f"https://[{management}]/device.json", True): raise AssertionError("IPv6 HTTPS 管理页面不可达")
        report["static_ipv6_lan_slaac_forwarding"] = "passed"
        report["ipv6_https_management"] = "passed"
    finally:
        restore(api, ["network", "dhcp"])
        process.terminate()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.kill(); process.wait()
        log.close()
    report.update(test_ipv6_relay(api, address))
    report["isp_dhcpv6_pd_and_pppoe"] = "requires provider or dedicated fixture; not claimed by static routing or relay exchange tests"
    api.call("session", "destroy")
    (REPORT / "router-basics.json").write_text(json.dumps(report, indent=2) + "\n")
    print("诊断、时间设置、固定租约、WAN 入站转发与静态 IPv6 数据通路验证完成")


if __name__ == '__main__': main(os.environ['SIM_ADDRESS'], os.environ['SIM_ROLE'])
