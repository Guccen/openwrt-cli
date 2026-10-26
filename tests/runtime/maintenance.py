"""仅在临时 QEMU 系统验证受限维护 RPC，不保存包含密钥的归档。"""

import base64
import hashlib
import io
import json
import os
import sys
import tarfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from simulation import REPORT, ssh
from configuration import Api, RpcFailure, committed, wait_http


def maintenance(api, method, args=None):
    return api.call("router.maintenance", method, args, timeout=30 if method == "backup" else 10)


def expect_rejected(api, method, reason, args=None):
    result = maintenance(api, method, args)
    if result.get("ok") is not False or result.get("error") != reason:
        raise AssertionError(f"维护操作 {method} 应被拒绝：{reason}")


def run(address):
    api = Api(address)
    api.login()
    other = Api(address)
    other.login()
    for name in ("backup", "reboot"):
        anonymous = Api(address)
        try:
            maintenance(anonymous, name, {"confirm": True} if name == "reboot" else {})
        except RpcFailure as error:
            if error.code not in (6, -32002):
                raise
        else:
            raise AssertionError("未登录用户不能执行系统维护")
    expect_rejected(api, "reboot", "confirmation_required", {"confirm": False})
    values = api.values("dhcp")
    section = next(name for name, value in values.items() if value.get(".type") == "dnsmasq")
    original = committed(address, "dhcp", section)
    api.set("dhcp", section, {"server": ["192.0.2.53"], "noresolv": "1"})
    # 另一个会话同样不能在暂存或未确认的配置期间备份/重启。
    for caller in (api, other):
        expect_rejected(caller, "backup", "configuration_busy")
        expect_rejected(caller, "reboot", "configuration_busy", {"confirm": True})
    api.apply(30)
    for caller in (api, other):
        expect_rejected(caller, "backup", "configuration_busy")
        expect_rejected(caller, "reboot", "configuration_busy", {"confirm": True})
    api.call("uci", "rollback")
    api.call("uci", "revert", {"config": "dhcp"})
    status = maintenance(api, "status")
    if status.get("configurationBusy") or status.get("operationBusy"):
        raise AssertionError("恢复后维护操作应重新可用")
    result = maintenance(api, "backup")
    if not result.get("ok"):
        raise AssertionError("标准系统备份生成失败")
    archive = base64.b64decode(result["data"], validate=True)
    if not 0 < len(archive) <= 131072 or len(archive) != result["size"]:
        raise AssertionError("系统备份长度不正确")
    if hashlib.sha256(archive).hexdigest() != result["sha256"]:
        raise AssertionError("系统备份校验失败")
    with tarfile.open(fileobj=io.BytesIO(archive), mode="r:gz") as backup:
        names = {item.name.lstrip("./") for item in backup.getmembers()}
        if not {"etc/config/network", "etc/config/dhcp", "etc/config/rpcd"} <= names:
            raise AssertionError("系统备份缺少必要配置")
    # 只记录体积和结果，不把含临时 SSH 密钥的归档、响应或内容上传。
    backup_size = len(archive)
    del result, archive
    leftover = ssh(address, "find /tmp -maxdepth 1 -name 'router-ui-backup.*'", capture_output=True).stdout.strip()
    if leftover:
        raise AssertionError("备份的临时私有文件未清理")
    before = ssh(address, "cat /proc/sys/kernel/random/boot_id", capture_output=True).stdout.strip()
    if maintenance(api, "reboot", {"confirm": True}).get("accepted") is not True:
        raise AssertionError("设备未接受重启")
    deadline = time.monotonic() + 180
    changed = False
    while time.monotonic() < deadline:
        time.sleep(1)
        try:
            after = ssh(address, "cat /proc/sys/kernel/random/boot_id", capture_output=True, timeout=3).stdout.strip()
            if after and after != before:
                changed = True
                break
        except Exception:
            pass
    if not changed:
        raise AssertionError("维护 RPC 没有完成真实重启")
    wait_http(address, 60)
    try:
        api.call("system", "info")
    except RpcFailure as error:
        if error.code not in (6, -32001, -32002):
            raise
    else:
        raise AssertionError("重启后旧登录会话应失效")
    if committed(address, "dhcp", section) != original:
        raise AssertionError("维护操作不应修改原配置")
    report = {"anonymous_denied": "passed", "confirmation_required": "passed", "cross_session_staged_guard": "passed", "pending_apply_guard": "passed", "system_backup_sha256": "passed", "system_backup_size": backup_size, "private_files_cleaned": "passed", "reboot_boot_id_changed": "passed", "old_session_expired": "passed", "configuration_preserved": "passed"}
    (REPORT / "maintenance.json").write_text(json.dumps(report, indent=2) + "\n")
    print("受限维护 RPC、系统配置备份校验、真实重启及会话失效全部通过")


if __name__ == "__main__":
    run(os.environ["SIM_ADDRESS"])
