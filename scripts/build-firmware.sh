#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
DEVICE=${1:?必须指定设备}
ROLE=${2:-router}
WAN=${3:-eth1}
SOURCE="$ROOT/build/openwrt"
ARTIFACTS="$ROOT/build/artifacts"
mkdir -p "$ARTIFACTS"

bash "$ROOT/scripts/configure-firmware.sh" "$DEVICE" "$ROLE" "$WAN" 2>&1 | tee "$ARTIFACTS/configure.log"
mkdir -p "$ROOT/build/downloads"
ln -s "$ROOT/build/downloads" "$SOURCE/dl"
cd "$SOURCE"

make download -j4 2>&1 | tee "$ARTIFACTS/download.log"
make -j"${BUILD_JOBS:-4}" 2>&1 | tee "$ARTIFACTS/build.log" || make -j1 V=s 2>&1 | tee -a "$ARTIFACTS/build.log"

python3 "$ROOT/scripts/collect_artifacts.py" --source "$SOURCE" --output "$ARTIFACTS" --device "$DEVICE"
cp "$ROOT/build/ui-size.json" "$ARTIFACTS/"
echo "固件编译完成：$DEVICE / $ROLE"
