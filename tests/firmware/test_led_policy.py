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
        cls.command = shlex.split(os.environ.get("UCODE_TEST_COMMAND", "")) or (
            [shutil.which("ucode")] if shutil.which("ucode") else []
        )
        if not cls.command:
            raise unittest.SkipTest("需要真实 ucode")

    def policy(self):
        return {
            "version": 2,
            "enabled": True,
            "boot": {"led": "blue:status", "effect": "blink", "onMs": 250, "offMs": 250},
            "leds": [
                {
                    "id": "green:status",
                    "trigger": "netdev",
                    "deviceName": "wan",
                    "link": True,
                    "rx": True,
                    "tx": True,
                    "interval": 50,
                    "onMs": 250,
                    "offMs": 250,
                }
            ],
        }

    def run_code(self, body):
        root = "/tmp/router-ui-led-test-" + uuid.uuid4().hex
        source = (ROOT / "package/router-ui/files/led-policy.uc").read_text(encoding="utf-8")
        source = source.replace("/etc/router-ui-led.json", root + "/config")
        source = source.replace("/var/run/router-ui-led.previous", root + "/previous")
        source = source.replace("/sys/class/leds/", root + "/leds/")
        source = source.replace("/sys/class/net/", root + "/net/")
        definitions, _ = source.split("\ntry {", 1)
        definitions = definitions.replace("import {", "import { mkdir, rmdir, ", 1)
        setup = f"const fixtureRoot='{root}'; mkdir('/tmp'); mkdir('{root}'); mkdir('{root}/leds'); mkdir('{root}/net');"
        for led in ("green:status", "blue:status"):
            setup += f"mkdir('{root}/leds/{led}');"
            setup += f"writefile('{root}/leds/{led}/trigger', '[default-on] timer heartbeat netdev');"
            setup += f"writefile('{root}/leds/{led}/max_brightness', '1'); writefile('{root}/leds/{led}/brightness', '1');"
            setup += f"writefile('{root}/leds/{led}/device_name', 'wan'); writefile('{root}/leds/{led}/link', '1');"
            setup += f"writefile('{root}/leds/{led}/rx', '1'); writefile('{root}/leds/{led}/tx', '1'); writefile('{root}/leds/{led}/interval', '50');"
        setup += f"mkdir('{root}/net/wan'); mkdir('{root}/net/br-lan');"
        setup += "writefile(config, " + json.dumps(json.dumps(self.policy())) + ");"
        cleanup = f"for(let path in glob('{root}/leds/*/*')) unlink(path); for(let path in glob('{root}/leds/*')) rmdir(path); for(let path in glob('{root}/net/*')) rmdir(path); for(let path in glob('{root}/*')) unlink(path); rmdir('{root}/leds'); rmdir('{root}/net'); rmdir('{root}');"
        result = subprocess.run(
            [*self.command, "-e", definitions + setup + body + cleanup],
            capture_output=True,
            encoding="utf-8",
            timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        return result.stdout

    def test_capabilities_and_network_devices_come_from_runtime_files(self):
        result = json.loads(self.run_code("print({leds:capabilities(), devices:networkDevices()});"))
        self.assertEqual([item["id"] for item in result["leds"]], ["blue:status", "green:status"])
        self.assertIn("netdev", result["leds"][0]["triggers"])
        self.assertEqual(set(result["devices"]), {"br-lan", "wan"})

    def test_invalid_led_network_and_unsupported_trigger_are_rejected(self):
        policies = []
        policy = self.policy()
        policy["leds"][0]["id"] = "../../etc/shadow"
        policies.append((policy, "led_invalid"))
        policy = self.policy()
        policy["leds"][0]["deviceName"] = "../../etc/passwd"
        policies.append((policy, "led_unsupported"))
        policy = self.policy()
        policy["leds"][0]["trigger"] = "unknown-trigger"
        policies.append((policy, "led_unsupported"))
        for policy, expected in policies:
            body = "try { validate(json(" + json.dumps(json.dumps(policy)) + "), capabilities(), networkDevices()); print('BAD'); } catch(e) { print(e.message); }"
            self.assertEqual(self.run_code(body), expected)

    def test_legacy_configuration_migrates_normal_led_to_network_trigger(self):
        legacy = {
            "enabled": True,
            "targets": ["223.5.5.5", "119.29.29.29"],
            "states": {
                "boot": {"led": "blue:status", "effect": "blink", "onMs": 250, "offMs": 250},
                "normal": {"led": "green:status", "effect": "off", "onMs": 500, "offMs": 500},
                "offline": {"led": "red:status", "effect": "off", "onMs": 1000, "offMs": 1000},
                "fault": {"led": "red:status", "effect": "blink", "onMs": 100, "offMs": 100},
            },
        }
        result = self.run_code(
            "let settings=normalize(json(" + json.dumps(json.dumps(legacy)) + "), capabilities(), networkDevices()); print(sprintf('%J', settings));"
        )
        migrated = json.loads(result)
        self.assertTrue(migrated["enabled"])
        self.assertEqual(migrated["boot"]["led"], "blue:status")
        self.assertEqual(migrated["leds"][0]["id"], "green:status")
        self.assertEqual(migrated["leds"][0]["trigger"], "netdev")
