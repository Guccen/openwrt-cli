"""在一次性 QEMU 网络验证 WAN 静态上网、DHCP 新地址池与恢复。"""

import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from simulation import REPORT, ssh, test_network
from configuration import Api, committed


def wait_wan(api, protocol):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        values = api.call("network.interface", "dump")["interface"]
        if any(item.get("interface") == "wan" and item.get("proto") == protocol and item.get("up") and item.get("ipv4-address") for item in values):
            return
        time.sleep(0.5)
    raise AssertionError(f"WAN 没有恢复为 {protocol} 上网")


def dnsmasq_pids(address):
    return set(ssh(address, "pidof dnsmasq || true", capture_output=True, timeout=5).stdout.split())


def wait_pool(address, start, end, previous_pids):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        config = ssh(address, "grep -h '^dhcp-range=' /var/etc/dnsmasq.conf.* 2>/dev/null || true", capture_output=True, timeout=5).stdout
        current_pids = dnsmasq_pids(address)
        if f"{start},{end}," in config and current_pids and not current_pids.intersection(previous_pids):
            return
        time.sleep(0.5)
    raise AssertionError("dnsmasq 未完成重启或没有加载预期的 DHCP 地址池")


def run(address, role):
    if role == "bypass":
        (REPORT / "routing.json").write_text(json.dumps({"role": role, "wan_editor": "not applicable", "dhcp_server": "disabled by profile"}, indent=2) + "\n")
        return
    api = Api(address)
    api.login()
    network = api.values("network")
    original_wan = committed(address, "network", "wan")
    original_dhcp = committed(address, "dhcp", "lan")
    wait_wan(api, "dhcp")
    # 验证凭据仅暂存，未提交也不会出现在独立 SSH 读取的生效配置中。
    api.set("network", "wan", {"proto": "pppoe", "username": "ci-example", "password": "ci-not-an-isp-password"})
    if committed(address, "network", "wan") != original_wan:
        raise AssertionError("未应用的拨号凭据不应持久化")
    api.call("uci", "revert", {"config": "network"})
    api.set("network", "wan", {"proto": "static", "ipaddr": "10.0.2.15", "netmask": "255.255.255.0", "gateway": "10.0.2.2", "dns": ["10.0.2.3"], "peerdns": "0"})
    api.apply(120)
    wait_wan(api, "static")
    test_network(role, address, report_name="wan-static")
    api.call("uci", "rollback")
    api.call("uci", "revert", {"config": "network"})
    wait_wan(api, "dhcp")
    if committed(address, "network", "wan") != original_wan:
        raise AssertionError("静态 WAN 回滚后未恢复原有 DHCP 配置")
    api.set("dhcp", "lan", {"start": "50", "limit": "30", "leasetime": "5m"})
    previous_pids = dnsmasq_pids(address)
    api.apply(120)
    # 配置生成早于 procd 重启服务；必须同时等旧进程退出，否则仍可能取得旧租约。
    prefix = address.rsplit(".", 1)[0]
    wait_pool(address, prefix + ".50", prefix + ".79", previous_pids)
    test_network(role, address, expected_pool=(prefix + ".50", prefix + ".79"), report_name="dhcp-updated")
    previous_pids = dnsmasq_pids(address)
    api.call("uci", "rollback")
    api.call("uci", "revert", {"config": "dhcp"})
    if committed(address, "dhcp", "lan") != original_dhcp:
        raise AssertionError("DHCP 回滚改变了原地址池或 IPv6 设置")
    wait_pool(address, prefix + ".100", prefix + ".249", previous_pids)
    test_network(role, address, expected_pool=(prefix + ".100", prefix + ".249"), report_name="routing-restored")
    if api.values("network").get("wan6") != network.get("wan6"):
        raise AssertionError("IPv6 接口不应被 WAN IPv4 设置覆盖")
    api.call("session", "destroy")
    (REPORT / "routing.json").write_text(json.dumps({"role": role, "pppoe_staging_without_commit": "passed", "pppoe_isp_authentication": "not emulated", "wan_static_nat": "passed", "wan_dhcp_restored": "passed", "new_dhcp_pool_leased": "passed", "dhcp_pool_restored": "passed", "ipv6_configuration_preserved": "passed"}, indent=2) + "\n")
    print("WAN 静态 NAT、DHCP 新地址池和配置恢复全部通过；不模拟运营商 PPPoE 认证")


if __name__ == "__main__":
    run(os.environ["SIM_ADDRESS"], os.environ["SIM_ROLE"])
