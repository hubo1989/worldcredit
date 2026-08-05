-- gmail_ledger_entries: 存储 Gmail 解析的原始账单记录
-- 来源: normalized_bills.json (gmail-financial-bills-ledger)
-- 与 bills 表独立：此表保存所有解析结果（含未匹配卡的记录）

CREATE TABLE IF NOT EXISTS gmail_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ledger_id TEXT UNIQUE NOT NULL,           -- normalized_bills.json 中的原始 ID
  bank TEXT NOT NULL,                        -- 银行/机构名称
  account_tail TEXT,                         -- 卡尾号
  kind TEXT NOT NULL DEFAULT '信用卡',       -- 类别: 信用卡/贷款/还款计划等
  region TEXT DEFAULT '国内/中国',            -- 地区
  currency TEXT DEFAULT 'CNY',               -- 币种
  statement_amount NUMERIC DEFAULT 0,        -- 账单金额（负数=溢缴）
  statement_amount_raw TEXT,
  minimum_payment NUMERIC DEFAULT 0,
  minimum_payment_raw TEXT,
  due_date DATE,
  statement_date DATE,
  subject TEXT,                              -- 邮件主题
  source TEXT,                               -- 来源描述
  message_id TEXT,
  thread_id TEXT,
  evidence TEXT,                             -- 原始证据摘录
  attachment_path TEXT,                      -- 本地附件路径

  -- 还款标记（InsForge DB 持久化，非 localStorage）
  paid_amount NUMERIC DEFAULT 0,
  remaining_amount NUMERIC DEFAULT 0,
  completed BOOLEAN NOT NULL DEFAULT false,
  payment_status TEXT NOT NULL DEFAULT '未还款' CHECK (payment_status IN ('未还款', '部分还款', '已还清')),
  payment_note TEXT,
  payment_date DATE,
  last_payment_update TIMESTAMPTZ,

  -- 匹配状态
  matched_card_id UUID REFERENCES credit_cards(id) ON DELETE SET NULL,
  matched_bill_id UUID REFERENCES bills(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gmail_ledger_bank ON gmail_ledger_entries(bank);
CREATE INDEX IF NOT EXISTS idx_gmail_ledger_due_date ON gmail_ledger_entries(due_date);
CREATE INDEX IF NOT EXISTS idx_gmail_ledger_payment_status ON gmail_ledger_entries(payment_status);
CREATE INDEX IF NOT EXISTS idx_gmail_ledger_matched_bill ON gmail_ledger_entries(matched_bill_id);
