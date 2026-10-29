#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
DEVICE=${1:?必须指定设备}
ROLE=${2:-router}
WAN=${3:-eth1}
SOURCE="$ROOT/build/openwrt"
ARTIFACTS="$ROOT/build/artifacts"
mkdir -p "$ARTIFACTS"
# 缓存独立于干净源码目录；按编译器内容校验，避免重新生成工具链后因时间戳变化全部失效。
CACHE="$ROOT/build/ccache"
mkdir -p "$CACHE"
export CCACHE_COMPILERCHECK=content
export CCACHE_MAXSIZE=2G
# 通过构建参数启用隐藏的缓存选项，不开启开发模式，也不复用旧镜像或暂存目录。
MAKE_CACHE=(CONFIG_CCACHE=y "CONFIG_CCACHE_DIR=$CACHE")
cache_stats() {
    local compiler="$SOURCE/staging_dir/host/bin/ccache"
    if [[ -x "$compiler" ]]; then
        CCACHE_DIR="$CACHE" "$compiler" --show-stats > "$ARTIFACTS/ccache-stats.txt" 2>&1 || true
        cat "$ARTIFACTS/ccache-stats.txt"
    fi
}
trap cache_stats EXIT

bash "$ROOT/scripts/configure-firmware.sh" "$DEVICE" "$ROLE" "$WAN" 2>&1 | tee "$ARTIFACTS/configure.log"
mkdir -p "$ROOT/build/downloads"
ln -s "$ROOT/build/downloads" "$SOURCE/dl"
cd "$SOURCE"

printf '编译缓存已启用：%s；容量上限 %s；编译器按内容校验\n' "$CACHE" "$CCACHE_MAXSIZE"
make "${MAKE_CACHE[@]}" download -j"${DOWNLOAD_JOBS:-8}" 2>&1 | tee "$ARTIFACTS/download.log"
make "${MAKE_CACHE[@]}" -j"${BUILD_JOBS:-$(nproc)}" 2>&1 | tee "$ARTIFACTS/build.log" || make "${MAKE_CACHE[@]}" -j1 V=s 2>&1 | tee -a "$ARTIFACTS/build.log"

python3 "$ROOT/scripts/collect_artifacts.py" --source "$SOURCE" --output "$ARTIFACTS" --device "$DEVICE"
cp "$ROOT/build/ui-size.json" "$ARTIFACTS/"
echo "固件编译完成：$DEVICE / $ROLE"
