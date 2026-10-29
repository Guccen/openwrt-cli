"""QEMU 验证智能指示灯能力、访问控制、触发器配置与旧 cron 保留。"""
import json
import os

from configuration import Api, RpcFailure
from maintenance import expect_rejected, maintenance
from simulation import REPORT, ssh


def run(address):
    api = Api(address)
    api.login()
    for method in ("led_status", "led_save"):
        try:
            maintenance(Api(address), method, {"policy": "{}"})
        except RpcFailure as error:
            if error.code not in (6, -32002):
                raise
        else:
            raise AssertionError("未登录不能访问指示灯接口")
    snapshot = maintenance(api, "led_status")
    if (
        snapshot.get("ok") is not True
        or not isinstance(snapshot.get("leds"), list)
        or not isinstance(snapshot.get("networkDevices"), list)
    ):
        raise AssertionError("无法读取真实指示灯或网卡能力")
    original = snapshot["policy"]
    invalid = json.loads(json.dumps(original))
    invalid["enabled"] = True
    if invalid["leds"]:
        invalid["leds"][0]["id"] = "router-ui-nonexistent-fixture"
    else:
        invalid["leds"].append(
            {
                "id": "router-ui-nonexistent-fixture",
                "trigger": "netdev",
                "deviceName": "wan",
                "link": True,
                "rx": True,
                "tx": True,
                "interval": 50,
                "onMs": 250,
                "offMs": 250,
            }
        )
    expect_rejected(api, "led_save", "led_unsupported", {"policy": json.dumps(invalid)})
    section = next(name for name, value in api.values("dhcp").items() if value.get(".type") == "dnsmasq")
    api.set("dhcp", section, {"server": ["192.0.2.53"]})
    expect_rejected(api, "led_save", "configuration_busy", {"policy": json.dumps(original)})
    api.call("uci", "revert", {"config": "dhcp"})
    # 暂存并恢复已有 crontab，报告中不包含用户计划任务内容。
    cron = ssh(address, "cat /etc/crontabs/root 2>/dev/null || true", capture_output=True).stdout
    try:
        legacy = "* * * * * /usr/libexec/router-ui/led-state check >/dev/null 2>&1 # router-ui-led\n"
        ssh(address, "cat > /etc/crontabs/root", input=cron + legacy, capture_output=True)
        disabled = json.loads(json.dumps(original))
        disabled["enabled"] = False
        result = maintenance(api, "led_save", {"policy": json.dumps(disabled)})
        if result.get("ok") is not True:
            raise AssertionError(f"停用灯效失败：{result.get('error')}")
        after = ssh(address, "cat /etc/crontabs/root", capture_output=True).stdout
        if after != cron + legacy:
            raise AssertionError("指示灯配置意外修改了用户的 cron 任务")
        ssh(address, "test -L /etc/rc.d/S11router-ui-led-boot && test -L /etc/rc.d/S99router-ui-led", capture_output=True)
    finally:
        ssh(address, "cat > /etc/crontabs/root", input=cron, capture_output=True)
    report = {
        name: "passed"
        for name in (
            "anonymous_denied",
            "runtime_capabilities",
            "unknown_trigger_rejected",
            "staged_configuration_guard",
            "legacy_cron_preserved_for_manual_removal",
            "boot_hooks_installed",
        )
    }
    report["physical_led_count"] = len(snapshot["leds"])
    (REPORT / "led.json").write_text(json.dumps(report, indent=2) + "\n")
    print("指示灯权限、运行时能力、配置校验、旧 cron 保留及启动钩子通过；物理灯效仍需实机验收")


if __name__ == "__main__":
    run(os.environ["SIM_ADDRESS"])
