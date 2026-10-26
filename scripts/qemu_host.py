"""检查精简安装的 QEMU 能否在没有 PXE ROM 文件时创建模拟设备。"""

import subprocess
import tempfile
from pathlib import Path


def network_device(netdev, mac):
    # 使用 -kernel 直接启动 OpenWrt，不加载网卡的 PXE 启动 ROM。
    return f"virtio-net-pci,netdev={netdev},mac={mac},romfile="


def check_host():
    with tempfile.TemporaryDirectory(prefix="router-qemu-check-") as temp:
        directory = Path(temp)
        disk = directory / "disk.raw"
        with disk.open("wb") as image:
            image.truncate(1024 * 1024)
        # 空 ROM 搜索目录可重现 --no-install-recommends 的运行环境。
        process = subprocess.Popen([
            "qemu-system-aarch64", "-machine", "virt", "-cpu", "cortex-a53", "-accel", "tcg",
            "-m", "64", "-display", "none", "-monitor", "none", "-serial", "none",
            "-nodefaults", "-no-user-config", "-L", str(directory), "-S",
            "-drive", f"file={disk},format=raw,if=virtio",
            "-netdev", "user,id=lan", "-device", network_device("lan", "52:54:00:12:34:01"),
            "-netdev", "user,id=wan", "-device", network_device("wan", "52:54:00:12:34:02"),
            "-object", "rng-random,filename=/dev/urandom,id=rng0", "-device", "virtio-rng-pci,rng=rng0",
        ], stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        try:
            try:
                output, _ = process.communicate(timeout=1)
            except subprocess.TimeoutExpired:
                print("QEMU host check passed: ARM64 TCG, VirtIO disk/NICs/RNG, no PXE ROMs")
            else:
                raise RuntimeError(f"QEMU host check failed (exit {process.returncode}): {output.strip()[:2000]}")
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.communicate(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.communicate(timeout=5)


if __name__ == "__main__":
    check_host()
