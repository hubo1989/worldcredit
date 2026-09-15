-- 0005: track rows whose amount was entered by hand.
--
-- Some statement mails (notably Amex "statement is ready" / AutoPay reminders)
-- carry no amount or due date, so parsing yields 0. Those rows are kept and the
-- ledger UI offers a "补录金额" entry to fill the figure in.
--
-- Why a flag is needed: getGmailLedgerEntries drops rows where
-- amount > 0 AND due_date IS NULL AND statement_date IS NULL, because for
-- multi-card statements those are subsidiary-card detail lines rather than
-- standalone bills. A hand-entered bill is the opposite case — a human
-- confirmed it — so it must survive that filter even without a period.

ALTER TABLE gmail_ledger_entries ADD COLUMN manually_priced INTEGER NOT NULL DEFAULT 0;
