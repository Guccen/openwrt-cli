"""收集单设备产物，区分通用目标与 generic 设备的 ARM64 根文件系统。"""

import argparse
import json
import shutil
import tarfile
from pathlib import Path


def collect(source, output, device):
    output.mkdir(parents=True, exist_ok=True)
    target = source / "bin/targets" / ("armsr/armv8" if device == "phicomm-n1" else "qualcommax/ipq60xx")
    inventory = [{"path": item.relative_to(source).as_posix(), "bytes": item.stat().st_size} for item in sorted(target.glob("*")) if item.is_file()]
    # 失败时也保留真实文件名，避免编译一小时后只留下不明确的数量错误。
    (output / "target-files.json").write_text(json.dumps(inventory, indent=2) + "\n", encoding="utf-8")
    if device == "phicomm-n1":
        # 上游同时生成目标级 *-armv8-rootfs 和设备级 *-generic-rootfs。
        # 选择已解析配置指定的 generic 设备，绝不依赖 glob 顺序取第一项。
        images = sorted(target.glob("*-generic-rootfs.tar.gz"))
        if len(images) != 1:
            raise ValueError(f"必须且只能有一份 generic 设备根文件系统，实际 {len(images)} 份；详情见 target-files.json")
        expected = json.loads((source / "files/www/device.json").read_text(encoding="utf-8"))
        with tarfile.open(images[0], "r:gz") as archive:
            entries = [entry for entry in archive if entry.name.removeprefix("./") == "www/device.json"]
            if len(entries) != 1 or not entries[0].isfile() or entries[0].size > 8192:
                raise ValueError("根文件系统缺少唯一的设备标识")
            with archive.extractfile(entries[0]) as stream:
                actual = json.load(stream)
            if actual != expected or actual.get("device") != device:
                raise ValueError("根文件系统的设备、模式或源码版本与本次构建不符")
    else:
        images = sorted(target.glob("*.bin"))
        if not images:
            raise ValueError("未找到 AX1800 固件；详情见 target-files.json")
    packages = sorted((source / "bin/packages").rglob("router-ui-*.apk"))
    if len(packages) != 1:
        raise ValueError(f"必须且只能有一份独立前端 APK，实际 {len(packages)} 份")
    for item in [*images, *target.glob("*.manifest"), *packages]:
        shutil.copy2(item, output / item.name)
    print("已收集：" + "、".join(item.name for item in images))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--device", choices=("jdcloud-ax1800", "phicomm-n1"), required=True)
    args = parser.parse_args()
    collect(args.source.resolve(), args.output.resolve(), args.device)
