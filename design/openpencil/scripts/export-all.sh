#!/usr/bin/env bash
# 按页面角色导出母版 PNG：Current / Candidate / Comparisons 分目录保存。
# 默认写入 design/openpencil/exports，可用 OPENPENCIL_EXPORT_ROOT 指定隔离目录。
# 不清理导出目录，避免误删人工导入或其他页面的 PNG。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
EXPORT_ROOT="${OPENPENCIL_EXPORT_ROOT:-$REPO/design/openpencil/exports}"

# 只请求一次页面清单，保证本轮页面索引与名称使用同一快照。
PAGES_JSON="$(op page list)"
PAGE_ROWS=()
while IFS= read -r row; do PAGE_ROWS+=("$row"); done < <(printf '%s' "$PAGES_JSON" | python3 -c '
import json, sys
pages = json.load(sys.stdin).get("pages", [])
for page in pages:
    name = str(page.get("name", ""))
    page_id = str(page.get("id", ""))
    if not name or not page_id or "\t" in name or "\n" in name:
        raise SystemExit(f"invalid page metadata: {page!r}")
    print(f"{name}\t{page_id}")
')

if [ "${#PAGE_ROWS[@]}" -eq 0 ]; then
  echo "no OpenPencil pages found" >&2
  exit 1
fi

for i in "${!PAGE_ROWS[@]}"; do
  IFS=$'\t' read -r name page_id <<<"${PAGE_ROWS[$i]}"
  case "$name" in
    "13 · Candidates") DEST="$EXPORT_ROOT/candidate" ;;
    "90 · Comparisons") DEST="$EXPORT_ROOT/comparisons" ;;
    *) DEST="$EXPORT_ROOT/current" ;;
  esac

  if ! n="$(op get --page "$page_id" --depth 1 \
      | python3 -c "import sys,json;print(len([n for n in json.load(sys.stdin)['nodes'] if n['name']!='Frame']))")"; then
    printf 'failed to inspect OpenPencil page %s (%s)\n' "$name" "$page_id" >&2
    exit 1
  fi
  if [[ ! "$n" =~ ^[0-9]+$ ]]; then
    printf 'invalid node count for OpenPencil page %s (%s): %s\n' "$name" "$page_id" "$n" >&2
    exit 1
  fi
  if [ "$n" = "0" ]; then echo "skip  $name (empty)"; continue; fi

  mkdir -p "$DEST"
  op set_active_page index="$i" >/dev/null
  TMP="$(mktemp -d /tmp/op-export.XXXXXX)"
  op export_frames outputDir="$TMP" format=png >/dev/null
  python3 - "$TMP" "$DEST" "$i" "$name" <<'PYTHON'
import os
import shutil
import sys

tmp, dest, idx, name = sys.argv[1:]
files = sorted(f for f in os.listdir(tmp) if f.endswith('.png'))
for filename in files:
    target = os.path.join(dest, f"{idx}-{name}-{filename}")
    shutil.copyfile(os.path.join(tmp, filename), target)
if not files:
    raise SystemExit(f"no PNG frames exported for {name}")
PYTHON
  rm -rf "$TMP"
  relative_dest="${DEST#"$EXPORT_ROOT"/}"
  echo "ok    $name ($n frame) -> $relative_dest"
done

for role in current candidate comparisons; do
  dir="$EXPORT_ROOT/$role"
  count=0
  if [ -d "$dir" ]; then
    count="$(find "$dir" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
  fi
  echo "total $role: $count png"
done
