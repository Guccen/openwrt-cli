#!/usr/bin/env bash
# 仅在 CI 准备小型宿主解释器，不构建设备固件或交叉工具链。
set -euo pipefail
revision=a2c42eac6369a0bba0315007c7dc7b7130275340
root="${RUNNER_TEMP:?此脚本仅用于 CI}/router-ui-ucode"
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends cmake ninja-build libjson-c-dev pkg-config
mkdir -p "$root/source"
git -C "$root/source" init -q
git -C "$root/source" fetch -q --depth 1 https://github.com/jow-/ucode.git "$revision"
git -C "$root/source" checkout -q --detach FETCH_HEAD
test "$(git -C "$root/source" rev-parse HEAD)" = "$revision"
cmake -S "$root/source" -B "$root/build" -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX="$root/install"
cmake --build "$root/build" --parallel 2
cmake --install "$root/build"
export LD_LIBRARY_PATH="$root/install/lib:${LD_LIBRARY_PATH:-}"
"$root/install/bin/ucode" -e 'import { readfile } from "fs"; if (!readfile("/etc/os-release")) exit(1);'
printf '%s\n' "$root/install/bin" >> "$GITHUB_PATH"
printf 'LD_LIBRARY_PATH=%s\n' "$LD_LIBRARY_PATH" >> "$GITHUB_ENV"
