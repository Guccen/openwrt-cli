#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
python3 scripts/simulation-tools.py sdk
SDK="$ROOT/build/simulation-tools/sdk"
mkdir -p build/simulation-package
cp -a build/router-ui "$SDK/package/router-ui"
# SDK 固定到发行提交的 base/packages feeds；packages 仅提供 coreutils-timeout。
# 不拉取 LuCI，也不编译整套固件。
awk '$0 ~ /^src-git.* (base|packages) / { print }' "$SDK/feeds.conf.default" > "$SDK/feeds.conf"
test -s "$SDK/feeds.conf"
(cd "$SDK" && ./scripts/feeds update -a && ./scripts/feeds install uhttpd rpcd jsonfilter ucode coreutils odhcpd)
# 仿真必须安装与固件相同的中继修正版，不能继续使用官方预编译包。
ODHCPD="$SDK/package/network/services/odhcpd"
if [[ ! -f "$ODHCPD/Makefile" ]]; then ODHCPD="$SDK/package/feeds/base/odhcpd"; fi
python3 scripts/odhcpd_patch.py "$ODHCPD" --metadata build/simulation-package/odhcpd-inputs.json
cat > "$SDK/.config" <<'EOF'
# CONFIG_ALL is not set
# CONFIG_ALL_KMODS is not set
# CONFIG_ALL_NONSHARED is not set
CONFIG_PACKAGE_router-ui=m
CONFIG_PACKAGE_odhcpd-ipv6only=m
EOF
make -C "$SDK" defconfig
make -C "$SDK" package/router-ui/compile -j2 V=s 2>&1 | tee build/simulation-package/build.log
make -C "$SDK" "${ODHCPD#"$SDK/"}/compile" -j2 V=s 2>&1 | tee build/simulation-package/odhcpd-build.log
mapfile -d '' packages < <(find "$SDK/bin/packages" -type f -name 'router-ui-*.apk' -print0)
(( ${#packages[@]} == 1 )) || { echo 'Expected exactly one router-ui APK'; exit 1; }
"$SDK/staging_dir/host/bin/apk" adbdump "${packages[0]}" > build/simulation-package/metadata.yaml
grep -Eq '^[[:space:]]*arch: "?noarch"?[[:space:]]*$' build/simulation-package/metadata.yaml || {
    echo 'The static UI package must have noarch architecture'; exit 1;
}
cp "${packages[0]}" build/simulation-package/router-ui.apk
mapfile -d '' relay_packages < <(find "$SDK/bin/packages" -type f -name 'odhcpd-ipv6only-*.apk' -print0)
(( ${#relay_packages[@]} == 1 )) || { echo '必须生成唯一的中继修正版安装包'; exit 1; }
"$SDK/staging_dir/host/bin/apk" adbdump "${relay_packages[0]}" > build/simulation-package/odhcpd-metadata.yaml
grep -Eq '^[[:space:]]*arch: "?aarch64_generic"?[[:space:]]*$' build/simulation-package/odhcpd-metadata.yaml || {
    echo '中继修正版必须采用通用仿真平台架构'; exit 1;
}
cp "${relay_packages[0]}" build/simulation-package/odhcpd-ipv6only.apk
cp patches/odhcpd/900-keep-configured-interfaces.patch build/simulation-package/
sha256sum build/simulation-package/*.apk > build/simulation-package/SHA256SUMS
