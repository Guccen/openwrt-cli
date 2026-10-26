"""在独立 QEMU 测试机验证 UCI 确认、恢复和失联后的自动回滚。"""

import argparse
import json
import os
import ssl
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))
from simulation import REPORT, ssh


class RpcFailure(AssertionError):
    def __init__(self, method, code):
        self.code = code
        super().__init__(f"{method} 请求失败，代码：{code}")


class Api:
    def __init__(self, address):
        self.address = address
        self.context = ssl._create_unverified_context()
        self.sid = "0" * 32

    def call(self, object_name, method, args=None, timeout=10):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "call", "params": [self.sid, object_name, method, args or {}]}).encode()
        request = urllib.request.Request(f"https://{self.address}/ubus", data=body, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(request, context=self.context, timeout=timeout) as response:
            result = json.load(response)
        if result.get("error") or result.get("result", [None])[0] != 0:
            raise RpcFailure(f"{object_name}.{method}", result.get("error", {}).get("code") or result.get("result", [None])[0])
        return result["result"][1] if len(result["result"]) > 1 else {}

    def login(self):
        self.sid = "0" * 32
        self.sid = self.call("session", "login", {"username": "root", "password": os.environ["SIM_PASSWORD"], "timeout": 300})["ubus_rpc_session"]

    def values(self, config):
        return self.call("uci", "get", {"config": config})["values"]

    def set(self, config, section, values):
        self.call("uci", "set", {"config": config, "section": section, "values": values})

    def apply(self, timeout):
        self.call("uci", "apply", {"rollback": True, "timeout": timeout})


def wait_http(address, timeout):
    deadline = time.monotonic() + timeout
    context = ssl._create_unverified_context()
    while time.monotonic() < deadline:
        try:
            with urllib.request.urlopen(f"https://{address}/device.json", context=context, timeout=1) as response:
                if response.status == 200:
                    return
        except (urllib.error.URLError, OSError, TimeoutError):
            pass
        time.sleep(0.4)
    raise AssertionError(f"管理地址 {address} 在 {timeout} 秒内未恢复连接")


def committed(address, config, section):
    # 使用独立 SSH 会话读取已提交配置，不把 rpcd 暂存差异误认为生效配置。
    result = ssh(address, f"uci -q show {config}.{section}", capture_output=True, timeout=10)
    return "\n".join(sorted(result.stdout.splitlines())) + "\n"


def run(address):
    api = Api(address)
    api.login()
    dns_values = api.values("dhcp")
    section = next(name for name, value in dns_values.items() if value.get(".type") == "dnsmasq")
    original_dns = committed(address, "dhcp", section)

    api.set("dhcp", section, {"server": ["192.0.2.53"], "noresolv": "1"})
    api.apply(15)
    if "192.0.2.53" not in committed(address, "dhcp", section):
        raise AssertionError("DNS 改动没有实际写入配置")
    api.call("uci", "rollback")
    api.call("uci", "revert", {"config": "dhcp"})
    if committed(address, "dhcp", section) != original_dns:
        raise AssertionError("手动恢复没有还原 DNS 配置")

    # 新版 rpcd 在应用期间重新登录会找回原会话。先创建另一会话，
    # 再开始应用，才能真正验证不同会话之间的确认权限。
    other = Api(address)
    other.login()
    if other.sid == api.sid:
        raise AssertionError("应用前登录应创建独立会话")
    api.set("dhcp", section, {"server": ["192.0.2.53"], "noresolv": "1"})
    api.apply(6)
    try:
        other.call("uci", "confirm")
    except RpcFailure as error:
        if error.code not in (6, -32002):
            raise
    else:
        raise AssertionError("另一个会话不应确认本次改动")
    other.call("session", "destroy")
    api.call("uci", "confirm")
    time.sleep(7)
    if "192.0.2.53" not in committed(address, "dhcp", section):
        raise AssertionError("确认后设置没有保留")
    # 恢复原有 DNS，再测试会话消失时仍然由设备负责回滚。
    for option in ("server", "noresolv"):
        if option in dns_values[section]:
            api.set("dhcp", section, {option: dns_values[section][option]})
        else:
            api.call("uci", "delete", {"config": "dhcp", "section": section, "option": option})
    api.apply(15)
    api.call("uci", "confirm")
    api.set("dhcp", section, {"server": ["192.0.2.53"], "noresolv": "1"})
    api.apply(4)
    api.call("session", "destroy")
    time.sleep(5)
    if committed(address, "dhcp", section) != original_dns:
        raise AssertionError("会话结束后未自动恢复 DNS")

    api.login()
    new_address = address.rsplit(".", 1)[0] + ".10"
    api.set("network", "lan", {"ipaddr": new_address})
    api.set("dhcp", section, {"server": ["192.0.2.53"], "noresolv": "1"})
    applied_at = time.monotonic()
    api.apply(30)
    wait_http(new_address, 20)
    if f"'{new_address}'" not in committed(new_address, "network", "lan"):
        raise AssertionError("新的 LAN 地址没有实际生效")
    if "192.0.2.53" not in committed(new_address, "dhcp", section):
        raise AssertionError("同次应用的 DNS 配置没有生效")
    # 不发送 confirm，也不依赖前端页面继续运行。
    time.sleep(max(0, applied_at + 32 - time.monotonic()))
    wait_http(address, 30)
    if f"'{address}'" not in committed(address, "network", "lan"):
        raise AssertionError("失联后 LAN 地址未自动恢复")
    if committed(address, "dhcp", section) != original_dns:
        raise AssertionError("多配置回滚没有同时恢复 DNS")
    api.call("uci", "revert", {"config": "network"})
    api.call("uci", "revert", {"config": "dhcp"})
    api.call("session", "destroy")
    (REPORT / "configuration.json").write_text(json.dumps({"dns_manual_rollback": "passed", "dns_confirm_persists": "passed", "cross_session_confirm_denied": "passed", "session_loss_rollback": "passed", "lan_new_address_reachable": "passed", "lan_timeout_rollback": "passed", "multi_config_rollback": "passed"}, indent=2) + "\n")
    print("Configuration apply, confirm and rollback tests passed")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--address", required=True)
    run(parser.parse_args().address)
