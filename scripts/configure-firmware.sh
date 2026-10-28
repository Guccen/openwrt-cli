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
make defconfig
python3 "$ROOT/scripts/firmware.py" verify --device "$DEVICE" --role "$ROLE" --source "$SOURCE"
cp .config "$ARTIFACTS/build.config"
cp build-inputs.json resolved-sources.json "$ARTIFACTS/"
git diff -- include/target.mk target/linux feeds.conf.default package/network/services/odhcpd/Makefile > "$ARTIFACTS/source-changes.patch"
if [[ "$ROLE" == router ]]; then
    cp "$ROOT/patches/odhcpd/900-keep-configured-interfaces.patch" "$ARTIFACTS/odhcpd-link-recovery.patch"
fi
./scripts/diffconfig.sh > "$ARTIFACTS/resolved.config"
echo "源码与配置检查通过：$DEVICE / $ROLE"
