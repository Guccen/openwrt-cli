"""在一次性 OpenWrt 验证定时重启落盘和权限；不执行任何重启计划。"""
import json
import os

from configuration import Api, RpcFailure
from maintenance import maintenance
from simulation import REPORT, ssh


def run(address):
    api = Api(address)
    api.login()
    for method in ("schedule_status", "schedule_save"):
        try:
            maintenance(Api(address), method, {"enabled": False, "time": "03:00", "days": list(range(7))})
        except RpcFailure as error:
            if error.code not in (6, -32002): raise
        else:
            raise AssertionError("匿名用户可以管理定时任务")
    snapshot = maintenance(api, "schedule_status")
    if not snapshot.get("ok") or snapshot["policy"]["enabled"]:
        raise AssertionError("新安装的定时重启应默认关闭")
    original = snapshot["policy"]
    cron = ssh(address, "cat /etc/crontabs/root 2>/dev/null || true", capture_output=True).stdout
    sentinel = "# router-ui-schedule-preserve-fixture\n"
    try:
        ssh(address, "cat > /etc/crontabs/root", input=cron + sentinel, capture_output=True)
        # 设置在设备当前时间十二小时之后，本测试只检查落盘，不触发 run。
        hour = int(ssh(address, "date +%H", capture_output=True).stdout.strip())
        policy = {"enabled": True, "time": f"{(hour + 12) % 24:02}:47", "days": [1, 3, 5]}
        result = maintenance(api, "schedule_save", policy)
        if not result.get("ok"):
            raise AssertionError("定时重启保存失败：" + str(result.get("error"))[:128])
        actual = maintenance(api, "schedule_status")
        if actual["policy"] != policy or not actual.get("cronRunning"):
            raise AssertionError("定时任务未落盘或 cron 未运行")
        installed = ssh(address, "cat /etc/crontabs/root", capture_output=True).stdout
        expected = f"47 {(hour + 12) % 24} * * 1,3,5 "
        if installed.count("# router-ui-scheduled-reboot") != 1 or expected not in installed or sentinel not in installed:
            raise AssertionError("定时任务 cron 内容不正确或覆盖其他任务")
        bad = maintenance(api, "schedule_save", {**policy, "time": "03:00;reboot"})
        if bad.get("ok") is not False:
            raise AssertionError("非法时间被接受")
        if maintenance(api, "schedule_status")["policy"] != policy:
            raise AssertionError("非法请求改变了已保存计划")
        section = next(name for name, value in api.values("dhcp").items() if value.get(".type") == "dnsmasq")
        api.set("dhcp", section, {"server": ["192.0.2.53"]})
        try:
            result = maintenance(api, "schedule_save", original)
            if result.get("error") != "configuration_busy":
                raise AssertionError("定时任务保存未阻止待确认网络配置")
        finally:
            api.call("uci", "revert", {"config": "dhcp"})
        if not maintenance(api, "schedule_save", original).get("ok"):
            raise AssertionError("停用定时任务失败")
        after = ssh(address, "cat /etc/crontabs/root", capture_output=True).stdout
        if after != cron + sentinel:
            raise AssertionError("停用定时任务破坏其他 cron 内容")
    finally:
        maintenance(api, "schedule_save", original)
        ssh(address, "cat > /etc/crontabs/root", input=cron, capture_output=True)
    report = {key: "passed" for key in ("anonymous_denied", "disabled_default", "native_cron_install", "other_jobs_preserved", "invalid_input_rejected", "configuration_guard", "disable_removes_owned_job")}
    (REPORT / "schedule.json").write_text(json.dumps(report, indent=2) + "\n")
    print("定时重启权限、配置、真实 cron 安装与停用通过；未触发计划重启")


if __name__ == "__main__":
    run(os.environ["SIM_ADDRESS"])
