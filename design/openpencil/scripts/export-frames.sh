#!/usr/bin/env bash
# 导出当前 .op 每个 top-level frame 为 PNG 并拷回仓库。
# OpenPencil server 对工作区只读，必须先写入临时目录再复制。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
TMP="$(mktemp -d /tmp/op-export.XXXXXX)"
DEST="${1:-$REPO/design/openpencil/exports/current}"

op export_frames outputDir="$TMP" format=png >/dev/null

mkdir -p "$DEST"
find "$DEST" -name '*.png' -delete
cp "$TMP"/*.png "$DEST"/
find "$TMP" -name '*.png' -delete

echo "exported $(ls -1 "$DEST"/*.png | wc -l | tr -d ' ') frame(s) -> $DEST"
