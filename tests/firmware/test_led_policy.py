import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[2]


class LedPolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.command = shlex.split(os.environ.get("UCODE_TEST_COMMAND", "")) or ([shutil.which("ucode")] if shutil.which("ucode") else [])
        if not cls.command:
            raise unittest.SkipTest("需要真实 ucode")

    def policy(self):
        result = json.loads((ROOT / "package/router-ui/files/router-ui-led.json").read_text())
        result["enabled"] = True
        for state in result["states"].values():
            state["led"] = "blue:status"
        return result

    def run_code(self, body, *, apply=None):
        root = "/tmp/router-ui-led-test-" + uuid.uuid4().hex
        source = (ROOT / "package/router-ui/files/led-policy.uc").read_text(encoding="utf-8")
        source = source.replace("/etc/router-ui-led.json", root + "/config")
        source = source.replace("/var/run/router-ui-led.previous", root + "/previous")
        source = source.replace("/var/run/router-ui-led.status", root + "/status")
        source = source.replace("/sys/class/leds/", root + "/leds/")
        definitions, main = source.split("\ntry {", 1)
        setup = f"const fixtureRoot='{root}'; mkdir('/tmp'); mkdir('{root}'); mkdir('{root}/leds'); mkdir('{root}/leds/blue:status');"
        setup += f"writefile('{root}/leds/blue:status/trigger', '[none] timer'); writefile('{root}/leds/blue:status/max_brightness', '1'); writefile('{root}/leds/blue:status/brightness', '0');"
        setup += "writefile(config, " + json.dumps(json.dumps(self.policy())) + ");"
        definitions = definitions.replace("import {", "import { mkdir, ", 1)
        if apply:
            main = ("try {" + main).replace("ARGV[0]", "'apply'").replace("ARGV[1]", json.dumps(apply))
            main = main.replace("exit(0);", "return;").replace("exit(1);", "return;")
            setup += "function main() {" + main + "} main();"
        cleanup = f"for (let path in glob('{root}/leds/blue:status/*')) unlink(path); rmdir('{root}/leds/blue:status'); rmdir('{root}/leds'); for(let path in glob('{root}/*')) unlink(path); rmdir('{root}');"
        definitions = definitions.replace("import { mkdir, ", "import { mkdir, rmdir, ", 1)
        result = subprocess.run([*self.command, "-e", definitions + setup + body + cleanup], capture_output=True, encoding="utf-8", timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_capabilities_come_from_real_files_and_timer_trigger(self):
        result = json.loads(self.run_code("print(capabilities());"))
        self.assertEqual(result, [{"id": "blue:status", "timer": True, "maxBrightness": 1}])

    def test_invalid_probe_paths_modes_and_intervals_are_rejected(self):
        policies = []
        for target in ("127.0.0.1", "256.1.1.1", "223.5.5.5;reboot", "-c 999"):
            policy = self.policy()
            policy["targets"] = [target]
            policies.append((policy, "led_invalid"))
        policy = self.policy()
        policy["states"]["fault"]["led"] = "../../etc/shadow"
        policies.append((policy, "led_unsupported"))
        policy = self.policy()
        policy["states"]["fault"]["onMs"] = 0
        policies.append((policy, "led_invalid"))
        for policy, expected in policies:
            body = "try { validate(json(" + json.dumps(json.dumps(policy)) + "), capabilities()); print('BAD'); } catch(e) {print(e.message);}"
            self.assertEqual(self.run_code(body), expected)

    def test_apply_each_state_writes_selected_effect_and_remembers_original(self):
        for state in ("boot", "normal", "offline", "fault"):
            result = json.loads(self.run_code("print({state:json(readfile(statusFile)).state, trigger:readfile(fixtureRoot + '/leds/blue:status/trigger'), saved:!!readfile(previous)});", apply=state))
            self.assertEqual(result["state"], state)
            self.assertTrue(result["saved"])
            self.assertEqual(result["trigger"], "none" if state == "normal" else "timer")

    def test_disabling_restores_original_trigger_and_brightness(self):
        result = self.run_code("restore(capabilities()); print(readfile(fixtureRoot + '/leds/blue:status/trigger'), ':', readfile(fixtureRoot + '/leds/blue:status/brightness'), ':', !!readfile(previous));", apply="fault")
        self.assertEqual(result, "none:0:false")
