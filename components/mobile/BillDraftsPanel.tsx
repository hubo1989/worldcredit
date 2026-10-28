"use client";
// components/mobile/BillDraftsPanel.tsx — 邮件导入的待确认草稿。
// 同步引擎对「解析出账单但自动落不下去」的邮件会预填草稿（source_type=email），
// 用户在这里选卡后确认，走 confirmBillImportDraft 落正式账单。
import { useCallback, useEffect, useState } from "react";
import {
  getBillImportDrafts,
  confirmBillImportDraft,
  discardBillImportDraft,
  updateBillImportDraft,
  type BillImportDraft,
} from "@/lib/api/billDrafts";
import { getCardsWithBillsSummary } from "@/lib/api/bills";
import { formatCardTail } from "@/lib/utils";

export function BillDraftsPanel({ onChanged }: { onChanged?: () => void }) {
  const [drafts, setDrafts] = useState<BillImportDraft[]>([]);
  const [cards, setCards] = useState<Array<{ id: string; label: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setDrafts(await getBillImportDrafts());
    } catch {
      // 取不到草稿不阻塞账单页
      setDrafts([]);
    }
  }, []);

  useEffect(() => {
    void reload();
    void getCardsWithBillsSummary()
      .then((list) =>
        setCards(
          list.map((c) => ({
            id: c.card.id,
            label:
              `${c.card.card_product?.bank_name ?? ""} ${formatCardTail(c.card.card_number_last4)}`.trim(),
          })),
        ),
      )
      .catch(() => {});
  }, [reload]);

  if (!drafts.length) return null;

  const patchCard = async (draft: BillImportDraft, cardId: string) => {
    setBusy(true);
    setError(null);
    try {
      await updateBillImportDraft(draft.id, { card_id: cardId || undefined });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (draft: BillImportDraft) => {
    setBusy(true);
    setError(null);
    try {
      await confirmBillImportDraft(draft.id);
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const discard = async (draft: BillImportDraft) => {
    setBusy(true);
    setError(null);
    try {
      await discardBillImportDraft(draft.id);
      await reload();
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="px-4 pt-4">
      <div className="rounded-2xl border border-d-border bg-d-surface p-4">
        <p className="text-[15px] font-semibold leading-5 text-d-text">
          待确认导入草稿 {drafts.length}
        </p>
        <p className="mt-0.5 text-[12px] leading-4 text-d-muted">
          邮件解析出了账单信息但无法自动归属，选卡确认后入库
        </p>
        {error && <p className="mt-1 text-[12px] leading-4 text-red-400">{error}</p>}
        {drafts.map((draft) => {
          const p = draft.parsed_payload;
          const completable = Boolean(
            p.bill_amount != null && p.due_date && p.bill_month && draft.card_id,
          );
          return (
            <div
              key={draft.id}
              className="mt-3 border-t border-d-border pt-3 text-[12px] text-d-muted"
            >
              <p className="text-d-text">
                {p.bill_month ?? "未识别月份"}｜{p.bill_amount != null ? p.bill_amount : "—"}｜到期{" "}
                {p.due_date ?? "—"}
              </p>
              <select
                className="mt-2 h-9 w-full rounded-lg border border-d-border bg-transparent px-2 text-d-text"
                value={draft.card_id ?? ""}
                disabled={busy}
                onChange={(e) => void patchCard(draft, e.target.value)}
              >
                <option value="">选择卡片（必选）</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
              {!completable && (
                <p className="mt-1 text-[11px] leading-4 text-d-muted">
                  {!draft.card_id
                    ? "选择卡片后可确认入库"
                    : "账单字段不全，确认前请补齐金额/月份/到期日"}
                </p>
              )}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={!completable || busy}
                  onClick={() => void confirm(draft)}
                  className="h-9 rounded-full border border-d-accent px-3 text-[12px] font-semibold text-d-accent-light disabled:opacity-40"
                >
                  确认入库
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void discard(draft)}
                  className="h-9 rounded-full border border-d-border px-3 text-[12px] font-semibold text-d-muted disabled:opacity-40"
                >
                  丢弃
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
