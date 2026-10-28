"""在隔离目录用命令替身验证维护 shell 的最终刷写与重置门禁。"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class MaintenanceRpcTests(unittest.TestCase):
    def run_rpc(self, method, *, board="jdcloud,re-ss-01", mounts="", busy=False,
                accepted=True, checksum=True, confirmed=True, kind="upgrade", restore_fails=False, rollback_fails=False,
                apply_pending=False, fail_upgrade=False, fail_reset=False, fail_reboot=False, late_busy=False):
        bash = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"
        if not Path(bash).is_file():
            self.skipTest("需要 Bash")
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            path = root.as_posix()
            if os.name == "nt":
                path = subprocess.run([bash, "-c", 'cygpath -u "$1"', "--", path], capture_output=True, text=True, check=True).stdout.strip()
            (root / "board").write_text(board)
            (root / "mounts").write_text(mounts)
            (root / "uuid").write_text("12345678-1234-1234-1234-123456789abc\n")
            (root / "boot-id").write_text("87654321-1234-1234-1234-123456789abc\n")
            (root / "rpcd/snapshot-files").mkdir(parents=True)
            if apply_pending:
                (root / "rpcd/snapshot-files/network").write_text("config interface lan\n")
            (root / "upload").mkdir()
            (root / "upload/payload").write_bytes(b"firmware-fixture")
            digest = hashlib.sha256(b"firmware-fixture").hexdigest() if checksum else "0" * 64
            info = json.dumps({"ok": True, "kind": kind, "sha256": digest, "confirm": confirmed})
            mock = r'''
sysupgrade() {
    printf '%s\n' "$*" >> "$TEST_LOG"
    if [ "$1" = '-n' ] && [ "$TEST_UPGRADE_FAIL" = yes ]; then return 1; fi
    if [ "$1" = '-r' ]; then
        case "$2" in
            */expanded) [ "$TEST_RESTORE_FAILS" != yes ]; return;;
            */rescue.tar.gz) [ "$TEST_ROLLBACK_FAILS" != yes ]; return;;
        esac
    fi
    [ "$1" != '-T' ] || [ "$TEST_ACCEPTED" = yes ]
}
ubus() { printf 'reboot\n' >> "$TEST_LOG"; [ "$TEST_REBOOT_FAIL" != yes ]; }
jffs2reset() { printf 'reset\n' >> "$TEST_LOG"; [ "$TEST_RESET_FAIL" != yes ]; }
sleep() { if [ "$TEST_LATE_BUSY" = yes ]; then : > "$TEST_BUSY_FILE"; fi; }
ucode() {
    if [ "$2" = operation ]; then
        if [ -f "$TEST_OPERATION" ]; then cat "$TEST_OPERATION"; else printf null; fi
    elif [ "$2" = archive ]; then printf '{"ok":true,"files":4}';
    else printf '%s\n' "$TEST_INFO"; fi
}
gzip() { printf 'checked-archive-fixture'; }
jsonfilter() {
    case "$2" in
        '@.kind') printf '%s' "$TEST_KIND";;
        '@.sha256') printf '%s' "$TEST_DIGEST";;
        '@.confirm') printf '%s' "$TEST_CONFIRM";;
    esac
}
'''
            script = (ROOT / "package/router-ui/files/router.maintenance").read_text(encoding="utf-8")
            script = script.replace("umask 077", "umask 077\n" + mock)
            script = script.replace("/var/run/router-ui-maintenance.lock", path + "/lock")
            script = script.replace("/var/run/router-ui-maintenance.json", path + "/operation.json")
            script = script.replace("/tmp/router-ui-upload", path + "/upload")
            script = script.replace("/var/run/rpcd/", path + "/rpcd/")
            script = script.replace("/tmp/sysinfo/board_name", path + "/board")
            script = script.replace("/proc/mounts", path + "/mounts")
            script = script.replace("/proc/sys/kernel/random/uuid", path + "/uuid")
            script = script.replace("/proc/sys/kernel/random/boot_id", path + "/boot-id")
            script = script.replace("[ -x /sbin/sysupgrade ]", "[ -f '" + path + "/board' ]")
            script = script.replace("[ -x /sbin/jffs2reset ]", "[ -f '" + path + "/board' ]")
            script = script.replace("sleep 3", "sleep 0")
            # 不读取宿主机配置事务目录。
            start = script.index("    local entry\n", script.index("busy_config()"))
            end = script.index("\n}", start)
            script = script[:start] + ("    return 0" if busy else '    [ -f "$TEST_BUSY_FILE" ] && return 0\n    return 1') + script[end:]
            script += "\nwait\n"
            (root / "rpc.sh").write_text(script, encoding="utf-8", newline="\n")
            env = dict(os.environ, TEST_LOG=path + "/commands", TEST_INFO=info, TEST_DIGEST=digest,
                       TEST_CONFIRM="true" if confirmed else "false", TEST_ACCEPTED="yes" if accepted else "no", TEST_KIND=kind,
                       TEST_RESTORE_FAILS="yes" if restore_fails else "no", TEST_ROLLBACK_FAILS="yes" if rollback_fails else "no",
                       TEST_UPGRADE_FAIL="yes" if fail_upgrade else "no", TEST_RESET_FAIL="yes" if fail_reset else "no",
                       TEST_REBOOT_FAIL="yes" if fail_reboot else "no", TEST_LATE_BUSY="yes" if late_busy else "no",
                       TEST_BUSY_FILE=path + "/late-busy", TEST_OPERATION=path + "/operation.json")
            result = subprocess.run([bash, path + "/rpc.sh", "call", method], input="{}", capture_output=True, text=True, env=env, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            commands = (root / "commands").read_text() if (root / "commands").exists() else ""
            response = json.loads(result.stdout)
            if (root / "operation.json").exists():
                response["record"] = json.loads((root / "operation.json").read_text())
            self.assertFalse((root / "lock").exists(), "维护请求结束后未释放锁")
            return response, commands

    def test_generic_and_n1_board_cannot_flash_or_reset(self):
        for board in ("linux,dummy-virt", "phicomm,n1"):
            for method in ("upgrade", "reset"):
                result, commands = self.run_rpc(method, board=board)
                self.assertEqual(result["error"], "unsupported_device")
                self.assertEqual(commands, "")

    def test_status_distinguishes_pending_apply_from_other_configuration_changes(self):
        for pending in (False, True):
            result, commands = self.run_rpc("status", busy=True, apply_pending=pending)
            self.assertTrue(result["configurationBusy"])
            self.assertEqual(result["applyPending"], pending)
            self.assertEqual(commands, "")

    def test_async_failures_record_reason_and_match_accepted_operation(self):
        mounts = "/dev/root /rom squashfs ro 0 0\noverlayfs:/overlay / overlay rw 0 0\n"
        for method, options, reason in [
            ("upgrade", {"fail_upgrade": True}, "upgrade_failed"),
            ("upgrade", {"late_busy": True}, "configuration_busy"),
            ("reset", {"fail_reset": True, "mounts": mounts}, "reset_failed"),
            ("reboot", {"fail_reboot": True}, "reboot_failed"),
            ("reboot", {"late_busy": True}, "configuration_busy"),
        ]:
            with self.subTest(method=method, reason=reason):
                result, commands = self.run_rpc(method, **options)
                self.assertTrue(result["accepted"])
                self.assertEqual(result["record"]["id"], result["operationId"])
                self.assertEqual(result["record"]["kind"], method)
                self.assertEqual(result["record"]["state"], "failed")
                self.assertEqual(result["record"]["error"], reason)
                if reason == "configuration_busy":
                    self.assertNotIn("reboot", commands)
                    self.assertNotIn("-n", commands)

    def test_flash_requires_confirmation_hash_compatible_image_and_idle_configuration(self):
        for params, reason in [({"confirmed": False}, "confirmation_required"),
                               ({"checksum": False}, "checksum_mismatch"),
                               ({"accepted": False}, "invalid_firmware"),
                               ({"busy": True}, "configuration_busy")]:
            with self.subTest(params=params):
                result, commands = self.run_rpc("upgrade", **params)
                self.assertEqual(result["error"], reason)
                self.assertNotIn("-n", commands)

    def test_valid_flash_uses_test_then_no_config_upgrade_without_force(self):
        result, commands = self.run_rpc("upgrade")
        self.assertTrue(result["accepted"])
        self.assertIn("-T ", commands)
        self.assertIn("-n ", commands)
        self.assertNotIn("-F", commands)

    def test_factory_reset_requires_real_squashfs_overlay(self):
        result, commands = self.run_rpc("reset", mounts="/dev/root / ext4 rw 0 0\n")
        self.assertEqual(result["error"], "unsupported_device")
        self.assertEqual(commands, "")
        result, commands = self.run_rpc("reset", mounts="/dev/root /rom squashfs ro 0 0\noverlayfs:/overlay / overlay rw 0 0\n")
        self.assertTrue(result["accepted"])
        self.assertEqual(commands, "reset\nreboot\n")

    def test_restore_success_reboots_and_failure_attempts_rescue_without_reboot(self):
        result, commands = self.run_rpc("restore", kind="restore")
        self.assertTrue(result["accepted"])
        self.assertIn("reboot", commands)
        for rollback_fails, reason in [(False, "restore_failed"), (True, "restore_rollback_failed")]:
            result, commands = self.run_rpc("restore", kind="restore", restore_fails=True, rollback_fails=rollback_fails)
            self.assertEqual(result["error"], reason)
            self.assertIn("/rescue.tar.gz", commands)
            self.assertNotIn("reboot", commands)

    def test_upload_cancellation_is_possible_during_staged_configuration(self):
        result, commands = self.run_rpc("upload_cancel", busy=True)
        self.assertTrue(result["ok"])
        self.assertEqual(commands, "")


if __name__ == "__main__":
    unittest.main()
