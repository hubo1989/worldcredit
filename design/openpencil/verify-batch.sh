#!/usr/bin/env bash
# ============================================================================
# WorldCredit 批次验收入口
#
# 一次跑完源代码、契约、token、回归与视觉检查，输出统一汇总，按最严重结果返回退出码。
#
#   1. 字段对齐   baseline/check-master-fields.py   母版是否覆盖真实基线的结构元素
#   2. 几何溢出   scripts/check-overflow.py         母版元素是否越出视口
#   3. Frame 契约 scripts/check-frame-contract.py   frame / 字段 / 动作契约
#   4. Token 漂移 scripts/check-token-drift.py      设计源与运行时 token / 对比度
#   5. Python 回归 tests/test_{frame_contract,token_drift,p02_candidate_track,export_roles,reviewed_sources_sync}.py
#   6. 视觉回归   baseline/capture.py + visual-diff.py   实拍产物是否偏离已批准基线
#
# 用法:
#   bash design/openpencil/verify-batch.sh                  # 全部（视觉回归按服务可达性自动决定）
#   bash design/openpencil/verify-batch.sh --source-only    # 运行全部源检查与 Python 回归（不需要服务）
#   bash design/openpencil/verify-batch.sh --visual-only    # 只跑视觉回归
#   bash design/openpencil/verify-batch.sh --only dashboard bills    # 视觉回归限定路由
#   bash design/openpencil/verify-batch.sh --threshold 0.01          # 放宽视觉差异阈值
#
# 退出码:
#   0  全部通过
#   1  存在失败（字段缺失 / 溢出 / 契约 / token / 测试 / 视觉差异）
#   2  前置条件缺失（OpenPencil 不可达 / 缺基线 / 服务不可达且显式要求视觉回归）
#
# 前置条件:
#   - 字段对齐与几何溢出：OpenPencil MCP 可达（桌面端或 headless 在跑）
#   - 视觉回归：本地服务 http://127.0.0.1:8787 + 种子数据
#     npx wrangler dev --port 8787
#     bash design/openpencil/baseline/seed/seed.sh
# ============================================================================
set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BASE="$REPO/design/openpencil/baseline"
SCRIPTS="$REPO/design/openpencil/scripts"
REPORT="$REPO/design/openpencil/batch-report.json"

APP_URL="${WC_BASE_URL:-http://127.0.0.1:8787}"

# ---- 参数 ----
MODE="all"          # all | source-only | visual-only
ONLY_ARGS=()
EXTRA_ARGS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --source-only) MODE="source-only"; shift ;;
    --visual-only) MODE="visual-only"; shift ;;
    --only|--states|--threshold|--base-url|--card-id|--bill-id)
      EXTRA_ARGS+=("$1" "$2"); shift 2 ;;
    --headed) EXTRA_ARGS+=("$1"); shift ;;
    -h|--help) sed -n '2,32p' "$0"; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

# ---- 结果累积 ----
declare -a NAMES=() STATUSES=() DETAILS=()
FAILED=0
PRECONDITION=0

record() {  # name status detail
  NAMES+=("$1"); STATUSES+=("$2"); DETAILS+=("$3")
  [ "$2" = "FAIL" ] && FAILED=1
  [ "$2" = "BLOCKED" ] && PRECONDITION=1
  return 0
}

banner() { printf '\n\033[1m── %s\033[0m\n' "$1"; }

# ---- 前置探测 ----
opencil_reachable() {
  # 允许 CI 强制关闭 OpenPencil 探测，验证便携回退路径
  [ "${WC_FORCE_NO_OPENPENCIL:-0}" = "1" ] && return 1
  # `op status` 会误报 running:false；用真实调用探测。
  op get_document_info >/dev/null 2>&1
}
app_reachable() {
  [ "$(curl -s -o /dev/null -w '%{http_code}' "$APP_URL/login" 2>/dev/null)" = "200" ]
}

# ============================================================================
# 检查 1：字段对齐
# ============================================================================
run_fields() {
  banner "1/6 字段对齐（母版 .op vs 真实基线）"
  # 字段检查直接解析 .op 产物，不需要 OpenPencil 运行时，CI 可跑。
  local out rc
  out="$(python3 "$BASE/check-master-fields.py" 2>&1)"; rc=$?
  echo "$out"
  if [ $rc -eq 0 ]; then
    local n; n="$(echo "$out" | grep -c '^OK')"
    record "字段对齐" "PASS" "${n} 个母版对齐"
  elif [ $rc -eq 2 ]; then
    record "字段对齐" "BLOCKED" "缺基线，先跑 capture.py"
  else
    record "字段对齐" "FAIL" "存在母版未对齐基线"
  fi
}

# ============================================================================
# 检查 2：几何溢出
# ============================================================================
run_overflow() {
  banner "2/6 几何溢出（元素是否越出视口）"
  local out rc mode
  if opencil_reachable; then
    # 本地：用引擎版，能算布局容器内的子节点坐标
    mode="engine"
    out="$(python3 "$SCRIPTS/check-overflow.py" 2>&1)"; rc=$?
  else
    # CI / 无 OpenPencil：用便携版，只读 .op JSON。
    # `op` 是 macOS 专属 nanobrew formula，Linux runner 装不了，
    # 所以 CI 只能走便携版（覆盖绝对定位节点的越界与重叠）。
    mode="portable"
    out="$(python3 "$SCRIPTS/check-overflow-portable.py" 2>&1)"; rc=$?
  fi
  echo "$out"
  if [ $rc -eq 0 ]; then
    record "几何溢出" "PASS" "$([ "$mode" = engine ] && echo '引擎版，全部母版在视口内' || echo '便携版，绝对定位节点无越界')"
  else
    local n; n="$(echo "$out" | grep -cE 'FAIL|溢出:')"
    record "几何溢出" "FAIL" "${n} 处越界/重叠"
  fi
}

# ============================================================================
# 检查 3-5：契约 / token / Python 回归（无 OpenPencil 或服务依赖）
# ============================================================================
run_frame_contract() {
  banner "3/6 Frame 契约（.op frame / 字段 / 动作）"
  local out rc
  out="$(python3 "$SCRIPTS/check-frame-contract.py" 2>&1)"; rc=$?
  echo "$out"
  if [ "$rc" -eq 0 ]; then
    record "Frame 契约" "PASS" "真实 .op 与 _contract.json 覆盖通过"
  else
    record "Frame 契约" "FAIL" "check-frame-contract.py 退出码 $rc"
  fi
}

run_token_drift() {
  banner "4/6 Token 漂移与对比度"
  local out rc
  out="$(python3 "$SCRIPTS/check-token-drift.py" 2>&1)"; rc=$?
  echo "$out"
  if [ "$rc" -eq 0 ]; then
    record "Token 漂移" "PASS" "映射与对比度检查通过"
  else
    record "Token 漂移" "FAIL" "check-token-drift.py 退出码 $rc"
  fi
}

run_python_tests() {
  banner "5/6 Python 回归（Frame / Token / Candidate / 导出分流）"
  local out rc summary
  out="$(cd "$REPO" && python3 -m unittest -v \
    design.openpencil.tests.test_frame_contract \
    design.openpencil.tests.test_token_drift \
    design.openpencil.tests.test_p02_candidate_track \
    design.openpencil.tests.test_export_roles \
    design.openpencil.tests.test_reviewed_sources_sync 2>&1)"; rc=$?
  echo "$out"
  if [ "$rc" -eq 0 ]; then
    summary="$(printf '%s\n' "$out" | grep -E '^Ran [0-9]+ tests' | tail -n 1)"
    record "Python 回归" "PASS" "${summary:-五个测试模块通过}"
  else
    record "Python 回归" "FAIL" "Frame / Token / Candidate / export role 测试失败"
  fi
}

# ============================================================================
# 检查 6：视觉回归（实拍 + 比对）
# ============================================================================
run_visual() {
  banner "6/6 视觉回归（实拍产物 vs 已批准基线）"
  if ! app_reachable; then
    echo "本地服务不可达 ($APP_URL)"
    if [ "$MODE" = "visual-only" ]; then
      echo "  先运行: npx wrangler dev --port 8787" >&2
      record "视觉回归" "BLOCKED" "服务不可达 $APP_URL"
    else
      echo "  跳过（字段与几何检查不受影响）"
      record "视觉回归" "SKIPPED" "服务不可达，未纳入判定"
    fi
    return
  fi

  echo "--- 实拍 ---"
  if ! python3 "$BASE/capture.py" --base-url "$APP_URL" "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}"; then
    record "视觉回归" "FAIL" "capture 失败"
    return
  fi

  echo "--- 比对 ---"
  local out rc
  out="$(python3 "$BASE/visual-diff.py" "${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}" 2>&1)"; rc=$?
  echo "$out"
  local summary; summary="$(echo "$out" | grep -E '[0-9]+/[0-9]+ pass')"
  if [ $rc -eq 0 ]; then
    record "视觉回归" "PASS" "$summary"
  elif [ $rc -eq 2 ]; then
    record "视觉回归" "BLOCKED" "缺基线，先 --update"
  else
    local n; n="$(echo "$out" | grep -c '^FAIL')"
    record "视觉回归" "FAIL" "${n} 处超阈值"
  fi
}

# ============================================================================
# 执行
# ============================================================================
echo "WorldCredit 批次验收"
echo "  模式: $MODE"
echo "  仓库: $REPO"
echo "  服务: $APP_URL ($(app_reachable && echo 可达 || echo 不可达))"
echo "  OpenPencil: $(opencil_reachable && echo 可达 || echo 不可达)"

case "$MODE" in
  all)         run_fields; run_overflow; run_frame_contract; run_token_drift; run_python_tests; run_visual ;;
  source-only) run_fields; run_overflow; run_frame_contract; run_token_drift; run_python_tests ;;
  visual-only) run_visual ;;
esac

# ---- 汇总 ----
banner "汇总"
printf '%-12s %-9s %s\n' "检查" "结果" "详情"
printf '%-12s %-9s %s\n' "────" "────" "────"
for i in "${!NAMES[@]}"; do
  case "${STATUSES[$i]}" in
    PASS) COLOR="\033[32m" ;;
    FAIL) COLOR="\033[31m" ;;
    *)    COLOR="\033[33m" ;;
  esac
  printf "${COLOR}%-12s %-9s\033[0m %s\n" "${NAMES[$i]}" "${STATUSES[$i]}" "${DETAILS[$i]}"
done

# ---- 机器可读报告 ----
{
  printf '{\n  "generatedAt": "%s",\n  "mode": "%s",\n  "appUrl": "%s",\n  "results": [\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$MODE" "$APP_URL"
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
if [ "$PRECONDITION" -eq 1 ]; then
  echo -e "\n\033[33m前置条件缺失，部分检查未执行\033[0m" >&2
  exit 2
fi
echo -e "\n\033[32m验收通过\033[0m"
exit 0
