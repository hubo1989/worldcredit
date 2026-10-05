#!/usr/bin/env bash
# 将 Candidate 页的真实样例 frame 序列化复制到 Comparisons 页的 Candidate 槽位。
# 使用读回的完整节点树 + op insert，避免 copy 跨页时丢失/拒绝节点 lineage。
# 本脚本不保存文档；只有全量构建和验证成功后 build-all.sh 才会保存。
set -euo pipefail

readonly CANDIDATE_PAGE='13 · Candidates'
readonly COMPARISON_PAGE='90 · Comparisons'
readonly CANDIDATE_HEAD='candidate.mobile.dashboard · 390×844'
readonly PREVIEW_NAME='comparison.preview · candidate.mobile.dashboard · 390×844'
readonly PREVIEW_PREFIX='comparison.preview · candidate.mobile.dashboard'

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/wc-candidate-preview.XXXXXX")"
trap 'rm -rf "$TMP_DIR"' EXIT

page_id() {
  local page_name="$1" page_json
  if ! page_json="$(op page list)"; then
    echo "failed to list OpenPencil pages" >&2
    return 1
  fi
  printf '%s' "$page_json" | python3 -c '
import json, sys
name = sys.argv[1]
try:
    pages = json.load(sys.stdin).get("pages")
except (json.JSONDecodeError, AttributeError) as exc:
    raise SystemExit(f"invalid OpenPencil page manifest: {exc}")
if not isinstance(pages, list):
    raise SystemExit("invalid OpenPencil page manifest: expected pages array")
matches = [p for p in pages if isinstance(p, dict) and p.get("name") == name]
if len(matches) != 1:
    raise SystemExit(f"expected one page named {name!r}, found {len(matches)}")
page_id = matches[0].get("id")
if not isinstance(page_id, str) or not page_id.strip():
    raise SystemExit(f"page {name!r} has no valid id")
print(page_id)
' "$page_name"
}

candidate_page="$(page_id "$CANDIDATE_PAGE")"
comparison_page="$(page_id "$COMPARISON_PAGE")"

if ! op get --page "$candidate_page" --depth 1 >"$TMP_DIR/candidate-page.json"; then
  echo "failed to inspect Candidate page ($candidate_page)" >&2
  exit 1
fi
candidate_frame="$(python3 - "$TMP_DIR/candidate-page.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as stream:
    data = json.load(stream)
nodes = data.get("nodes") if isinstance(data, dict) else None
if not isinstance(nodes, list):
    raise SystemExit("invalid Candidate page response: expected nodes array")
matches = [
    node for node in nodes
    if isinstance(node, dict) and node.get("name") == "candidate.mobile.dashboard · 390×844"
]
if len(matches) != 1:
    raise SystemExit(f"expected one Candidate dashboard frame, found {len(matches)}")
node_id = matches[0].get("id")
if not isinstance(node_id, str) or not node_id.strip():
    raise SystemExit("Candidate dashboard frame has no valid id")
print(node_id)
PY
)"

if ! op get --page "$candidate_page" --id "$candidate_frame" --depth 20 >"$TMP_DIR/candidate-frame.json"; then
  echo "failed to read the complete Candidate dashboard subtree ($candidate_frame)" >&2
  exit 1
fi
if ! op get --page "$comparison_page" --depth 8 >"$TMP_DIR/comparison-page.json"; then
  echo "failed to inspect Comparisons page ($comparison_page)" >&2
  exit 1
fi

# 校验源子树和准确目标槽；只删除每个 PenNode 的 editor id，保留其余布局/样式/token。
# read-only lineage/callback 字段不能安全地跨页重建，因此显式拒绝，不静默丢弃。
if ! python3 - \
  "$TMP_DIR/candidate-frame.json" \
  "$TMP_DIR/comparison-page.json" \
  "$TMP_DIR/candidate-preview.json" \
  "$TMP_DIR/preview-metadata.json" \
  "$candidate_frame" \
  "$CANDIDATE_HEAD" \
  "$PREVIEW_NAME" \
  "$PREVIEW_PREFIX" <<'PY'
import copy
import json
import math
import sys

source_path, comparison_path, output_path, metadata_path, expected_id, candidate_name, preview_name, preview_prefix = sys.argv[1:]
READ_ONLY_FIELDS = {"parentId", "pageId", "lineage", "callback", "callbacks", "readOnly"}

def load_nodes(path, label):
    try:
        with open(path, encoding="utf-8") as stream:
            data = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"invalid {label} response: {exc}")
    nodes = data.get("nodes") if isinstance(data, dict) else None
    if not isinstance(nodes, list):
        raise SystemExit(f"invalid {label} response: expected nodes array")
    return nodes

def walk(root, label):
    seen = set()
    count = 0
    stack = [(root, 0)]
    while stack:
        node, depth = stack.pop()
        if not isinstance(node, dict):
            raise SystemExit(f"malformed {label} subtree: every child must be an object")
        count += 1
        if count > 5000:
            raise SystemExit(f"malformed {label} subtree: exceeds 5000 nodes")
        if depth >= 20:
            raise SystemExit(f"malformed {label} subtree: depth limit may have truncated descendants")
        for field in READ_ONLY_FIELDS.intersection(node):
            raise SystemExit(f"unsupported read-only metadata {field!r} in {label} subtree")
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id.strip() or node_id in seen:
            raise SystemExit(f"malformed {label} subtree: missing or duplicate editor id")
        seen.add(node_id)
        children = node.get("children", [])
        if not isinstance(children, list):
            raise SystemExit(f"malformed {label} subtree: children must be an array")
        stack.extend((child, depth + 1) for child in children)
    return seen

def signature(node):
    """Compare the full serialized tree while ignoring only editor-generated ids."""
    if isinstance(node, dict):
        return {key: signature(value) for key, value in node.items() if key != "id"}
    if isinstance(node, list):
        return [signature(value) for value in node]
    return node

def valid_preview(node):
    if not isinstance(node, dict):
        return False
    if node.get("type") != "frame" or node.get("name") != preview_name:
        return False
    if not isinstance(node.get("width"), (int, float)) or not math.isclose(node["width"], 390):
        return False
    if not isinstance(node.get("height"), (int, float)) or not math.isclose(node["height"], 844):
        return False
    return any(
        child.get("type") == "text" and child.get("content") == "概览"
        for child in walk_nodes(node)
    )

def walk_nodes(root):
    stack = [root]
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            continue
        yield node
        children = node.get("children") or []
        if isinstance(children, list):
            stack.extend(reversed(children))

source_roots = load_nodes(source_path, "Candidate frame")
if len(source_roots) != 1:
    raise SystemExit(f"malformed Candidate response: expected one root, found {len(source_roots)}")
source = source_roots[0]
if source.get("id") != expected_id or source.get("name") != candidate_name or source.get("type") != "frame":
    raise SystemExit("Candidate frame identity changed between page lookup and deep read")
if not isinstance(source.get("width"), (int, float)) or not math.isclose(source["width"], 390):
    raise SystemExit("Candidate dashboard must be 390px wide")
if not isinstance(source.get("height"), (int, float)) or not math.isclose(source["height"], 844):
    raise SystemExit("Candidate dashboard must be 844px high")
source_ids = walk(source, "Candidate")
clone = copy.deepcopy(source)
for node in walk_nodes(clone):
    node.pop("id", None)
clone["name"] = preview_name

comparison_roots = load_nodes(comparison_path, "Comparisons page")
slots = [node for root in comparison_roots for node in walk_nodes(root) if node.get("name") == "slot / Candidate"]
if len(slots) != 1:
    raise SystemExit(f"expected one Candidate comparison slot, found {len(slots)}")
slot = slots[0]
slot_id = slot.get("id")
if not isinstance(slot_id, str) or not slot_id.strip() or slot.get("type") != "frame":
    raise SystemExit("Candidate comparison slot has no valid frame id")
if not isinstance(slot.get("height"), (int, float)) or not math.isclose(slot["height"], 844):
    raise SystemExit("Candidate comparison slot must be 844px high")
if not isinstance(slot.get("children", []), list):
    raise SystemExit("Candidate comparison slot children must be an array")
existing = [
    child for child in slot.get("children", [])
    if isinstance(child, dict) and str(child.get("name", "")).startswith(preview_prefix)
]
if len(existing) > 1:
    raise SystemExit(f"Candidate comparison slot has {len(existing)} preview frames; refusing to add another")
if existing:
    if not valid_preview(existing[0]) or signature(existing[0]) != signature(clone):
        raise SystemExit("Candidate comparison slot already contains a stale or malformed preview; run the full build")
    already_attached = True
else:
    already_attached = False
    with open(output_path, "w", encoding="utf-8") as stream:
        json.dump(clone, stream, ensure_ascii=False, separators=(",", ":"))

with open(metadata_path, "w", encoding="utf-8") as stream:
    json.dump({"slot_id": slot_id, "already_attached": already_attached,
               "source_ids": sorted(source_ids)}, stream, ensure_ascii=False)
PY
then
  echo "failed to validate Candidate preview source or comparison destination" >&2
  exit 1
fi

metadata="$(python3 - "$TMP_DIR/preview-metadata.json" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as stream:
    data = json.load(stream)
print(data["slot_id"])
print("1" if data["already_attached"] else "0")
PY
)"
slot_id="$(printf '%s\n' "$metadata" | sed -n '1p')"
already_attached="$(printf '%s\n' "$metadata" | sed -n '2p')"

if [ "$already_attached" = "0" ]; then
  if ! op insert "@$TMP_DIR/candidate-preview.json" --parent "$slot_id" --page "$comparison_page" >/dev/null; then
    echo "failed to insert Candidate preview into slot / Candidate; document not saved" >&2
    exit 1
  fi
fi

# 插入响应本身不作为成功证据：重新读取目标槽，确认父子关系、结构、尺寸和文本。
if ! op get --page "$comparison_page" --id "$slot_id" --depth 24 >"$TMP_DIR/inserted-slot.json"; then
  echo "failed to read Candidate comparison slot after insertion; document not saved" >&2
  exit 1
fi
if ! python3 - \
  "$TMP_DIR/inserted-slot.json" \
  "$TMP_DIR/candidate-preview.json" \
  "$TMP_DIR/candidate-frame.json" \
  "$slot_id" \
  "$CANDIDATE_HEAD" \
  "$PREVIEW_NAME" \
  "$PREVIEW_PREFIX" <<'PY'
import copy
import json
import math
import sys

slot_path, expected_path, source_path, slot_id, candidate_name, preview_name, preview_prefix = sys.argv[1:]
def read_nodes(path, label):
    try:
        with open(path, encoding="utf-8") as stream:
            data = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"invalid {label} response: {exc}")
    nodes = data.get("nodes") if isinstance(data, dict) else None
    if not isinstance(nodes, list):
        raise SystemExit(f"invalid {label} response: expected nodes array")
    return nodes

def walk(root):
    stack = [root]
    seen = set()
    count = 0
    while stack:
        node = stack.pop()
        if not isinstance(node, dict):
            raise SystemExit("inserted subtree contains a non-object child")
        count += 1
        if count > 5000:
            raise SystemExit("inserted subtree exceeds 5000 nodes")
        node_id = node.get("id")
        if not isinstance(node_id, str) or not node_id.strip() or node_id in seen:
            raise SystemExit("inserted subtree has missing or duplicate editor ids")
        seen.add(node_id)
        children = node.get("children", [])
        if not isinstance(children, list):
            raise SystemExit("inserted subtree has malformed children")
        stack.extend(children)
    return seen

def signature(node):
    if isinstance(node, dict):
        return {key: signature(value) for key, value in node.items() if key != "id"}
    if isinstance(node, list):
        return [signature(value) for value in node]
    return value_signature(node)

def value_signature(value):
    return value

slot_roots = read_nodes(slot_path, "inserted slot")
if len(slot_roots) != 1 or slot_roots[0].get("id") != slot_id or slot_roots[0].get("name") != "slot / Candidate":
    raise SystemExit("OpenPencil returned the wrong destination slot after insertion")
slot = slot_roots[0]
children = slot.get("children")
if not isinstance(children, list):
    raise SystemExit("Candidate comparison slot has malformed children after insertion")
previews = [child for child in children if isinstance(child, dict) and str(child.get("name", "")).startswith(preview_prefix)]
if len(previews) != 1:
    raise SystemExit(f"expected exactly one inserted Candidate preview, found {len(previews)}")
preview = previews[0]
if preview.get("type") != "frame" or preview.get("name") != preview_name:
    raise SystemExit("inserted Candidate preview has the wrong frame identity")
if not isinstance(preview.get("width"), (int, float)) or not math.isclose(preview["width"], 390):
    raise SystemExit("inserted Candidate preview width is not 390px")
if not isinstance(preview.get("height"), (int, float)) or not math.isclose(preview["height"], 844):
    raise SystemExit("inserted Candidate preview height is not 844px")
# 准备文件是裸 PenNode（op insert 的输入格式），不是 {"nodes": [...]} 包装。
def read_prepared(path, label):
    try:
        with open(path, encoding="utf-8") as stream:
            data = json.load(stream)
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"invalid {label} response: {exc}")
    if isinstance(data, dict) and isinstance(data.get("nodes"), list):
        return data["nodes"]
    if isinstance(data, dict):
        return [data]
    raise SystemExit(f"invalid {label} response: expected nodes array or node object")

expected_roots = read_prepared(expected_path, "prepared Candidate preview")
if len(expected_roots) != 1 or signature(preview) != signature(expected_roots[0]):
    raise SystemExit("inserted Candidate preview differs from the prepared source subtree")
preview_ids = walk(preview)
source_roots = read_nodes(source_path, "Candidate frame")
if len(source_roots) != 1 or source_roots[0].get("name") != candidate_name:
    raise SystemExit("Candidate source changed before destination verification")
source_ids = walk(source_roots[0])
if preview_ids.intersection(source_ids):
    raise SystemExit("inserted Candidate preview reused source editor ids")
def walk_nodes(root):
    stack = [root]
    while stack:
        node = stack.pop()
        yield node
        stack.extend(reversed(node.get("children") or []))

if not any(node.get("type") == "text" and node.get("content") == "概览" for node in walk_nodes(preview)):
    raise SystemExit("inserted Candidate preview is missing the dashboard heading")
PY
then
  echo "Candidate preview destination verification failed; document not saved" >&2
  exit 1
fi

echo "attached and verified $PREVIEW_NAME in $COMPARISON_PAGE"
