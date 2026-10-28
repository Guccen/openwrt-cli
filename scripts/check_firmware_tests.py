"""运行固件单测，严格模式要求真实解释器且不允许静默跳过。"""

import argparse
import os
from pathlib import Path
import shlex
import shutil
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]


def verify_ucode():
    command = shlex.split(os.environ.get("UCODE_TEST_COMMAND", ""))
    if not command:
        executable = shutil.which("ucode")
        if not executable:
            raise RuntimeError("严格检查需要 ucode，请先配置 UCODE_TEST_COMMAND")
        command = [executable]
    subprocess.run([*command, "-e", 'import { readfile } from "fs"; print("ucode-ready");'],
                   check=True, capture_output=True, text=True, timeout=15)


def run_suite(suite, *, strict=False, stream=None):
    result = unittest.TextTestRunner(verbosity=2, stream=stream).run(suite)
    if strict and result.skipped:
        print("严格检查失败：有固件测试被跳过", file=stream or sys.stderr)
        return 1
    return 0 if result.wasSuccessful() else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strict", action="store_true", help="必须具备真实解释器且所有测试均不能跳过")
    args = parser.parse_args()
    if args.strict:
        verify_ucode()
    suite = unittest.defaultTestLoader.discover(str(ROOT / "tests/firmware"))
    return run_suite(suite, strict=args.strict)


if __name__ == "__main__":
    raise SystemExit(main())
