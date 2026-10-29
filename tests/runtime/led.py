"""QEMU 验证指示灯权限、无硬件门禁、配置校验及不破坏已有 cron。"""
import json
import os

from configuration import Api, RpcFailure
from maintenance import expect_rejected, maintenance
from simulation import REPORT, ssh


def run(address):
    api = Api(address)
    api.login()
    for method in ("led_status", "led_save", "led_repair"):
        try:
            maintenance(Api(address), method, {"policy": "{}"})
        except RpcFailure as error:
            if error.code not in (6, -32002): raise
        else:
            raise AssertionError("未登录不能访问指示灯接口")
    snapshot = maintenance(api, "led_status")
    if snapshot.get("ok") is not True or not isinstance(snapshot.get("leds"), list):
        raise AssertionError("无法读取真实指示灯能力")
    original = snapshot["policy"]
    invalid = json.loads(json.dumps(original))
    invalid["targets"] = ["223.5.5.5; reboot"]
    expect_rejected(api, "led_save", "led_invalid", {"policy": json.dumps(invalid)})
    invalid = json.loads(json.dumps(original))
    invalid["enabled"] = True
    for item in invalid["states"].values(): item["led"] = "router-ui-nonexistent-fixture"
    expect_rejected(api, "led_save", "led_unsupported", {"policy": json.dumps(invalid)})
    section = next(name for name, value in api.values("dhcp").items() if value.get(".type") == "dnsmasq")
    api.set("dhcp", section, {"server": ["192.0.2.53"]})
    expect_rejected(api, "led_save", "configuration_busy", {"policy": json.dumps(original)})
    api.call("uci", "revert", {"config": "dhcp"})
    # 通过 stdin 保存现有 crontab，绝不把用户任务内容放入报告。
    cron = ssh(address, "cat /etc/crontabs/root 2>/dev/null || true", capture_output=True).stdout
    try:
        sentinel = "# router-ui-led-preserve-fixture\n"
        ssh(address, "cat > /etc/crontabs/root", input=cron + sentinel, capture_output=True)
        disabled = {**original, "enabled": False}
        result = maintenance(api, "led_save", {"policy": json.dumps(disabled)})
        if result.get("ok") is not True: raise AssertionError(f"停用灯效失败：{result.get('error')}")
        after = ssh(address, "cat /etc/crontabs/root", capture_output=True).stdout
        if after != cron + sentinel or "# router-ui-led\n" in after:
            raise AssertionError("指示灯配置破坏了其他计划任务")
        ssh(address, "test -L /etc/rc.d/S11router-ui-led-boot && test -L /etc/rc.d/S99router-ui-led", capture_output=True)
    finally:
        ssh(address, "cat > /etc/crontabs/root", input=cron, capture_output=True)
    report = {name: "passed" for name in ("anonymous_denied", "real_capabilities", "invalid_probe_rejected", "unknown_led_rejected", "staged_configuration_guard", "other_cron_preserved", "boot_hooks_installed")}
    report["physical_led_count"] = len(snapshot["leds"])
    (REPORT / "led.json").write_text(json.dumps(report, indent=2) + "\n")
    print("指示灯权限、配置校验、无硬件限制及计划任务保留通过；物理灯效仍需实机")


if __name__ == "__main__":
    run(os.environ["SIM_ADDRESS"])
