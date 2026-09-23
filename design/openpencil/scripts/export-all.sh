#!/usr/bin/env bash
# 逐页导出全部母版 PNG 到 design/openpencil/exports/current，
# 文件名规范为 <pageIdx>-<pageName>-<frame>.png，便于评审与 diff。
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEST="$REPO/design/openpencil/exports/current"
AUX="$REPO/design/openpencil/scripts/_export-one.sh"

mkdir -p "$DEST"
find "$DEST" -name '*.png' -delete

count=$(op page list | python3 -c "import sys,json;print(json.load(sys.stdin)['pageCount'])")
for i in $(seq 0 $((count - 1))); do
  name=$(op page list | python3 -c "import sys,json;print(json.load(sys.stdin)['pages'][$i]['name'])")
  n=$(op get --page "$(op page list | python3 -c "import sys,json;print(json.load(sys.stdin)['pages'][$i]['id'])")" --depth 1 2>/dev/null \
      | python3 -c "import sys,json;print(len([n for n in json.load(sys.stdin)['nodes'] if n['name']!='Frame']))" 2>/dev/null || echo 0)
  if [ "$n" = "0" ]; then echo "skip  $name (empty)"; continue; fi
  op set_active_page index="$i" >/dev/null
  TMP="$(mktemp -d /tmp/op-export.XXXXXX)"
  op export_frames outputDir="$TMP" format=png >/dev/null
  python3 - "$TMP" "$DEST" "$i" "$name" <<'PY'
import sys, os, shutil
tmp, dest, idx, name = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
files = sorted(f for f in os.listdir(tmp) if f.endswith('.png'))
for f in files:
    shutil.copyfile(os.path.join(tmp, f), os.path.join(dest, f"{idx}-{name}-{f}"))
PY
  find "$TMP" -name '*.png' -delete
  echo "ok    $name ($n frame)"
done

echo "total $(ls -1 "$DEST"/*.png | wc -l | tr -d ' ') png"
