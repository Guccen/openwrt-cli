#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
PACKER="$ROOT/.cache/n1-packager"
OVERLAY="$ROOT/build/openwrt/files"
ARTIFACTS="$ROOT/build/artifacts"
ROOTFS=$(realpath "${1:?必须指定根文件系统压缩包}")
[[ -s "$ROOTFS" ]] || { echo '根文件系统为空'; exit 1; }

python3 "$ROOT/scripts/n1_packer.py" prepare --directory "$PACKER" --overlay "$OVERLAY"
read -r KERNEL DIGEST < <(python3 -c 'import json,sys; d=json.load(open(sys.argv[1]))["n1_packager"]; print(d["kernel"],d["kernel_sha256"])' "$ROOT/configs/sources.json")
mkdir -p "$PACKER/openwrt-armsr" "$PACKER/make-openwrt/kernel/stable"
cp "$ROOTFS" "$PACKER/openwrt-armsr/"
ARCHIVE="$PACKER/make-openwrt/kernel/stable/$KERNEL.tar.gz"
curl --fail --location --retry 3 "https://github.com/ophub/kernel/releases/download/kernel_stable/$KERNEL.tar.gz" -o "$ARCHIVE"
printf '%s  %s\n' "$DIGEST" "$ARCHIVE" | sha256sum --check --status
tar -xzf "$ARCHIVE" -C "$PACKER/make-openwrt/kernel/stable"
[[ -d "$PACKER/make-openwrt/kernel/stable/$KERNEL" ]] || { echo '内核压缩包目录不正确'; exit 1; }

ROLE=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["role"])' "$OVERLAY/www/device.json")
ADDRESS=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["address"])' "$OVERLAY/www/device.json")
cd "$PACKER"
sudo env ROUTER_LITE_ROOT="$ROOT" ROUTER_LITE_PACKER="$PACKER" ROUTER_LITE_OVERLAY="$OVERLAY" \
    bash ./remake -b s905d -k "$KERNEL" -a false -s 256/1024 -p "$ADDRESS" -n router-lite

shopt -s nullglob
images=("$PACKER"/openwrt/out/*s905d*.img.gz)
(( ${#images[@]} == 1 )) || { echo '必须且只能生成一份 N1 镜像'; exit 1; }
cp "${images[0]}" "$ARTIFACTS/phicomm-n1-$ROLE-k$KERNEL.img.gz"
cp "$PACKER/router-lite-inputs.json" "$ARTIFACTS/n1-packager-inputs.json"
