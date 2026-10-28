"""为固定版本的地址分配服务安装断链恢复补丁，供固件与仿真共用。"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil


ROOT = Path(__file__).resolve().parent.parent
PATCH = ROOT / "patches/odhcpd/900-keep-configured-interfaces.patch"
REVISION = "5d7be43f8b9dec0eb47e245cfab81108bb131273"


def prepare(package):
    makefile = package / "Makefile"
    text = makefile.read_text(encoding="utf-8")
    if not re.search(rf"(?m)^PKG_SOURCE_VERSION\s*:?=\s*{REVISION}\s*$", text):
        raise ValueError("地址分配服务上游版本已变化，需要重新审核断链恢复补丁")
    # 使用独立修订号，避免仿真安装时仍沿用官方未修正的软件包。
    text, count = re.subn(r"(?m)^PKG_RELEASE\s*:?=\s*1[ \t]*$", "PKG_RELEASE:=2", text)
    if count != 1:
        raise ValueError("地址分配服务修订号已变化，需要重新审核补丁")
    destination = package / "patches" / PATCH.name
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(PATCH, destination)
    makefile.write_text(text, encoding="utf-8", newline="\n")
    return {"revision": REVISION, "release": 2, "patch_sha256": hashlib.sha256(PATCH.read_bytes()).hexdigest()}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("package", type=Path)
    parser.add_argument("--metadata", type=Path)
    args = parser.parse_args()
    metadata = prepare(args.package.resolve())
    if args.metadata:
        args.metadata.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
