"""下载并验证固定版本的模拟工具，仅在 Linux 中解压和使用。"""

import argparse
import hashlib
import json
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOCK = json.loads((ROOT / "configs/simulation.json").read_text(encoding="utf-8"))


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def download(kind):
    item = LOCK[kind]
    cache = ROOT / ".cache/simulation-downloads"
    cache.mkdir(parents=True, exist_ok=True)
    archive = cache / item["file"]
    if not archive.is_file() or digest(archive) != item["sha256"]:
        temporary = archive.with_suffix(".download")
        urllib.request.urlretrieve(LOCK["base_url"] + item["file"], temporary)
        if digest(temporary) != item["sha256"]:
            temporary.unlink()
            raise ValueError(f"SHA-256 校验失败：{item['file']}")
        temporary.replace(archive)
    destination = ROOT / "build/simulation-tools" / kind
    if destination.exists():
        raise ValueError(f"请使用干净的模拟工具目录：{destination}")
    destination.mkdir(parents=True)
    subprocess.run(["tar", "--zstd", "-xf", str(archive), "--strip-components=1", "-C", str(destination)], check=True)
    print(f"已校验并解压：{kind} / OpenWrt {LOCK['version']}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind", choices=("sdk", "imagebuilder"))
    download(parser.parse_args().kind)
