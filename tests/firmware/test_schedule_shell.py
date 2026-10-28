"""隔离 shell 夹具验证 cron 事务及运行互斥；所有系统命令均为本地桩。"""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
MARKER = "# router-ui-scheduled-reboot"


class ScheduleShellTests(unittest.TestCase):
    def setUp(self):
        self.bash = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"
        if not Path(self.bash).is_file():
            self.skipTest("需要 Bash")
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.path = self.root.as_posix()
        if os.name == "nt":
            self.path = subprocess.run([self.bash, "-c", 'cygpath -u "$1"', "--", self.path], capture_output=True, text=True, check=True).stdout.strip()
        (self.root / "etc/crontabs").mkdir(parents=True)
        (self.root / "run/rpcd/snapshot-files").mkdir(parents=True)
        self.config = self.root / "etc/router-ui-schedule.json"
        self.config.write_text(json.dumps({"enabled": False, "time": "03:00", "days": list(range(7))}, separators=(",", ":")))
        self.cron = self.root / "etc/crontabs/root"
        self.sentinel = "17 4 * * * echo personal-job\n* * * * * /usr/libexec/router-ui/led-state check >/dev/null 2>&1 # router-ui-led\n"
        self.cron.write_text(self.sentinel)
        source = (ROOT / "package/router-ui/files/scheduled-reboot").read_text(encoding="utf-8")
        for original, replacement in {
            "/etc/router-ui-schedule.json": self.path + "/etc/router-ui-schedule.json",
            "/etc/crontabs": self.path + "/etc/crontabs",
            "/etc/.router-ui-schedule": self.path + "/etc/.router-ui-schedule",
            "/var/run/router-ui-schedule.lock": self.path + "/run/schedule-lock",
            "/var/run/router-ui-crontab.lock": self.path + "/run/cron-lock",
            "/var/run/router-ui-maintenance.lock": self.path + "/run/maintenance-lock",
            "/var/run/rpcd/": self.path + "/run/rpcd/",
            "/tmp/.uci/": self.path + "/run/uci/",
            "/etc/init.d/cron": "cron_service",
        }.items():
            source = source.replace(original, replacement)
        mocks = r'''
ucode() {
    case "$2" in
        validate)
            cat > "$TEST_ROOT/request"
            if [ "$TEST_INVALID" = yes ]; then printf '%s' '{"ok":false,"error":"schedule_invalid"}'; return 1; fi
            printf '%s' "$TEST_POLICY" ;;
        line)
            [ "$TEST_LINE_FAIL" != yes ] || return 1
            if grep -q '"enabled"[[:space:]]*:[[:space:]]*true' "$CONFIG"; then
                printf '%s\n' '0 3 * * 0,1,2,3,4,5,6 /usr/libexec/router-ui/scheduled-reboot run >/dev/null 2>&1 # router-ui-scheduled-reboot'
            fi ;;
        decision)
            if [ "$TEST_SECOND_NOT_DUE" = yes ] && [ -f "$TEST_ROOT/decision" ]; then
                printf '%s' '{"due":false,"reason":"not_due"}'
            else printf '{"due":%s,"reason":"%s"}' "$TEST_DUE" "$TEST_REASON"; fi
            : > "$TEST_ROOT/decision" ;;
        record)
            printf '%s\n' "$3" >> "$TEST_ROOT/events"
            printf 'record:%s\n' "$3" >> "$TEST_ROOT/order"
            [ "$TEST_RECORD_FAIL" != yes ] ;;
        reserve)
            printf 'reserve\n' >> "$TEST_ROOT/order"
            [ "$TEST_RESERVE_FAIL" != yes ] ;;
        *) return 1 ;;
    esac
}
jsonfilter() {
    text=$(cat)
    case "$*" in
        *'@.due'*) case "$text" in *'"due":true'*) printf true;; *) printf false;; esac ;;
        *'@.reason'*) printf '%s' "$text" | sed -n 's/.*"reason":"\([a-z_]*\)".*/\1/p' ;;
        *) return 1 ;;
    esac
}
pidof() { [ "$1" = crond ] && [ -f "$TEST_ROOT/running" ]; }
cron_service() {
    printf '%s\n' "$1" >> "$TEST_ROOT/service"
    case "$1" in
        enabled) [ -f "$TEST_ROOT/enabled" ] ;;
        enable) : > "$TEST_ROOT/enabled" ;;
        disable) rm -f "$TEST_ROOT/enabled" ;;
        restart)
            if [ "$TEST_RESTART_FAIL" = always ] || { [ "$TEST_RESTART_FAIL" = once ] && [ ! -f "$TEST_ROOT/failed" ]; }; then
                : > "$TEST_ROOT/failed"; return 1
            fi
            : > "$TEST_ROOT/running" ;;
        stop) rm -f "$TEST_ROOT/running" ;;
        *) return 1 ;;
    esac
}
sleep() { return 0; }
ubus() {
    [ "$*" = 'call system reboot' ] || return 2
    printf 'reboot\n' >> "$TEST_ROOT/reboots"
    printf 'reboot\n' >> "$TEST_ROOT/order"
    [ "$TEST_REBOOT_FAIL" != yes ]
}
mv() {
    if [ "$TEST_MOVE_FAIL" = yes ] && [ "$2" = "$CRON" ] && [ ! -f "$TEST_ROOT/move-failed" ]; then
        : > "$TEST_ROOT/move-failed"; return 1
    fi
    command mv "$@"
}
'''
        source = source.replace("umask 077", "umask 077\n" + mocks)
        (self.root / "schedule.sh").write_text(source, encoding="utf-8", newline="\n")

    def run_schedule(self, mode="configure", *, enabled=True, success=True, **flags):
        policy = json.dumps({"enabled": enabled, "time": "03:00", "days": list(range(7))}, separators=(",", ":"))
        env = dict(os.environ, TEST_ROOT=self.path, TEST_POLICY=policy, TEST_INVALID="no", TEST_LINE_FAIL="no", TEST_DUE="true", TEST_REASON="requested", TEST_SECOND_NOT_DUE="no", TEST_RECORD_FAIL="no", TEST_RESERVE_FAIL="no", TEST_RESTART_FAIL="no", TEST_MOVE_FAIL="no", TEST_REBOOT_FAIL="no")
        env.update(flags)
        result = subprocess.run([self.bash, self.path + "/schedule.sh", mode], input=policy, env=env, capture_output=True, text=True, timeout=10)
        if success:
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        else:
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertFalse((self.root / "run/schedule-lock").exists())
        return result

    def events(self):
        path = self.root / "events"
        return path.read_text().splitlines() if path.exists() else []

    def test_save_start_disable_uninstall_are_idempotent_and_preserve_other_jobs(self):
        self.assertEqual(json.loads(self.run_schedule().stdout), {"ok": True})
        self.run_schedule("start")
        self.run_schedule()
        self.assertEqual(self.cron.read_text().count(MARKER), 1)
        self.assertIn(self.sentinel, self.cron.read_text())
        self.assertTrue(json.loads(self.config.read_text())["enabled"])
        self.run_schedule(enabled=False)
        self.assertEqual(self.cron.read_text(), self.sentinel)
        self.run_schedule()
        self.run_schedule("uninstall")
        self.assertEqual(self.cron.read_text(), self.sentinel)
        self.assertFalse((self.root / "reboots").exists())

    def test_invalid_input_cron_lock_and_oversized_crontab_leave_existing_files(self):
        before = self.config.read_bytes(), self.cron.read_bytes()
        result = self.run_schedule(success=False, TEST_INVALID="yes")
        self.assertEqual(json.loads(result.stdout)["error"], "schedule_invalid")
        self.assertEqual((self.config.read_bytes(), self.cron.read_bytes()), before)
        (self.root / "run/cron-lock").mkdir()
        result = self.run_schedule(success=False)
        self.assertIn("schedule_cron_busy", result.stdout)
        self.assertEqual((self.config.read_bytes(), self.cron.read_bytes()), before)
        self.assertTrue((self.root / "run/cron-lock").exists())
        (self.root / "run/cron-lock").rmdir()
        self.cron.write_text("x" * 65537)
        result = self.run_schedule(success=False)
        self.assertIn("schedule_crontab_too_large", result.stdout)
        self.assertEqual(self.config.read_bytes(), before[0])

    def test_disabled_first_start_does_not_create_empty_crontab_or_start_service(self):
        self.cron.unlink()
        self.run_schedule("start", enabled=False)
        self.assertFalse(self.cron.exists())
        self.assertFalse((self.root / "enabled").exists())
        self.assertFalse((self.root / "running").exists())

    def test_service_and_atomic_move_failures_restore_config_cron_and_service_state(self):
        for flag in ({"TEST_RESTART_FAIL": "once"}, {"TEST_MOVE_FAIL": "yes"}, {"TEST_LINE_FAIL": "yes"}):
            with self.subTest(flag=flag):
                before = self.config.read_bytes(), self.cron.read_bytes()
                result = self.run_schedule(success=False, **flag)
                self.assertIn("schedule_apply_failed", result.stdout)
                self.assertEqual((self.config.read_bytes(), self.cron.read_bytes()), before)
                self.assertFalse((self.root / "enabled").exists())
                self.assertFalse((self.root / "running").exists())
                self.assertFalse((self.root / "run/cron-lock").exists())
                self.assertFalse(list((self.root / "etc").glob(".router-ui-schedule*")))
                self.assertFalse(list((self.root / "etc/crontabs").glob(".router-ui-schedule*")))

    def test_reboot_only_after_due_and_both_locks_configuration_and_record_checks(self):
        for reason in ("disabled", "invalid_clock", "not_due", "duplicate", "boot_grace"):
            with self.subTest(reason=reason):
                self.run_schedule("run", TEST_DUE="false", TEST_REASON=reason)
                self.assertEqual(self.events()[-1], reason)
        (self.root / "run/maintenance-lock").mkdir()
        self.run_schedule("run")
        self.assertEqual(self.events()[-1], "maintenance_busy")
        self.assertTrue((self.root / "run/maintenance-lock").exists())
        (self.root / "run/maintenance-lock").rmdir()
        staged = self.root / "run/rpcd/snapshot-files/network"
        staged.write_text("pending")
        self.run_schedule("run")
        self.assertEqual(self.events()[-1], "configuration_busy")
        staged.unlink()
        self.run_schedule("run", TEST_SECOND_NOT_DUE="yes")
        self.assertEqual(self.events()[-1], "not_due")
        self.run_schedule("run", success=False, TEST_RESERVE_FAIL="yes")
        self.assertFalse((self.root / "reboots").exists())
        (self.root / "order").unlink()
        self.run_schedule("run")
        self.assertEqual((self.root / "reboots").read_text(), "reboot\n")
        self.assertEqual((self.root / "order").read_text().splitlines(), ["reserve", "reboot", "record:requested"])
        self.assertFalse((self.root / "run/maintenance-lock").exists())

    def test_failed_reboot_is_recorded_and_existing_maintenance_is_never_removed(self):
        self.run_schedule("run", success=False, TEST_REBOOT_FAIL="yes")
        self.assertEqual(self.events(), ["reboot_failed"])
        (self.root / "run/maintenance-lock").mkdir()
        self.run_schedule("run")
        self.assertTrue((self.root / "run/maintenance-lock").exists())


if __name__ == "__main__":
    unittest.main()
