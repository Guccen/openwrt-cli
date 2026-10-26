#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
DEVICE=${1:?Usage: simulate.sh DEVICE ROLE PACKAGE.apk}
ROLE=${2:?Missing role}
PACKAGE=${3:?Missing package}
[[ "$PACKAGE" == *.apk && -s "$PACKAGE" ]] || { echo 'An OpenWrt 25.12 router-ui APK is required'; exit 1; }
python3 scripts/qemu_host.py
if [[ ! -d build/simulation-tools/imagebuilder ]]; then
    python3 scripts/simulation-tools.py imagebuilder
fi
# 私钥、测试密码及模拟磁盘仅存在于临时目录，报告单独保存。
export SIM_PASSWORD
SIM_PASSWORD=$(openssl rand -hex 24)
if [[ -n "${GITHUB_ACTIONS:-}" ]]; then printf '::add-mask::%s\n' "$SIM_PASSWORD"; fi
python3 scripts/simulation.py --device "$DEVICE" --role "$ROLE" --package "$PACKAGE"
