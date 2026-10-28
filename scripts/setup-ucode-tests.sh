#!/usr/bin/env bash
# 使用固件锁定版本的解释器验证设备脚本，不修改宿主机的全局安装。
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
REVISION=85922056ef7abeace3cca3ab28bc1ac2d88e31b1
SOURCE="$ROOT/build/test-tools/ucode-source"
BUILD="$ROOT/build/test-tools/ucode-build"
PREFIX="$ROOT/build/test-tools/ucode"
mkdir -p "$SOURCE"
if [[ ! -d "$SOURCE/.git" ]]; then git -C "$SOURCE" init; fi
git -C "$SOURCE" fetch --depth 1 https://github.com/jow-/ucode.git "$REVISION"
git -C "$SOURCE" checkout --detach "$REVISION"
[[ "$(git -C "$SOURCE" rev-parse HEAD)" == "$REVISION" ]] || exit 1
cmake -S "$SOURCE" -B "$BUILD" \
    -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$PREFIX" \
    -DCMAKE_INSTALL_LIBDIR=lib -DCMAKE_INSTALL_RPATH="$PREFIX/lib" \
    -DFS_SUPPORT=ON -DDEBUG_SUPPORT=OFF -DIO_SUPPORT=OFF \
    -DMATH_SUPPORT=OFF -DUBUS_SUPPORT=OFF -DUCI_SUPPORT=OFF \
    -DRTNL_SUPPORT=OFF -DNL80211_SUPPORT=OFF -DRESOLV_SUPPORT=OFF \
    -DSTRUCT_SUPPORT=OFF -DULOOP_SUPPORT=OFF -DLOG_SUPPORT=OFF \
    -DSOCKET_SUPPORT=OFF -DZLIB_SUPPORT=OFF -DDIGEST_SUPPORT=OFF
cmake --build "$BUILD" --parallel 2
cmake --install "$BUILD"
"$PREFIX/bin/ucode" -e 'import { readfile } from "fs"; print("设备脚本测试解释器已就绪\n");'
