// lib/api/accounts.server.ts — 信用账户（Credit Accounts）服务端管理模块

import { query, queryOne, execute, batch, now } from "../db";
import type { CreditAccount, CreditCard, Bill, BillCardSubtotal } from "../types";
import { RpcDomainError } from "./errors";

export interface CreditAccountDetail extends CreditAccount {
  cards: CreditCard[];
  latest_bill?: (Bill & { subtotals?: BillCardSubtotal[] }) | null;
}

export type UpdateCreditAccountPatch = {
  label?: string | null;
  shared_credit_limit?: number | null;
  billing_day?: number | null;
  due_type?: "fixed" | "after_billing" | "fixed_before_billing" | null;
  due_value?: number | null;
  statement_mode?: "merged" | "independent";
  quota_mode?: "shared" | "independent";
};

/**
 * 获取当前用户可见的信用账户列表
 */
export async function getCreditAccounts(userId?: string): Promise<CreditAccount[]> {
  let condition = "";
  const params: unknown[] = [];
  if (userId) {
    condition = "WHERE (ch.created_by = ? OR ch.auth_user_id = ?)";
    params.push(userId, userId);
  }

  const { data, error } = await query<Record<string, unknown>>(
    `SELECT ca.*
     FROM credit_accounts ca
     JOIN card_holders ch ON ca.holder_id = ch.id
     ${condition}
     ORDER BY ca.created_at DESC`,
    params,
  );
  if (error) throw new Error(error.message);

  return (data || []).map((row) => ({
    id: String(row.id),
    holder_id: String(row.holder_id),
    bank_id: row.bank_id ? String(row.bank_id) : null,
    bank_name: String(row.bank_name || ""),
    currency: String(row.currency || "CNY"),
    account_tail: row.account_tail ? String(row.account_tail) : null,
    statement_mode: (row.statement_mode as CreditAccount["statement_mode"]) || "independent",
    quota_mode: (row.quota_mode as CreditAccount["quota_mode"]) || "independent",
    shared_credit_limit:
      row.shared_credit_limit != null ? Number(row.shared_credit_limit) : null,
    billing_day: row.billing_day != null ? Number(row.billing_day) : null,
    due_type: row.due_type as CreditAccount["due_type"],
    due_value: row.due_value != null ? Number(row.due_value) : null,
    primary_card_id: row.primary_card_id ? String(row.primary_card_id) : null,
    label: row.label ? String(row.label) : null,
    status: (row.status as CreditAccount["status"]) || "active",
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  }));
}

/**
 * 获取单个信用账户详情，附带下挂卡片及最新账单信息
 */
export async function getCreditAccountDetail(
  accountId: string,
): Promise<CreditAccountDetail | null> {
  const { data: accRow, error: accError } = await queryOne<Record<string, unknown>>(
    "SELECT * FROM credit_accounts WHERE id = ?",
    [accountId],
  );
  if (accError || !accRow) return null;

  const account: CreditAccount = {
    id: String(accRow.id),
    holder_id: String(accRow.holder_id),
    bank_id: accRow.bank_id ? String(accRow.bank_id) : null,
    bank_name: String(accRow.bank_name || ""),
    currency: String(accRow.currency || "CNY"),
    account_tail: accRow.account_tail ? String(accRow.account_tail) : null,
    statement_mode: (accRow.statement_mode as CreditAccount["statement_mode"]) || "independent",
    quota_mode: (accRow.quota_mode as CreditAccount["quota_mode"]) || "independent",
    shared_credit_limit:
      accRow.shared_credit_limit != null ? Number(accRow.shared_credit_limit) : null,
    billing_day: accRow.billing_day != null ? Number(accRow.billing_day) : null,
    due_type: accRow.due_type as CreditAccount["due_type"],
    due_value: accRow.due_value != null ? Number(accRow.due_value) : null,
    primary_card_id: accRow.primary_card_id ? String(accRow.primary_card_id) : null,
    label: accRow.label ? String(accRow.label) : null,
    status: (accRow.status as CreditAccount["status"]) || "active",
    created_at: String(accRow.created_at),
    updated_at: String(accRow.updated_at),
  };

  // 下挂信用卡
  const { data: cardsData } = await query<Record<string, unknown>>(
    `SELECT cc.*, cp.card_name, cp.bank_name
     FROM credit_cards cc
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE cc.account_id = ?
     ORDER BY cc.created_at ASC`,
    [accountId],
  );
  const cards = (cardsData || []) as unknown as CreditCard[];

  // 最新账单
  const { data: latestBillRow } = await queryOne<Bill>(
    "SELECT * FROM bills WHERE account_id = ? ORDER BY bill_month DESC LIMIT 1",
    [accountId],
  );

  let latest_bill: (Bill & { subtotals?: BillCardSubtotal[] }) | null = null;
  if (latestBillRow) {
    const { data: subtotals } = await query<BillCardSubtotal>(
      "SELECT * FROM bill_card_subtotals WHERE bill_id = ? ORDER BY card_tail ASC",
      [latestBillRow.id],
    );
    latest_bill = {
      ...latestBillRow,
      subtotals: subtotals || [],
    };
  }

  return {
    ...account,
    cards,
    latest_bill,
  };
}

/**
 * 将多张独立卡合并并入现有信用账户（支持合并向导）
 * 硬约束守卫：
 * 1. 目标账户与被合并卡片必须归属同一持卡人（严禁跨持卡人合并，如民生 0872 与 9765）
 * 2. 检查历史同月账单碰撞：若存在相同 bill_month 账单，抛出可读冲突错误，杜绝强行合并
 */
export async function mergeCardsIntoAccount(
  targetAccountId: string,
  cardIds: string[],
): Promise<{ mergedCount: number }> {
  if (!cardIds || cardIds.length === 0) {
    throw new RpcDomainError("VALIDATION_FAILED", "请选择需要合并的卡片");
  }

  const targetAccount = await getCreditAccountDetail(targetAccountId);
  if (!targetAccount) {
    throw new RpcDomainError("NOT_FOUND", "目标信用账户不存在");
  }

  const placeholders = cardIds.map(() => "?").join(",");
  const { data: rawCards } = await query<Record<string, unknown>>(
    `SELECT cc.*, cp.currency
     FROM credit_cards cc
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE cc.id IN (${placeholders})`,
    cardIds,
  );
  const cards = rawCards || [];
  if (cards.length !== cardIds.length) {
    throw new RpcDomainError("VALIDATION_FAILED", "部分待合并卡片不存在");
  }

  // 1. 同一持卡人与同币种校验
  for (const c of cards) {
    if (String(c.holder_id) !== targetAccount.holder_id) {
      throw new RpcDomainError("VALIDATION_FAILED", "不可跨持卡人合并信用账户与信用卡");
    }
    const cardCurrency = String(c.currency || "CNY");
    if (cardCurrency !== targetAccount.currency) {
      throw new RpcDomainError("VALIDATION_FAILED", "不同记账币种的卡片不能合并至同一账户");
    }
    if (String(c.card_type) === "loan") {
      throw new RpcDomainError("VALIDATION_FAILED", "贷款类卡片不可合并至信用卡账单账户");
    }
  }

  // 2. 同月账单碰撞检查
  // (a) 检查待合并各卡与目标账户已有账单是否存在相同月份
  const { data: targetBills } = await query<{ bill_month: string }>(
    "SELECT bill_month FROM bills WHERE account_id = ?",
    [targetAccountId],
  );
  const targetMonths = new Set((targetBills || []).map((b) => b.bill_month));

  const { data: candidateBills } = await query<{ card_id: string; bill_month: string }>(
    `SELECT card_id, bill_month FROM bills WHERE card_id IN (${placeholders})`,
    cardIds,
  );
  const candidateList = candidateBills || [];

  for (const cb of candidateList) {
    if (targetMonths.has(cb.bill_month)) {
      throw new RpcDomainError(
        "CONFLICT",
        `检测到历史账单碰撞：卡片与目标账户在 ${cb.bill_month} 均有账单，无法自动合并，请先人工核对`,
      );
    }
  }

  // (b) 检查待合并卡片之间是否存在同月账单
  const seenCandidateMonths = new Set<string>();
  for (const cb of candidateList) {
    if (seenCandidateMonths.has(cb.bill_month)) {
      throw new RpcDomainError(
        "CONFLICT",
        `待合并的卡片之间在 ${cb.bill_month} 存在重复账单，无法自动合并`,
      );
    }
    seenCandidateMonths.add(cb.bill_month);
  }

  // 3. 执行合并事务
  const anchorCardId = targetAccount.primary_card_id || cardIds[0];
  const maxLimit = Math.max(
    targetAccount.shared_credit_limit || 0,
    ...cards.map((c) => Number(c.credit_limit_override ?? c.credit_limit) || 0),
  );

  const updates: { sql: string; params?: unknown[] }[] = [];

  // 更新目标账户模式与共享额度
  updates.push({
    sql: `UPDATE credit_accounts
          SET statement_mode = 'merged',
              quota_mode = 'shared',
              shared_credit_limit = ?,
              updated_at = ?
          WHERE id = ?`,
    params: [maxLimit > 0 ? maxLimit : null, now(), targetAccountId],
  });

  // 更新卡片所属 account_id
  for (const cid of cardIds) {
    updates.push({
      sql: "UPDATE credit_cards SET account_id = ? WHERE id = ?",
      params: [targetAccountId, cid],
    });
  }

  // 将待合并卡片历史 bills 迁移至目标账户，并对齐 anchor card_id
  for (const cid of cardIds) {
    updates.push({
      sql: "UPDATE bills SET account_id = ?, card_id = ? WHERE card_id = ?",
      params: [targetAccountId, anchorCardId, cid],
    });
  }

  await batch(updates);
  return { mergedCount: cardIds.length };
}

/**
 * 将卡片从合并账户中拆出为独立账单账户
 */
export async function splitCardFromAccount(cardId: string): Promise<CreditAccount> {
  const { data: cardRow } = await queryOne<Record<string, unknown>>(
    `SELECT cc.*, cp.bank_id, cp.bank_name, cp.currency, cp.payment_due_type, cp.payment_due_value
     FROM credit_cards cc
     LEFT JOIN card_products cp ON cc.card_product_id = cp.id
     WHERE cc.id = ?`,
    [cardId],
  );
  if (!cardRow) throw new RpcDomainError("NOT_FOUND", "卡片不存在");

  const currentAccountId = cardRow.account_id ? String(cardRow.account_id) : null;
  if (!currentAccountId) {
    throw new RpcDomainError("VALIDATION_FAILED", "该卡片未归属于任何信用账户");
  }

  const { data: siblings } = await query<{ id: string }>(
    "SELECT id FROM credit_cards WHERE account_id = ? AND id != ?",
    [currentAccountId, cardId],
  );
  if (!siblings || siblings.length === 0) {
    throw new RpcDomainError("VALIDATION_FAILED", "该账户仅有此一张卡片，无需拆分");
  }

  const account = await getCreditAccountDetail(currentAccountId);
  if (!account) throw new RpcDomainError("NOT_FOUND", "当前账户不存在");

  const updates: { sql: string; params?: unknown[] }[] = [];
  const newAccountId = `acc_i_${cardId}`;

  // 若拆出的卡片恰好是原账户的 primary_card_id，需将原账户锚点平滑平移给剩余卡
  if (account.primary_card_id === cardId) {
    const nextAnchorCardId = siblings[0].id;
    updates.push({
      sql: "UPDATE credit_accounts SET primary_card_id = ?, updated_at = ? WHERE id = ?",
      params: [nextAnchorCardId, now(), currentAccountId],
    });
    // 原账户账单更新锚点卡
    updates.push({
      sql: "UPDATE bills SET card_id = ? WHERE account_id = ?",
      params: [nextAnchorCardId, currentAccountId],
    });
  }

  // 为被拆出的卡片新建独立账户
  updates.push({
    sql: `INSERT INTO credit_accounts (
            id, holder_id, bank_id, bank_name, currency, statement_mode, quota_mode,
            shared_credit_limit, billing_day, due_type, due_value, primary_card_id, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'independent', 'independent', NULL, ?, ?, ?, ?, 'active', ?, ?)`,
    params: [
      newAccountId,
      cardRow.holder_id,
      cardRow.bank_id || null,
      cardRow.bank_name || "未知银行",
      cardRow.currency || "CNY",
      cardRow.billing_day,
      cardRow.override_due_type || cardRow.payment_due_type || "after_billing",
      cardRow.override_due_value || cardRow.payment_due_value || 20,
      cardId,
      now(),
      now(),
    ],
  });

  // 更新卡片 account_id 指向新独立账户
  updates.push({
    sql: "UPDATE credit_cards SET account_id = ? WHERE id = ?",
    params: [newAccountId, cardId],
  });

  await batch(updates);

  const created = await getCreditAccountDetail(newAccountId);
  if (!created) throw new Error("拆分账户创建失败");
  return created;
}

/**
 * 更新信用账户信息
 */
export async function updateCreditAccount(
  accountId: string,
  patch: UpdateCreditAccountPatch,
): Promise<CreditAccount> {
  const account = await getCreditAccountDetail(accountId);
  if (!account) throw new RpcDomainError("NOT_FOUND", "信用账户不存在");

  const fields: string[] = ["updated_at = ?"];
  const params: unknown[] = [now()];

  if (patch.label !== undefined) {
    fields.push("label = ?");
    params.push(patch.label);
  }
  if (patch.shared_credit_limit !== undefined) {
    fields.push("shared_credit_limit = ?");
    params.push(patch.shared_credit_limit != null && patch.shared_credit_limit > 0 ? patch.shared_credit_limit : null);
  }
  if (patch.billing_day !== undefined) {
    fields.push("billing_day = ?");
    params.push(patch.billing_day);
  }
  if (patch.due_type !== undefined) {
    fields.push("due_type = ?");
    params.push(patch.due_type);
  }
  if (patch.due_value !== undefined) {
    fields.push("due_value = ?");
    params.push(patch.due_value);
  }
  if (patch.statement_mode !== undefined) {
    fields.push("statement_mode = ?");
    params.push(patch.statement_mode);
  }
  if (patch.quota_mode !== undefined) {
    fields.push("quota_mode = ?");
    params.push(patch.quota_mode);
  }

  params.push(accountId);
  const { error } = await execute(
    `UPDATE credit_accounts SET ${fields.join(", ")} WHERE id = ?`,
    params,
  );
  if (error) throw new Error(error.message);

  const updated = await getCreditAccountDetail(accountId);
  if (!updated) throw new Error("更新失败");
  return updated;
}
