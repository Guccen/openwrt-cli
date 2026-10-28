#!/usr/bin/env bash
# 已缓存的文件也必须校验摘要，下载失败或内容错误时不替换原文件。
set -euo pipefail

URL=${1:?必须指定下载地址}
DIGEST=${2:?必须指定摘要}
TARGET=${3:?必须指定保存路径}
[[ "$DIGEST" =~ ^[0-9a-f]{64}$ ]] || { echo '下载摘要格式无效' >&2; exit 1; }
verify() { printf '%s  %s\n' "$DIGEST" "$1" | sha256sum --check --status; }
if [[ -f "$TARGET" ]] && verify "$TARGET"; then
    printf '命中已校验下载缓存：%s\n' "$(basename -- "$TARGET")"
    exit 0
fi
mkdir -p "$(dirname -- "$TARGET")"
temporary=$(mktemp "$TARGET.XXXXXX")
trap 'rm -f -- "$temporary"' EXIT
curl --fail --location --retry 3 "$URL" -o "$temporary"
verify "$temporary" || { echo '下载文件摘要不匹配' >&2; exit 1; }
mv -f -- "$temporary" "$TARGET"
printf '已下载并校验：%s\n' "$(basename -- "$TARGET")"
