"""验证真实 APK 的只读状态接口、权限和租约来源；不伪造物理传感器。"""
import json
import os
import time

from configuration import Api, RpcFailure
from simulation import REPORT, ssh


def status(api, method):
    result = api.call("router.status", method)
    if result.get("ok") is not True:
        raise AssertionError("状态接口读取失败")
    return result


def run(address):
    api = Api(address)
    api.login()
    for method in ("summary", "clients", "wireless"):
        try:
            status(Api(address), method)
        except RpcFailure as error:
            if error.code not in (6, -32002): raise
        else:
            raise AssertionError("匿名会话不能读取设备与客户端状态")
    wireless = status(api, "wireless")
    if not isinstance(wireless.get("radios"), dict):
        raise AssertionError("无线状态格式不正确")
    summary = status(api, "summary")
    if len(summary.get("localTime", "")) != 19 or not isinstance(summary.get("temperatures"), list):
        raise AssertionError("系统时间或温度格式不正确")
    if {disk["path"] for disk in summary.get("storage", [])} != {"/", "/tmp"}:
        raise AssertionError("无法读取根目录和临时空间")
    if not any(port["name"] == "eth0" and port["link"] is True for port in summary.get("ports", [])):
        raise AssertionError("未读取到 QEMU 真实以太网连接")
    saved = ssh(address, "if [ -f /tmp/dhcp.leases ]; then printf '1\\n'; cat /tmp/dhcp.leases; else printf '0\\n'; fi", capture_output=True).stdout
    existed, original = saved.split("\n", 1)
    now = int(time.time())
    fixture = f"{now + 3600} 02:00:00:00:99:01 192.0.2.101 router-ui-fixture *\n{now - 60} 02:00:00:00:99:02 192.0.2.102 expired-fixture *\n0 02:00:00:00:99:03 192.0.2.103 * *\n"
    try:
        ssh(address, "cat > /tmp/dhcp.leases", input=fixture, capture_output=True)
        clients = status(api, "clients")
        if clients.get("ipv4Available") is not True or len(clients["ipv4"]) != 2:
            raise AssertionError("租约来源、过期过滤或永久租约读取错误")
        if clients["ipv4"][0]["hostname"] != "router-ui-fixture" or clients["ipv4"][1]["remaining"] is not None:
            raise AssertionError("租约主机名或剩余时间错误")
        if not isinstance(clients["ipv6Available"], bool): raise AssertionError("缺少 IPv6 可用性标记")
    finally:
        if existed == "1":
            ssh(address, "cat > /tmp/dhcp.leases", input=original, capture_output=True)
        else:
            ssh(address, "rm -f /tmp/dhcp.leases", capture_output=True)
    report = {key: "passed" for key in ("anonymous_denied", "system_time", "storage", "ethernet_link", "real_lease_file", "expired_lease_filtered", "permanent_lease", "ipv6_capability")}
    (REPORT / "status.json").write_text(json.dumps(report, indent=2) + "\n")
    print("只读系统状态、网口与租约来源验证通过；物理温度和速率仍需实机")


if __name__ == "__main__":
    run(os.environ["SIM_ADDRESS"])
