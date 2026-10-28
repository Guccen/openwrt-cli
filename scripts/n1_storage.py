"""为使用独立内核的 N1 准备首次启动扩容工具。"""

import hashlib
from pathlib import Path


def prepare(source: Path):
    target = source / "feeds/packages/utils/btrfs-progs/Makefile"
    text = target.read_text(encoding="utf-8")
    dependency = "    +kmod-fs-btrfs \\\n"
    # N1 使用打包器配套的 Btrfs 内核，不能混入通用 ARM64 内核模块。
    if text.count(dependency) != 1 or "PKG_VERSION:=6.11\n" not in text or "PKG_RELEASE:=3\n" not in text:
        raise ValueError("Btrfs 工具的上游结构发生变化，需要重新审核 N1 内核依赖")
    original = hashlib.sha256(text.encode()).hexdigest()
    text = text.replace(dependency, "").replace("PKG_RELEASE:=3\n", "PKG_RELEASE:=4\n")
    target.write_text(text, encoding="utf-8", newline="\n")
    return {"version": "6.11-r4", "original_sha256": original, "kernel": "ophub 配套 Btrfs", "first_boot_expand": "仅标准双分区 USB 根磁盘"}
