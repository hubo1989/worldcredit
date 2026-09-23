#!/usr/bin/env bash
# 登记基线截图，供 90 · Comparisons 并排评审使用。
#
# 为什么不直接写进 .op：
#   OpenPencil server 运行在沙箱里，读不到工作区内的本地文件。
#   `{type:"image", src:"/abs/path.png"}` 或 file:// 都渲染成占位图（已实测）。
#   要让位图真正显示，src 必须是 server 能访问的 URL。
#
# 因此本脚本只生成 manifest；把基线放进画布有两种可靠路径：
#   1. 用 OpenPencil 桌面端手工拖入（GUI 走的是原生文件通道）
#   2. 把截图放到可访问的 URL，再用 image 节点的 src 引用
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
SHOTS="$REPO/design/openpencil/baseline/shots"

if [ ! -d "$SHOTS" ]; then
  echo "先跑 capture.py 生成基线截图" >&2
  exit 1
fi

python3 - "$SHOTS" "$REPO/design/openpencil/baseline/manifest.json" <<'PY'
import json, os, sys, time
shots, out = sys.argv[1], sys.argv[2]
entries = []
for root, _, files in os.walk(shots):
    for f in sorted(files):
        if not f.endswith('.png'):
            continue
        full = os.path.join(root, f)
        rel = os.path.relpath(full, shots)
        parts = rel.split(os.sep)
        entries.append({
            "route": parts[0] if len(parts) > 1 else "",
            "state": os.path.splitext(parts[-1])[0],
            "path": os.path.relpath(full, os.path.dirname(os.path.dirname(shots))),
            "bytes": os.path.getsize(full),
        })
json.dump({
    "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    "count": len(entries),
    "entries": entries,
    "note": "基线截图为只读参照。放进 .op 需用桌面端手工拖入，或改为可访问的 URL；本地绝对路径无法渲染。",
}, open(out, 'w'), ensure_ascii=False, indent=2)
print(f"registered {len(entries)} screenshots -> manifest.json")
PY
