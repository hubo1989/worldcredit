#!/usr/bin/env bash
# 将 Candidate 页的真实样例 frame 复制到 Comparisons 页的 Candidate 槽位。
# build-all.sh 每次重建比较页后调用，因此无需手工导入且可重复执行。
set -euo pipefail

readonly CANDIDATE_PAGE='13 · Candidates'
readonly COMPARISON_PAGE='90 · Comparisons'
readonly CANDIDATE_HEAD='candidate.mobile.dashboard · 390×844'
readonly PREVIEW_NAME='comparison.preview · candidate.mobile.dashboard · 390×844'

page_id() {
  local page_name="$1"
  op page list | python3 -c '
import json, sys
name = sys.argv[1]
pages = json.load(sys.stdin).get("pages", [])
match = [p for p in pages if p.get("name") == name]
if len(match) != 1:
    raise SystemExit(f"expected one page named {name!r}, found {len(match)}")
print(match[0]["id"])
' "$page_name"
}

node_id() {
  local page="$1" depth="$2" selector="$3" mode="$4"
  op get --page "$page" --depth "$depth" | python3 -c '
import json, sys
selector, mode = sys.argv[1:]
data = json.load(sys.stdin)
roots = data.get("nodes", data if isinstance(data, list) else [])
found = []
def walk(node):
    if not isinstance(node, dict): return
    name = str(node.get("name") or "")
    if (mode == "prefix" and name.startswith(selector)) or (mode == "exact" and name == selector):
        found.append(node)
    for child in node.get("children") or []:
        walk(child)
for node in roots: walk(node)
if len(found) != 1:
    raise SystemExit(f"expected one {mode} node {selector!r}, found {len(found)}")
print(found[0]["id"])
' "$selector" "$mode"
}

candidate_page="$(page_id "$CANDIDATE_PAGE")"
comparison_page="$(page_id "$COMPARISON_PAGE")"
candidate_frame="$(node_id "$candidate_page" 1 "$CANDIDATE_HEAD" prefix)"
candidate_slot="$(node_id "$comparison_page" 6 'slot / Candidate' exact)"

copy_result="$(op copy "$candidate_frame" --parent "$candidate_slot" --page "$comparison_page")"
copy_id="$(printf '%s' "$copy_result" | python3 -c '
import json, sys
obj = json.load(sys.stdin)
if isinstance(obj, dict):
    if obj.get("id"): print(obj["id"]); raise SystemExit(0)
    nodes = obj.get("nodes", [])
    if len(nodes) == 1 and nodes[0].get("id"): print(nodes[0]["id"]); raise SystemExit(0)
raise SystemExit("op copy did not return one copied node id")
')"
op update "$copy_id" "{\"name\":\"$PREVIEW_NAME\"}" --page "$comparison_page" >/dev/null

echo "attached $PREVIEW_NAME to $COMPARISON_PAGE"
