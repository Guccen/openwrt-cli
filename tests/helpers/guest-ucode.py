"""宿主测试通过 SSH 标准输入使用 QEMU 中真实的 ucode。"""
import os
from pathlib import Path
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
from simulation import ssh

if len(sys.argv) != 3 or sys.argv[1] != "-e":
    raise SystemExit("仅接受 -e 和测试脚本")
try:
    result = ssh(os.environ["SIM_ADDRESS"], "ucode -", input=sys.argv[2], capture_output=True, timeout=30)
except subprocess.CalledProcessError as error:
    sys.stdout.write(error.stdout or "")
    sys.stderr.write(error.stderr or "")
    raise SystemExit(error.returncode)
sys.stdout.write(result.stdout)
sys.stderr.write(result.stderr)
