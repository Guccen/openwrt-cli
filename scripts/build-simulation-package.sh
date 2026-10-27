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
(cd "$SDK" && ./scripts/feeds update -a && ./scripts/feeds install uhttpd rpcd jsonfilter ucode coreutils)
cat > "$SDK/.config" <<'EOF'
# CONFIG_ALL is not set
# CONFIG_ALL_KMODS is not set
# CONFIG_ALL_NONSHARED is not set
CONFIG_PACKAGE_router-ui=m
EOF
make -C "$SDK" defconfig
make -C "$SDK" package/router-ui/compile -j2 V=s 2>&1 | tee build/simulation-package/build.log
mapfile -d '' packages < <(find "$SDK/bin/packages" -type f -name 'router-ui-*.apk' -print0)
(( ${#packages[@]} == 1 )) || { echo 'Expected exactly one router-ui APK'; exit 1; }
"$SDK/staging_dir/host/bin/apk" adbdump "${packages[0]}" > build/simulation-package/metadata.yaml
grep -Eq '^[[:space:]]*arch: "?noarch"?[[:space:]]*$' build/simulation-package/metadata.yaml || {
    echo 'The static UI package must have noarch architecture'; exit 1;
}
cp "${packages[0]}" build/simulation-package/router-ui.apk
sha256sum build/simulation-package/router-ui.apk > build/simulation-package/SHA256SUMS
