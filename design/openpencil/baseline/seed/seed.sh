#!/usr/bin/env bash
# 注入基线种子数据（追加式、幂等）。
# 用法: bash design/openpencil/baseline/seed/seed.sh [--remote]
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
SQL="$REPO/design/openpencil/baseline/seed/seed-branches.sql"

MODE="--local"
[ "${1:-}" = "--remote" ] && MODE="--remote"

echo "seeding worldcredit ($MODE)"
npx wrangler d1 execute worldcredit "$MODE" --file "$SQL" >/dev/null 2>&1 \
  && echo "done" \
  || { echo "seed failed; 检查 SQL 是否有语法或外键问题" >&2; exit 1; }

echo "--- 分支覆盖自检 ---"
npx wrangler d1 execute worldcredit "$MODE" --json --command "
SELECT
  (SELECT COUNT(DISTINCT cp.currency) FROM credit_cards cc JOIN card_products cp ON cc.card_product_id=cp.id) AS currencies,
  (SELECT COUNT(*) FROM bills WHERE id LIKE 'e000000%') AS seeded_bills,
  (SELECT COUNT(*) FROM payments WHERE id LIKE 'f000000%') AS seeded_payments;
" 2>/dev/null | python3 -c "
import sys,json
r=json.load(sys.stdin)[0]['results'][0]
print(f\"  currencies={r['currencies']} seededBills={r['seeded_bills']} seededPayments={r['seeded_payments']}\")
"
