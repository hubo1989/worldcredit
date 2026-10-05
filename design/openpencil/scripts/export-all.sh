#!/usr/bin/env bash
# 按 frame 角色导出母版 PNG：Current / Candidate / Comparisons 分目录保存。
# 默认写入 design/openpencil/exports，可用 OPENPENCIL_EXPORT_ROOT 指定隔离目录。
# 不清理导出目录，避免误删人工导入或其他页面的 PNG。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
EXPORT_ROOT="${OPENPENCIL_EXPORT_ROOT:-$REPO/design/openpencil/exports}"
TMP_ROOT="$(mktemp -d /tmp/op-export.XXXXXX)"
trap 'rm -rf "$TMP_ROOT"' EXIT

# 只请求一次页面清单。先完整解析成功，再开始任何页面导出，避免进程替换
# 隐藏解析器的非零退出码并继续使用它已经输出的部分清单。
if ! PAGES_JSON="$(op page list)"; then
  echo "failed to list OpenPencil pages" >&2
  exit 1
fi
if ! PAGE_ROWS_TEXT="$(printf '%s' "$PAGES_JSON" | python3 -c '
import json, sys

manifest = json.load(sys.stdin)
pages = manifest.get("pages") if isinstance(manifest, dict) else None
if not isinstance(pages, list):
    raise SystemExit("invalid page manifest: expected a pages array")

rows = []
for page in pages:
    if not isinstance(page, dict):
        raise SystemExit(f"invalid page metadata: {page!r}")
    name = page.get("name")
    page_id = page.get("id")
    if (not isinstance(name, str) or not name.strip()
            or not isinstance(page_id, str) or not page_id.strip()
            or any(char in name or char in page_id for char in "\t\r\n")):
        raise SystemExit(f"invalid page metadata: {page!r}")
    rows.append(f"{name}\t{page_id}")

print("\n".join(rows), end="" if not rows else "\n")
')"; then
  echo "failed to parse OpenPencil page manifest" >&2
  exit 1
fi

PAGE_ROWS=()
if [[ -n "$PAGE_ROWS_TEXT" ]]; then
  while IFS= read -r row; do PAGE_ROWS+=("$row"); done <<<"$PAGE_ROWS_TEXT"
fi
if [ "${#PAGE_ROWS[@]}" -eq 0 ]; then
  echo "no OpenPencil pages found" >&2
  exit 1
fi

for i in "${!PAGE_ROWS[@]}"; do
  IFS=$'\t' read -r name page_id <<<"${PAGE_ROWS[$i]}"
  case "$name" in
    "13 · Candidates") role="candidate"; include_all_frames=1 ;;
    "90 · Comparisons") role="comparisons"; include_all_frames=1 ;;
    *) role="current"; include_all_frames=0 ;;
  esac

  if ! PAGE_JSON="$(op get --page "$page_id" --depth 1)"; then
    printf 'failed to inspect OpenPencil page %s (%s)\n' "$name" "$page_id" >&2
    exit 1
  fi
  if ! FRAME_ROWS_TEXT="$(printf '%s' "$PAGE_JSON" | python3 -c '
import json, sys

page = json.load(sys.stdin)
nodes = page.get("nodes") if isinstance(page, dict) else None
if not isinstance(nodes, list):
    raise SystemExit("invalid page data: expected a nodes array")
include_all_frames = sys.argv[1] == "1"
frames = []
for node in nodes:
    if not isinstance(node, dict):
        raise SystemExit(f"invalid node metadata: {node!r}")
    name = node.get("name")
    if name == "Frame":
        continue
    node_type = node.get("type")
    if not isinstance(node_type, str) or node_type.lower() != "frame":
        continue
    frame_id = node.get("id")
    if (not isinstance(name, str) or not name.strip()
            or not isinstance(frame_id, str) or not frame_id.strip()
            or any(char in name or char in frame_id for char in "\t\r\n")):
        raise SystemExit(f"invalid frame metadata: {node!r}")
    if include_all_frames or name.startswith("screen."):
        frames.append((frame_id, name))

print("\n".join(f"{frame_id}\t{name}" for frame_id, name in frames),
      end="" if not frames else "\n")
' "$include_all_frames")"; then
    printf 'failed to parse frames on OpenPencil page %s (%s)\n' "$name" "$page_id" >&2
    exit 1
  fi

  FRAME_ROWS=()
  if [[ -n "$FRAME_ROWS_TEXT" ]]; then
    while IFS= read -r row; do FRAME_ROWS+=("$row"); done <<<"$FRAME_ROWS_TEXT"
  fi
  if [ "${#FRAME_ROWS[@]}" -eq 0 ]; then
    if [ "$role" = "current" ]; then
      echo "skip  $name (no screen.* Current frames)"
    else
      echo "skip  $name (empty)"
    fi
    continue
  fi

  DEST="$EXPORT_ROOT/$role"
  mkdir -p "$DEST"
  for frame_index in "${!FRAME_ROWS[@]}"; do
    IFS=$'\t' read -r frame_id frame_name <<<"${FRAME_ROWS[$frame_index]}"
    TMP_FRAME="$TMP_ROOT/frame-$i-$frame_index.png"
    if ! op export --item "$frame_id" --output "$TMP_FRAME" --format png >/dev/null; then
      printf 'failed to export OpenPencil frame %s (%s) on page %s\n' \
        "$frame_name" "$frame_id" "$name" >&2
      exit 1
    fi
    if [ ! -s "$TMP_FRAME" ]; then
      printf 'OpenPencil export produced no PNG for frame %s (%s) on page %s\n' \
        "$frame_name" "$frame_id" "$name" >&2
      exit 1
    fi

    python3 - "$TMP_FRAME" "$DEST" "$i" "$name" "$frame_index" "$frame_name" <<'PYTHON'
import os
import shutil
import sys

source, dest, page_index, page_name, frame_index, frame_name = sys.argv[1:]
def safe_component(value: str) -> str:
    return value.replace('/', '_').replace('\\', '_')

target = os.path.join(
    dest,
    f"{page_index}-{safe_component(page_name)}-{frame_index}-{safe_component(frame_name)}.png",
)
shutil.copyfile(source, target)
PYTHON
  done

  relative_dest="${DEST#"$EXPORT_ROOT"/}"
  printf 'ok    %s (%s frame%s) -> %s\n' \
    "$name" "${#FRAME_ROWS[@]}" "$([ "${#FRAME_ROWS[@]}" -eq 1 ] && echo '' || echo 's')" "$relative_dest"
done

for role in current candidate comparisons; do
  dir="$EXPORT_ROOT/$role"
  count=0
  if [ -d "$dir" ]; then
    count="$(find "$dir" -maxdepth 1 -type f -name '*.png' | wc -l | tr -d ' ')"
  fi
  echo "total $role: $count png"
done
