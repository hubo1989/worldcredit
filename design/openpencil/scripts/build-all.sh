#!/usr/bin/env bash
# 全量重建 single-source .op：清空每个设计页后按脚本重放。
# 幂等：重复执行结果一致。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
OP_FILE="$REPO/design/openpencil/worldcredit-redesign.op"
S="$REPO/design/openpencil/scripts"

PAGES=("00 · Foundations" "01 · Components" "10 · Mobile Core" "11 · Mobile Details" "12 · Mobile Extended" "13 · Candidates" "20 · Auth & Public" "30 · Admin" "90 · Comparisons")

index_of() {
  for i in "${!PAGES[@]}"; do
    if [ "${PAGES[$i]}" = "$1" ]; then echo "$i"; return 0; fi
  done
  echo "unknown page: $1" >&2; return 1
}

clear_page() {
  local idx="$1"
  op set_active_page index="$idx" >/dev/null
  local ids
  ids="$(op get --page "$(page_id "$idx")" --depth 1 2>/dev/null \
    | python3 -c 'import sys,json;print(" ".join(n["id"] for n in json.load(sys.stdin)["nodes"]))' 2>/dev/null || true)"
  for id in $ids; do op delete "$id" >/dev/null 2>&1 || true; done
}

page_id() {
  op page list | python3 -c "import sys,json;print(json.load(sys.stdin)['pages'][$1]['id'])"
}

build() {
  local page="$1"; shift
  local idx; idx="$(index_of "$page")"
  clear_page "$idx"
  op set_active_page index="$idx" >/dev/null
  for script in "$@"; do
    echo "  -> $script"
    op design "@$S/$script" >/dev/null
  done
}

echo "building $OP_FILE"
build "00 · Foundations"     01-foundations.js
build "01 · Components"      02-components.js 03-review-board.js
build "10 · Mobile Core"     10-mobile-core.js
build "11 · Mobile Details"  11-mobile-details.js
build "12 · Mobile Extended" 12-mobile-extended.js
build "13 · Candidates"     13-candidates.js
build "20 · Auth & Public"   20-auth-public.js
build "30 · Admin"           30-admin.js
build "90 · Comparisons"     90-comparisons.js
echo "  -> attach Candidate sample preview"
bash "$S/attach-candidate-preview.sh"
echo "saving $OP_FILE"
op save_document filePath="$OP_FILE" >/dev/null
echo "done"
