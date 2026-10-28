#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
DEVICE=${1:?必须指定设备}
ROLE=${2:-router}
WAN=${3:-eth1}
SOURCE="$ROOT/build/openwrt"
ARTIFACTS="$ROOT/build/artifacts"
mkdir -p "$ARTIFACTS"

python3 "$ROOT/scripts/firmware.py" fetch --device "$DEVICE" --role "$ROLE" --wan "$WAN" --source "$SOURCE"
python3 "$ROOT/scripts/firmware.py" prepare --device "$DEVICE" --role "$ROLE" --wan "$WAN" --source "$SOURCE"
cd "$SOURCE"
./scripts/feeds update -a
./scripts/feeds install -a
python3 "$ROOT/scripts/firmware.py" verify-revisions --device "$DEVICE" --source "$SOURCE"
python3 "$ROOT/scripts/firmware.py" prepare-storage --device "$DEVICE" --source "$SOURCE"
make defconfig
# 校验失败时也保留实际解析结果，避免产物只有日志而没有配置。
cp .config "$ARTIFACTS/build.config"
cp build-inputs.json resolved-sources.json "$ARTIFACTS/"
git diff -- include/target.mk target/linux feeds.conf.default package/network/services/odhcpd/Makefile > "$ARTIFACTS/source-changes.patch"
if [[ "$DEVICE" == phicomm-n1 ]]; then
    git -C feeds/packages diff -- utils/btrfs-progs/Makefile > "$ARTIFACTS/n1-storage-tools.patch"
fi
if [[ "$ROLE" == router ]]; then
    cp "$ROOT/patches/odhcpd/900-keep-configured-interfaces.patch" "$ARTIFACTS/odhcpd-link-recovery.patch"
fi
./scripts/diffconfig.sh > "$ARTIFACTS/resolved.config"
python3 "$ROOT/scripts/firmware.py" verify --device "$DEVICE" --role "$ROLE" --source "$SOURCE"
echo "源码与配置检查通过：$DEVICE / $ROLE"
