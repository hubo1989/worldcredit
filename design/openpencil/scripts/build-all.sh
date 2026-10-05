#!/usr/bin/env bash
# 全量重建 single-source .op：先同步 token，再清理目标页并按脚本重放。
# 仅所有页面构建与 Candidate 比较板回读验证通过后，才保存整份文档。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OP_FILE="$REPO/design/openpencil/worldcredit-redesign.op"
FOUNDATIONS_FILE="$REPO/design/openpencil/vars/foundations.json"
FOUNDATIONS_SOURCE='design/openpencil/vars/foundations.json'
S="$REPO/design/openpencil/scripts"

readonly -a PAGES=(
  "00 · Foundations"
  "01 · Components"
  "10 · Mobile Core"
  "11 · Mobile Details"
  "12 · Mobile Extended"
  "13 · Candidates"
  "20 · Auth & Public"
  "30 · Admin"
  "90 · Comparisons"
)

for script in \
  01-foundations.js 02-components.js 03-review-board.js \
  10-mobile-core.js 11-mobile-details.js 12-mobile-extended.js \
  13-candidates.js 20-auth-public.js 30-admin.js 90-comparisons.js \
  attach-candidate-preview.sh; do
  if [ ! -f "$S/$script" ]; then
    echo "missing build input: $S/$script" >&2
    exit 1
  fi
done

if [ ! -f "$FOUNDATIONS_FILE" ]; then
  echo "missing token source: $FOUNDATIONS_FILE" >&2
  exit 1
fi

if ! PAGE_LIST_JSON="$(op page list)"; then
  echo "failed to list OpenPencil pages; document not modified" >&2
  exit 1
fi

page_location() {
  local page_name="$1"
  printf '%s' "$PAGE_LIST_JSON" | python3 -c '
import json, sys
expected = sys.argv[1]
try:
    pages = json.load(sys.stdin).get("pages")
except (json.JSONDecodeError, AttributeError) as exc:
    raise SystemExit(f"invalid OpenPencil page manifest: {exc}")
if not isinstance(pages, list):
    raise SystemExit("invalid OpenPencil page manifest: expected pages array")
matches = [(index, page) for index, page in enumerate(pages)
           if isinstance(page, dict) and page.get("name") == expected]
if len(matches) != 1:
    raise SystemExit(f"expected one page named {expected!r}, found {len(matches)}")
index, page = matches[0]
page_id = page.get("id")
if not isinstance(page_id, str) or not page_id.strip():
    raise SystemExit(f"page {expected!r} has no valid id")
print(f"{index}\t{page_id}")
' "$page_name"
}

# Resolve and validate every target page before the first mutation. Page order may
# change, but each script is bound to its exact named page rather than a fixed index.
# bash 3.2 兼容（macOS 自带 bash 无 declare -A）：平行数组 + 线性查找。
PAGE_INDEX_LIST=()
PAGE_ID_LIST=()
for page in "${PAGES[@]}"; do
  location="$(page_location "$page")"
  PAGE_INDEX_LIST+=("${location%%$'\t'*}")
  PAGE_ID_LIST+=("${location##*$'\t'}")
done

page_meta() {  # name -> "index id"
  local i
  for i in "${!PAGES[@]}"; do
    if [ "${PAGES[$i]}" = "$1" ]; then
      echo "${PAGE_INDEX_LIST[$i]} ${PAGE_ID_LIST[$i]}"
      return 0
    fi
  done
  echo "unknown page: $1" >&2
  return 1
}

FOUNDATIONS_HASH="$(python3 - "$FOUNDATIONS_FILE" <<'PY'
import hashlib
import pathlib
import sys
print(hashlib.sha256(pathlib.Path(sys.argv[1]).read_bytes()).hexdigest())
PY
)"

# Merge the canonical token JSON before clearing any page: candidate/component
# build scripts reference these variables, including newly added neutral tokens.
echo "syncing token variables from $FOUNDATIONS_SOURCE"
op upsert_variables \
  key="tokens:$FOUNDATIONS_SOURCE" \
  variables="$(cat "$FOUNDATIONS_FILE")" \
  sourcePath="$FOUNDATIONS_SOURCE" \
  sourceHash="$FOUNDATIONS_HASH" >/dev/null

tmp_dir="$(mktemp -d "${TMPDIR:-/tmp}/wc-build-all.XXXXXX")"
trap 'rm -rf "$tmp_dir"' EXIT

clear_page() {
  local name="$1" meta index id ids
  meta="$(page_meta "$name")" || return 1
  index="${meta%% *}"
  id="${meta#* }"
  if ! op set_active_page "index=$index" >/dev/null; then
    echo "failed to activate page $name ($id)" >&2
    return 1
  fi
  if ! op get --page "$id" --depth 1 >"$tmp_dir/page-roots.json"; then
    echo "failed to read page $name ($id); build stopped without saving" >&2
    return 1
  fi
  if ! ids="$(python3 - "$tmp_dir/page-roots.json" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as stream:
    data = json.load(stream)
nodes = data.get("nodes") if isinstance(data, dict) else None
if not isinstance(nodes, list):
    raise SystemExit("invalid page response: expected nodes array")
seen = set()
for node in nodes:
    if not isinstance(node, dict):
        raise SystemExit("invalid page response: root node must be an object")
    node_id = node.get("id")
    if not isinstance(node_id, str) or not node_id.strip() or node_id in seen:
        raise SystemExit("invalid page response: missing or duplicate root id")
    seen.add(node_id)
    print(node_id)
PY
)"; then
    echo "failed to validate root nodes on page $name ($id)" >&2
    return 1
  fi
  while IFS= read -r node_id; do
    [ -n "$node_id" ] || continue
    if ! op delete "$node_id" --page "$id" >/dev/null; then
      echo "failed to clear node $node_id from page $name ($id); build stopped without saving" >&2
      return 1
    fi
  done <<<"$ids"
}

build() {
  local page="$1"; shift
  clear_page "$page"
  local meta
  meta="$(page_meta "$page")" || return 1
  if ! op set_active_page "index=${meta%% *}" >/dev/null; then
    echo "failed to activate page $page" >&2
    return 1
  fi
  for script in "$@"; do
    echo "  -> $script"
    op design "@$S/$script" >/dev/null
  done
}

echo "building $OP_FILE"
build "00 · Foundations"     01-foundations.js
build "01 · Components"      02-components.js 03-review-board.js
build "10 · Mobile Core"     10-mobile-core.js
build "11 · Mobile Details" 11-mobile-details.js
build "12 · Mobile Extended" 12-mobile-extended.js
build "13 · Candidates"     13-candidates.js
build "20 · Auth & Public"   20-auth-public.js
build "30 · Admin"           30-admin.js
build "90 · Comparisons"    90-comparisons.js

echo "  -> attach Candidate sample preview"
bash "$S/attach-candidate-preview.sh"
echo "saving $OP_FILE"
op save_document filePath="$OP_FILE" >/dev/null
echo "done"
