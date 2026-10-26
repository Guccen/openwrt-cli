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
mkdir -p "$ROOT/build/downloads"
ln -s "$ROOT/build/downloads" "$SOURCE/dl"
cd "$SOURCE"
./scripts/feeds update -a
./scripts/feeds install -a
make defconfig
python3 "$ROOT/scripts/firmware.py" verify --device "$DEVICE" --role "$ROLE" --source "$SOURCE"
cp .config "$ARTIFACTS/build.config"
cp build-inputs.json "$ARTIFACTS/build-inputs.json"
git diff -- include/target.mk target/linux feeds.conf.default > "$ARTIFACTS/source-changes.patch"

make download -j4 2>&1 | tee "$ARTIFACTS/download.log"
make -j"${BUILD_JOBS:-4}" 2>&1 | tee "$ARTIFACTS/build.log" || make -j1 V=s 2>&1 | tee -a "$ARTIFACTS/build.log"

shopt -s nullglob
if [[ "$DEVICE" == jdcloud-ax1800 ]]; then
    images=(bin/targets/qualcommax/ipq60xx/*.bin)
    (( ${#images[@]} > 0 )) || { echo '未找到 AX1800 固件'; exit 1; }
    cp "${images[@]}" "$ARTIFACTS/"
    manifests=(bin/targets/qualcommax/ipq60xx/*.manifest)
else
    rootfs=(bin/targets/armsr/armv8/*rootfs.tar.gz)
    (( ${#rootfs[@]} == 1 )) || { echo '必须且只能生成一份 N1 根文件系统'; exit 1; }
    cp "${rootfs[0]}" "$ARTIFACTS/"
    manifests=(bin/targets/armsr/armv8/*.manifest)
fi
if (( ${#manifests[@]} > 0 )); then cp "${manifests[@]}" "$ARTIFACTS/"; fi
packages=(bin/packages/*/*/router-ui*.apk bin/packages/*/*/router-ui*.ipk)
(( ${#packages[@]} > 0 )) || { echo '未找到独立前端安装包'; exit 1; }
cp "${packages[@]}" "$ARTIFACTS/"
cp "$ROOT/build/ui-size.json" "$ARTIFACTS/"
echo "固件编译完成：$DEVICE / $ROLE"
