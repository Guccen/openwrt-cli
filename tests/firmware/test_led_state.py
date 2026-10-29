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
        if not Path(self.bash).is_file():
            self.skipTest("需要 Bash")
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.path = self.root.as_posix()
        if os.name == "nt":
            self.path = subprocess.run(
                [self.bash, "-c", 'cygpath -u "$1"', "--", self.path],
                capture_output=True,
                text=True,
                check=True,
            ).stdout.strip()
        (self.root / "etc/crontabs").mkdir(parents=True)
        (self.root / "run").mkdir()
        source = (ROOT / "package/router-ui/files/led-state").read_text(encoding="utf-8")
        for original, replacement in {
            "/var/run/router-ui-led.lock": self.path + "/run/led-lock",
        }.items():
            source = source.replace(original, replacement)
        mocks = r'''
ucode() { printf '%s %s\n' "$2" "${3:-}" >> "$TEST_LOG"; }
'''
        source = source.replace("umask 077", "umask 077\n" + mocks)
        (self.root / "state.sh").write_text(source, encoding="utf-8", newline="\n")
        self.cron = self.root / "etc/crontabs/root"
        self.log = self.root / "commands"

    def run_state(self, mode="start"):
        env = dict(os.environ, TEST_LOG=self.path + "/commands")
        result = subprocess.run(
            [self.bash, self.path + "/state.sh", mode],
            env=env,
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return self.log.read_text() if self.log.exists() else ""

    def test_runtime_configuration_uses_one_shot_helper_without_cron(self):
        self.assertIn("start", self.run_state("start"))
        self.assertFalse(self.cron.exists())
        self.assertIn("boot", self.run_state("boot"))
        self.assertIn("configure", self.run_state("configure"))
        self.assertFalse(self.cron.exists())

    def test_legacy_led_cron_is_left_for_manual_removal(self):
        self.cron.write_text(
            "17 4 * * * echo personal-job\n"
            "* * * * * /usr/libexec/router-ui/led-state check >/dev/null 2>&1 # router-ui-led\n"
        )
        self.run_state("configure")
        self.assertEqual(
            self.cron.read_text(),
            "17 4 * * * echo personal-job\n"
            "* * * * * /usr/libexec/router-ui/led-state check >/dev/null 2>&1 # router-ui-led\n",
        )
        result = subprocess.run(
            [self.bash, self.path + "/state.sh", "check"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        self.assertNotEqual(result.returncode, 0)

    def test_stop_restores_original_trigger_without_stopping_shared_cron(self):
        log = self.run_state("stop")
        self.assertIn("restore", log)
        self.assertFalse(self.cron.exists())
