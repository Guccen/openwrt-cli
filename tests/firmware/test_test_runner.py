"""检查严格测试入口不会把缺失依赖或跳过测试报告为通过。"""

import io
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import check_firmware_tests


class FirmwareRunnerTests(unittest.TestCase):
    def test_strict_runner_rejects_skips_and_local_runner_allows_them(self):
        def skipped():
            raise unittest.SkipTest("模拟缺失依赖")
        for strict, expected in [(False, 0), (True, 1)]:
            suite = unittest.TestSuite([unittest.FunctionTestCase(skipped)])
            self.assertEqual(check_firmware_tests.run_suite(suite, strict=strict, stream=io.StringIO()), expected)

    def test_strict_preflight_requires_interpreter_and_preserves_command_arguments(self):
        with patch.dict(os.environ, {"UCODE_TEST_COMMAND": ""}), patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(RuntimeError, "ucode"):
                check_firmware_tests.verify_ucode()
        with patch.dict(os.environ, {"UCODE_TEST_COMMAND": "node fixture.cjs"}), patch("subprocess.run") as run:
            check_firmware_tests.verify_ucode()
            self.assertEqual(run.call_args.args[0][:3], ["node", "fixture.cjs", "-e"])
            self.assertTrue(run.call_args.kwargs["check"])
