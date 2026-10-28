"""在真实 ucode VM 中用受控总线/进程替身验证密码数据流，不修改宿主密码。"""
import json
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[2]


class PasswordTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.command = shlex.split(os.environ.get("UCODE_TEST_COMMAND", "")) or ([shutil.which("ucode")] if shutil.which("ucode") else [])
        if not cls.command:
            raise unittest.SkipTest("需要真实 ucode；QEMU 另有密码修改集成测试")

    def request(self, *, current="current-password", password="new-password", confirmation="new-password",
                fail_write=False, concurrent_login=False, fail_relist=False):
        data = json.dumps({"current": current, "password": password, "confirmation": confirmation}).encode().hex()
        prefix = """
let calls = [], writes = [], changed = false;
function busError() { return null; }
function fdopen() { return { read: () => hexdec(DATA) }; }
function popen(command, mode) {
    push(calls, [command, mode]);
    return { write: value => { push(writes, value); return length(value); }, flush: () => true,
        close: () => { changed = STATUS == 0; return STATUS; } };
}
function connect() {
    return { disconnect: () => true, call: (object, method, args, multiple) => {
        push(calls, [object, method]);
        if (method == 'login') return args.password == 'current-password' ? {ubus_rpc_session:'verifier'} : null;
        if (method == 'list') {
            if (changed && FAIL_RELIST) return null;
            let sessions = [{ubus_rpc_session:'first',data:{username:'root'}},{ubus_rpc_session:'second',data:{username:'root'}},
                {ubus_rpc_session:'unrelated',data:{username:'guest'}}];
            if (changed && CONCURRENT_LOGIN) push(sessions, {ubus_rpc_session:'concurrent',data:{username:'root'}});
            return sessions;
        }
        if (method == 'destroy') { push(calls, ['destroy',args.ubus_rpc_session]); return null; }
    }};
}
""".replace("DATA", json.dumps(data)).replace("STATUS", "1" if fail_write else "0")
        prefix = prefix.replace("CONCURRENT_LOGIN", "true" if concurrent_login else "false")
        prefix = prefix.replace("FAIL_RELIST", "true" if fail_relist else "false")
        source = (ROOT / "package/router-ui/files/password.uc").read_text(encoding="utf-8")
        source = source.replace("import { fdopen, popen } from 'fs';", "").replace("import { connect, error as busError } from 'ubus';", "")
        source = source.replace("sleep(250);", "")
        source += "\nprint('\\n', {calls, writes});"
        result = subprocess.run([*self.command, "-e", prefix + source], capture_output=True, encoding="utf-8", timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        response, trace = result.stdout.splitlines()
        return json.loads(response), json.loads(trace)

    def test_wrong_current_password_and_invalid_input_never_start_passwd(self):
        for values, reason in [({"current": "wrong"}, "current_password_incorrect"),
                               ({"password": "short"}, "invalid_password"),
                               ({"password": "new\npassword"}, "invalid_password"),
                               ({"confirmation": "different"}, "password_mismatch"),
                               ({"password": "current-password", "confirmation": "current-password"}, "password_unchanged")]:
            response, trace = self.request(**values)
            self.assertEqual(response["error"], reason)
            self.assertFalse(trace["writes"])

    def test_password_goes_only_to_stdin_and_both_existing_sessions_are_revoked(self):
        response, trace = self.request()
        self.assertTrue(response["changed"] and response["sessionsRevoked"])
        self.assertEqual(trace["writes"], ["new-password\n", "new-password\n"])
        self.assertIn(["/bin/passwd root >/dev/null 2>&1", "w"], trace["calls"])
        self.assertIn(["destroy", "first"], trace["calls"])
        self.assertIn(["destroy", "second"], trace["calls"])
        self.assertEqual(trace["calls"].count(["destroy", "first"]), 1)
        self.assertNotIn(["destroy", "unrelated"], trace["calls"])
        self.assertNotIn("new-password", json.dumps(trace["calls"]))

    def test_sessions_created_while_changing_password_are_also_revoked(self):
        response, trace = self.request(concurrent_login=True)
        self.assertTrue(response["changed"] and response["sessionsRevoked"])
        self.assertIn(["destroy", "concurrent"], trace["calls"])
        self.assertEqual(trace["calls"].count(["session", "list"]), 2)

    def test_relist_failure_preserves_password_success_and_reports_incomplete_revocation(self):
        response, trace = self.request(fail_relist=True)
        self.assertTrue(response["changed"])
        self.assertFalse(response["sessionsRevoked"])
        self.assertIn(["destroy", "first"], trace["calls"])

    def test_passwd_failure_is_not_reported_as_a_password_change(self):
        response, trace = self.request(fail_write=True)
        self.assertEqual(response["error"], "password_failed")
        self.assertNotIn(["destroy", "first"], trace["calls"])


if __name__ == "__main__":
    unittest.main()
