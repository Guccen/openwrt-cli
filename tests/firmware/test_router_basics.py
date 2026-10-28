"""用真实 ucode 验证固定操作的目标校验，不在宿主执行网络命令或修改系统时间。"""
import json
import os
import re
from pathlib import Path
import shlex
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]

class RouterBasicsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.command = shlex.split(os.environ.get('UCODE_TEST_COMMAND', '')) or ([shutil.which('ucode')] if shutil.which('ucode') else [])
        if not cls.command:
            raise unittest.SkipTest('需要真实 ucode')

    def evaluate(self, name, body):
        source = (ROOT / 'package/router-ui/files' / name).read_text(encoding='utf-8').split('\ntry {')[0]
        source = source.replace("import { cursor } from 'uci';", '')
        result = subprocess.run([*self.command, '-e', source + body], capture_output=True, encoding='utf-8', timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr)
        return json.loads(result.stdout)

    def test_diagnostics_rejects_command_injection_options_urls_and_unbounded_input(self):
        targets = ['-c100', '127.0.0.1;reboot', '$(id)', "a'b", 'a\nb', 'https://example.com', 'x' * 254, '../etc/passwd']
        body = 'let values = ' + json.dumps(targets) + '; print(map(values, v => target(v)));'
        self.assertEqual(self.evaluate('diagnostics.uc', body), [False] * len(targets))
        commands = self.evaluate('diagnostics.uc', "print([command({operation:'ping6', target:'2001:db8::1'}), command({operation:'dns', target:'example.com'}), command({operation:'logs'})]);")
        self.assertTrue(all('/usr/bin/timeout -s KILL 6 ' in cmd for cmd in commands))
        self.assertTrue(commands[0].endswith("'2001:db8::1' 2>&1"))
        self.assertEqual(self.evaluate('diagnostics.uc', "try { command({operation:'exec', target:'example.com'}); print(false); } catch(e) { print(e.message == 'unsupported_operation'); }"), True)

    def test_time_settings_validate_known_zone_server_bounds_and_preserve_existing_zone(self):
        body = """
        let previous = { zone:'Europe/Custom' }, good = { zone:'Asia/Shanghai', enabled:true, useDhcp:false, servers:['ntp.example.com','2001:db8::1'] };
        let results = [validated(good, previous).zone];
        for (let item in [ { ...good, zone:'../../etc/passwd' }, { ...good, servers:['-p123'] }, { ...good, servers:['a;reboot'] }, { ...good, servers:[] }, { ...good, servers:['a','b','c','d','e'] } ]) {
            try { validated(item, previous); push(results, false); } catch(e) { push(results, true); }
        }
        push(results, validated({ ...good, zone:'Europe/Custom' }, previous).zone);
        print(results);
        """
        self.assertEqual(self.evaluate('time-settings.uc', body), ['Asia/Shanghai', True, True, True, True, True, 'Europe/Custom'])

    def test_n1_wireless_mac_is_stable_local_unicast_and_distinct_from_lan(self):
        text = (ROOT / 'files/router-defaults.sh').read_text(encoding='utf-8')
        expression = re.search(r"wlan_mac=\$\(ucode -e '([^']+)'\)", text).group(1)
        for address, expected in [('fc:7c:02:11:22:33', 'fa:7c:02:11:22:33'), ('02:11:22:33:44:55', '06:11:22:33:44:55')]:
            source = expression.replace('readfile("/sys/class/net/eth0/address")', json.dumps(address))
            result = subprocess.run([*self.command, '-e', source], capture_output=True, encoding='utf-8', timeout=15)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(result.stdout, expected)
        for address in ['', '01:11:22:33:44:55', 'bad-address']:
            source = expression.replace('readfile("/sys/class/net/eth0/address")', json.dumps(address))
            result = subprocess.run([*self.command, '-e', source], capture_output=True, encoding='utf-8', timeout=15)
            self.assertEqual(result.stdout, '')
