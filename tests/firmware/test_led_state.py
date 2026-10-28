import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]


class LedStateTests(unittest.TestCase):
    def setUp(self):
        self.bash = shutil.which("bash") or "C:/Program Files/Git/bin/bash.exe"
        if not Path(self.bash).is_file(): self.skipTest("需要 Bash")
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.path = self.root.as_posix()
        if os.name == "nt":
            self.path = subprocess.run([self.bash, "-c", 'cygpath -u "$1"', "--", self.path], capture_output=True, text=True, check=True).stdout.strip()
        (self.root / "config").write_text("fixture")
        source = (ROOT / "package/router-ui/files/led-state").read_text(encoding="utf-8")
        for original, replacement in {
            "/etc/router-ui-led.json": self.path + "/config",
            "/var/run/router-ui-led.lock": self.path + "/lock",
            "/var/run/router-ui-led.boot": self.path + "/boot",
            "/var/run/router-ui-maintenance.lock": self.path + "/maintenance",
            "/var/run/router-ui-crontab.lock": self.path + "/cron-lock",
            "/etc/crontabs": self.path + "/crontabs",
            "/etc/init.d/cron": "cron_service",
        }.items(): source = source.replace(original, replacement)
        mocks = r'''
jsonfilter() { case "$*" in *enabled*) printf '%s' "$TEST_ENABLED";; *) printf '223.5.5.5\n119.29.29.29\n';; esac; }
pidof() { [ "$1" = crond ] || [ "$TEST_FAULT" != yes ]; }
ping() { printf 'probe\n' >> "$TEST_PROBES"; [ "$TEST_REACHABLE" = yes ]; }
ucode() { printf '%s %s\n' "$2" "${3:-}" >> "$TEST_LOG"; }
cron_service() { return 0; }
'''
        source = source.replace("umask 077", "umask 077\n" + mocks)
        (self.root / "state.sh").write_text(source, encoding="utf-8", newline="\n")

    def run_state(self, mode="check", enabled=True, fault=False, reachable=True):
        env = dict(os.environ, TEST_ENABLED="true" if enabled else "false", TEST_FAULT="yes" if fault else "no",
                   TEST_REACHABLE="yes" if reachable else "no", TEST_LOG=self.path + "/commands", TEST_PROBES=self.path + "/probes")
        result = subprocess.run([self.bash, self.path + "/state.sh", mode], env=env, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return (self.root / "commands").read_text() if (self.root / "commands").exists() else ""

    def test_disabled_policy_does_not_probe_or_touch_leds(self):
        self.assertEqual(self.run_state(enabled=False), "")
        self.assertFalse((self.root / "probes").exists())

    def test_normal_offline_and_fault_follow_probe_and_service_priority(self):
        self.assertIn("apply normal", self.run_state())
        self.assertIn("apply offline", self.run_state(reachable=False))
        self.assertIn("apply fault", self.run_state(fault=True, reachable=False))

    def test_boot_is_held_until_start_and_does_not_probe_early(self):
        self.assertIn("apply boot", self.run_state("boot", fault=True))
        self.assertFalse((self.root / "probes").exists())
        self.run_state()
        self.assertFalse((self.root / "probes").exists())
        self.assertIn("apply normal", self.run_state("start"))
        self.assertFalse((self.root / "boot").exists())

    def test_scheduler_is_idempotent_preserves_other_jobs_and_is_removed_when_disabled(self):
        (self.root / "crontabs").mkdir()
        cron = self.root / "crontabs/root"
        sentinel = "0 4 * * * echo existing-job\n"
        cron.write_text(sentinel)
        self.run_state("configure")
        self.run_state("configure")
        self.assertEqual(cron.read_text().count("# router-ui-led"), 1)
        self.assertIn(sentinel, cron.read_text())
        self.run_state("configure", enabled=False)
        self.assertEqual(cron.read_text(), sentinel)

    def test_root_crontab_lock_prevents_led_from_overwriting_schedule_jobs(self):
        (self.root / "crontabs").mkdir()
        cron = self.root / "crontabs/root"
        sentinel = "0 3 * * 0 /usr/libexec/router-ui/scheduled-reboot run >/dev/null 2>&1 # router-ui-scheduled-reboot\n"
        cron.write_text(sentinel)
        (self.root / "cron-lock").mkdir()
        env = dict(os.environ, TEST_ENABLED="true", TEST_FAULT="no", TEST_REACHABLE="yes", TEST_LOG=self.path + "/commands", TEST_PROBES=self.path + "/probes")
        result = subprocess.run([self.bash, self.path + "/state.sh", "configure"], env=env, capture_output=True, text=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(cron.read_text(), sentinel)
        self.assertTrue((self.root / "cron-lock").is_dir())
        self.assertFalse((self.root / "lock").exists())
