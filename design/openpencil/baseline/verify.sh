#!/usr/bin/env bash
# 视觉回归验收 — 一个批次的「截图对比」入口。
#
# 用法:
#   bash design/openpencil/baseline/verify.sh              # 全量比对
#   bash design/openpencil/baseline/verify.sh --only bills  # 单路由
#
# 退出码: 0 通过 / 1 有差异 / 2 缺少基线
#
# 前提:
#   1. 本地服务已在 8787 运行（npx wrangler dev --port 8787）
#   2. 种子数据已注入（seed/seed.sh），否则 default 态会退化成空态
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
BASE="$REPO/design/openpencil/baseline"

# 1) 服务可达性
code=$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8787/login || echo 000)
if [ "$code" != "200" ]; then
  echo "本地服务不可达 (http://127.0.0.1:8787)。先运行: npx wrangler dev --port 8787" >&2
  exit 2
fi

# 2) 重新拍当前实现
echo "--- capture ---"
python3 "$BASE/capture.py" "$@"

# 3) 与基线比对
echo "--- compare ---"
python3 "$BASE/visual-diff.py" "$@"
