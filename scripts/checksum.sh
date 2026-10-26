#!/usr/bin/env bash
set -euo pipefail
cd -- "${1:?必须指定产物目录}"
shopt -s nullglob
files=(*.bin *.img.gz *.tar.gz *.apk *.ipk)
(( ${#files[@]} > 0 )) || { echo '没有可校验的构建产物'; exit 1; }
sha256sum -- "${files[@]}" > sha256sums
