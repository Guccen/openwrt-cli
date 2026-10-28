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
    return api.call("router.maintenance", method, args, timeout=30 if method in ("backup", "inspect", "restore", "upgrade") else 10)


def expect_rejected(api, method, reason, args=None):
    result = maintenance(api, method, args)
    if result.get("ok") is not False or result.get("error") != reason:
        raise AssertionError(f"维护操作 {method} 应被拒绝：{reason}")


def wait_reboot(address, api, before):
    deadline = time.monotonic() + 180
    while time.monotonic() < deadline:
        time.sleep(1)
        try:
            after = ssh(address, "cat /proc/sys/kernel/random/boot_id", capture_output=True, timeout=3).stdout.strip()
            if after and after != before:
                break
        except Exception:
            pass
    else:
        raise AssertionError("维护 RPC 没有完成真实重启")
    wait_http(address, 60)
    try:
        api.call("system", "info")
    except RpcFailure as error:
        if error.code not in (6, -32001, -32002):
            raise
    else:
        raise AssertionError("重启后旧登录会话应失效")


def run(address):
    api = Api(address)
    api.login()
    other = Api(address)
    other.login()
    for name in ("backup", "reboot", "upload_start", "upload_chunk", "upload_cancel", "inspect", "restore", "upgrade", "reset"):
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
    # 实际 rpcd 上传协议及解析器：错误顺序、令牌、摘要、身份和路径均不得写入系统。
    def upload(data, digest=None):
        response = maintenance(api, "upload_start", {"kind": "restore", "size": len(data), "sha256": digest or hashlib.sha256(data).hexdigest()})
        if not response.get("ok"):
            raise AssertionError(f"归档上传初始化失败：{response.get('error')}")
        token = response["token"]
        expect_rejected(api, "upload_chunk", "invalid_token", {"token": "0" * 32, "offset": 0, "data": "eA=="})
        expect_rejected(api, "upload_chunk", "invalid_upload", {"token": token, "offset": 1, "data": "eA=="})
        for offset in range(0, len(data), 32768):
            chunk = data[offset:offset + 32768]
            result = maintenance(api, "upload_chunk", {"token": token, "offset": offset, "data": base64.b64encode(chunk).decode()})
            if result.get("offset") != offset + len(chunk):
                raise AssertionError("归档上传进度不一致")
        return token

    token = upload(archive, "0" * 64)
    expect_rejected(api, "inspect", "checksum_mismatch", {"token": token})
    maintenance(api, "upload_cancel", {"token": token})
    token = upload(archive)
    inspected = maintenance(api, "inspect", {"token": token})
    if not inspected.get("ok") or inspected.get("files", 0) < 4:
        raise AssertionError(f"标准系统归档未通过实际设备校验：{inspected.get('error')}")
    expect_rejected(api, "restore", "confirmation_required", {"token": token, "confirm": False})
    maintenance(api, "upload_cancel", {"token": token})
    for member_name in ("../router-ui-escape", "etc/config/../../router-ui-escape"):
        invalid = io.BytesIO()
        with tarfile.open(fileobj=invalid, mode="w:gz", format=tarfile.USTAR_FORMAT) as tar:
            member = tarfile.TarInfo(member_name)
            tar.addfile(member)
        token = upload(invalid.getvalue())
        expect_rejected(api, "inspect", "invalid_archive", {"token": token})
        maintenance(api, "upload_cancel", {"token": token})
    # QEMU 是 ext4 / generic 板型，即使 device.json 模拟 AX1800，也绝不能刷写或重置。
    if status.get("upgradeSupported") or status.get("resetSupported"):
        raise AssertionError("虚拟板型不应开放真实设备刷写能力")
    expect_rejected(api, "reset", "unsupported_device", {"confirm": True})
    private_leftover = ssh(address, "test ! -d /tmp/router-ui-upload", capture_output=True)
    if private_leftover.returncode != 0:
        raise AssertionError("取消上传后必须清理归档及凭据")
    del result
    leftover = ssh(address, "find /tmp -maxdepth 1 -name 'router-ui-backup.*'", capture_output=True).stdout.strip()
    if leftover:
        raise AssertionError("备份的临时私有文件未清理")
    before = ssh(address, "cat /proc/sys/kernel/random/boot_id", capture_output=True).stdout.strip()
    if maintenance(api, "reboot", {"confirm": True}).get("accepted") is not True:
        raise AssertionError("设备未接受重启")
    wait_reboot(address, api, before)
    if committed(address, "dhcp", section) != original:
        raise AssertionError("维护操作不应修改原配置")
    # 在独立模拟机改动主机名，再恢复刚导出的归档并检查真实重启后的配置。
    api.login()
    hostname = ssh(address, "uci -q get system.@system[0].hostname", capture_output=True).stdout.strip()
    token = upload(archive)
    ssh(address, "uci set system.@system[0].hostname=router-restore-probe && uci commit system", capture_output=True)
    before = ssh(address, "cat /proc/sys/kernel/random/boot_id", capture_output=True).stdout.strip()
    if maintenance(api, "restore", {"token": token, "confirm": True}).get("accepted") is not True:
        raise AssertionError("设备未接受系统配置恢复")
    del archive
    wait_reboot(address, api, before)
    restored = ssh(address, "uci -q get system.@system[0].hostname", capture_output=True).stdout.strip()
    if restored != hostname or committed(address, "dhcp", section) != original:
        raise AssertionError("归档恢复并重启后配置不一致")
    ssh(address, "test ! -d /tmp/router-ui-upload && test ! -e /router-ui-backup.json", capture_output=True)
    report = {"anonymous_denied": "passed", "confirmation_required": "passed", "cross_session_staged_guard": "passed", "pending_apply_guard": "passed", "system_backup_sha256": "passed", "system_backup_size": backup_size, "private_files_cleaned": "passed", "upload_order_and_token": "passed", "upload_checksum": "passed", "archive_inspection": "passed", "archive_path_rejected": "passed", "generic_board_flash_denied": "passed", "reboot_boot_id_changed": "passed", "old_session_expired": "passed", "configuration_preserved": "passed", "archive_restored_after_reboot": "passed"}
    (REPORT / "maintenance.json").write_text(json.dumps(report, indent=2) + "\n")
    print("受限维护 RPC、系统配置备份校验、真实重启及会话失效全部通过")


if __name__ == "__main__":
    run(os.environ["SIM_ADDRESS"])
