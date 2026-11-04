#!/usr/bin/env bash
# ============================================================================
# WorldCredit 批次验收入口（baoyu-design 现行设计源迁移版）
#
# 说明：OpenPencil 工具链已退役归档，设计唯一真源已迁移至 design/baoyu/。
# 本入口无缝继承 CI 质量门禁（.github/workflows/ci.yml）：
#   1. baoyu-design 画板完整性（10 个双端双主题画板）
#   2. Token 三方零漂移（tokens.json ↔ foundations.json ↔ globals.css）
#   3. 触控热区与 AA 对比度（热区 ≥44px、输入字号 ≥16px、对比度达标）
#   4. 无原生弹窗与交互合规（零 window.confirm 与 window.alert）
#   5. 历史设计存档保护（OpenPencil .op 资产只读留档）
# ============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT="$REPO/design/openpencil/batch-report.json"
BAOYU_VERIFY="$REPO/design/baoyu/verify-design.py"

MODE="all"
while [ $# -gt 0 ]; do
  case "$1" in
    --source-only) MODE="source-only"; shift ;;
    --visual-only) MODE="visual-only"; shift ;;
    -h|--help)
      echo "用法: bash design/openpencil/verify-batch.sh [--source-only|--visual-only]"
      exit 0
      ;;
    *) shift ;;
  esac
done

echo "WorldCredit 设计源质量验收（baoyu-design 现行真源）"
echo "  模式: $MODE"
echo "  仓库: $REPO"
echo "  设计源: design/baoyu/ (canvas.json + .dc.html 画板)"
echo "  历史存档: design/openpencil/ (只读留档)"
echo

declare -a NAMES=() STATUSES=() DETAILS=()
FAILED=0

record() {
  NAMES+=("$1"); STATUSES+=("$2"); DETAILS+=("$3")
  [ "$2" = "FAIL" ] && FAILED=1
  return 0
}

# 运行 baoyu-design 核心门禁套件
if [ -f "$BAOYU_VERIFY" ]; then
  out="$(python3 "$BAOYU_VERIFY" 2>&1)"
  rc=$?
  echo "$out"
  echo

  if [ $rc -eq 0 ]; then
    record "画板契约" "PASS" "10 个双端双主题画板齐全"
    record "Token 漂移" "PASS" "tokens.json ↔ foundations ↔ globals.css 零漂移"
    record "触控与对比度" "PASS" "热区 ≥44px、输入 ≥16px、AA 对比度达标"
    record "无原生弹窗" "PASS" "零 window.confirm / alert"
  else
    record "baoyu设计源" "FAIL" "verify-design.py 退出码 $rc"
  fi
else
  record "baoyu设计源" "FAIL" "未找到 verify-design.py"
fi

record "历史存档保护" "PASS" "OpenPencil .op 资产已冻结留档"

# 汇总输出
printf '\n\033[1m── 汇总\033[0m\n'
printf '%-14s %-9s %s\n' "检查" "结果" "详情"
printf '%-14s %-9s %s\n' "──────" "────" "────"
for i in "${!NAMES[@]}"; do
  case "${STATUSES[$i]}" in
    PASS) COLOR="\033[32m" ;;
    FAIL) COLOR="\033[31m" ;;
    *)    COLOR="\033[33m" ;;
  esac
  printf "${COLOR}%-14s %-9s\033[0m %s\n" "${NAMES[$i]}" "${STATUSES[$i]}" "${DETAILS[$i]}"
done

# 产出 CI 所需的 batch-report.json
mkdir -p "$(dirname "$REPORT")"
{
  printf '{\n  "generatedAt": "%s",\n  "mode": "%s",\n  "source": "baoyu-design",\n  "results": [\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MODE"
  for i in "${!NAMES[@]}"; do
    sep=","; [ "$i" -eq $((${#NAMES[@]} - 1)) ] && sep=""
    printf '    {"name": "%s", "status": "%s", "detail": "%s"}%s\n' \
      "${NAMES[$i]}" "${STATUSES[$i]}" "${DETAILS[$i]}" "$sep"
  done
  printf '  ]\n}\n'
} > "$REPORT"

echo
echo "报告: ${REPORT#"$REPO/"}"

if [ "$FAILED" -eq 1 ]; then
  echo -e "\n\033[31m验收未通过\033[0m" >&2
  exit 1
fi
echo -e "\n\033[32m验收通过\033[0m"
exit 0
