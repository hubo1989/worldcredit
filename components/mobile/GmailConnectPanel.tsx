"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getGmailConnection,
  syncGmailNow,
  disconnectGmail,
  type GmailConnectionStatus,
} from "@/lib/api/gmail";
import { ConfirmDialog } from "@/components/obsidian/overlays";

export function GmailConnectPanel() {
  const [status, setStatus] = useState<GmailConnectionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);

  const reload = useCallback(async () => {
    try {
      setStatus(await getGmailConnection());
    } catch {
      setStatus(null);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const sync = async () => {
    setBusy(true);
    setNotice("同步中…");
    try {
      const acc = { written: 0, drafted: 0, skipped: 0, failed: 0 };
      let remaining = 1;
      for (let round = 0; remaining > 0 && round < 30; round++) {
        const s = await syncGmailNow(undefined, { maxMessages: 6 });
        acc.written += s.written;
        acc.drafted += s.drafted;
        acc.skipped += s.skipped;
        acc.failed += s.failed;
        remaining = s.remaining;
        setNotice(`同步中… 落账单 ${acc.written}｜草稿 ${acc.drafted}｜剩余 ${remaining} 封`);
      }
      setNotice(
        `同步完成：落账单 ${acc.written}，草稿 ${acc.drafted}，跳过 ${acc.skipped}，失败 ${acc.failed}`,
      );
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    setConfirmDisconnectOpen(false);
    setBusy(true);
    try {
      await disconnectGmail();
      setNotice("已成功断开 Gmail 授权");
      await reload();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!status?.connected) {
    return (
      <div className="rounded-2xl border border-d-border bg-d-subtle/50 p-4">
        <div className="flex items-center justify-between">
          <p className="text-[15px] font-semibold leading-5 text-d-text">Gmail 直连拉取</p>
          <span className="rounded-full border border-d-border bg-d-bg px-2 py-0.5 text-[11px] font-medium text-d-muted">
            未连接
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-4 text-d-muted">
          授权只读 Gmail 后，系统直接拉取银行账单邮件并解析入库，原文留证，不经过转发（转发会被银行
          DMARC 拒收）。
        </p>
        <a
          href="/api/auth/gmail/start"
          className="mt-3.5 inline-flex min-h-[44px] items-center justify-center rounded-xl bg-d-accent px-5 text-[13px] font-semibold text-white transition-opacity active:opacity-85"
        >
          连接 Gmail（只读）
        </a>
        {status?.last_error && (
          <p className="mt-2 text-[12px] leading-4 text-d-danger-ink">上次错误：{status.last_error}</p>
        )}
        {notice && <p className="mt-2 text-[12px] leading-4 text-d-muted">{notice}</p>}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-d-border bg-d-subtle/50 p-4">
      <div className="flex items-center justify-between">
        <p className="truncate text-[15px] font-bold text-d-text">{status.email}</p>
        <span className="shrink-0 rounded-full border border-d-success-ink/30 bg-d-success-soft px-2.5 py-0.5 text-[11px] font-semibold text-d-success-ink">
          ● 已授权连接
        </span>
      </div>
      <p className="mt-1 text-[12px] leading-4 text-d-muted">
        {status.last_sync_at ? `上次同步 ${status.last_sync_at}` : "尚未同步"}
        {status.last_sync_summary ? `｜${status.last_sync_summary}` : ""}
      </p>
      {status.last_error && (
        <p className="mt-1.5 text-[12px] leading-4 text-d-danger-ink">错误：{status.last_error}</p>
      )}
      {notice && <p className="mt-2 text-[12px] leading-4 text-d-muted">{notice}</p>}
      <div className="mt-3.5 flex gap-2.5">
        <button
          type="button"
          onClick={sync}
          disabled={busy}
          className="flex min-h-[44px] flex-2 items-center justify-center rounded-xl bg-d-accent px-4 text-[13px] font-semibold text-white transition-opacity active:opacity-85 disabled:opacity-50"
        >
          {busy ? "⚡ 同步中…" : "⚡ 立即同步新账单"}
        </button>
        <button
          type="button"
          onClick={() => setConfirmDisconnectOpen(true)}
          disabled={busy}
          className="flex min-h-[44px] flex-1 items-center justify-center rounded-xl border border-d-danger/50 bg-d-danger-soft px-3 text-[13px] font-semibold text-d-danger-ink transition-opacity active:opacity-85 disabled:opacity-50"
        >
          断开
        </button>
      </div>

      <ConfirmDialog
        open={confirmDisconnectOpen}
        title="断开 Gmail 授权"
        onClose={() => setConfirmDisconnectOpen(false)}
        actions={
          <>
            <button
              type="button"
              onClick={() => setConfirmDisconnectOpen(false)}
              className="min-h-[44px] rounded-xl border border-d-border bg-d-surface px-4 text-sm font-medium text-d-text"
            >
              取消
            </button>
            <button
              type="button"
              onClick={handleConfirmDisconnect}
              className="min-h-[44px] rounded-xl bg-d-danger px-4 text-sm font-semibold text-white"
            >
              确定断开
            </button>
          </>
        }
      >
        <p className="text-[13px] leading-5 text-d-muted">
          断开后将删除服务端的邮箱授权与原文副本，已导入账单保留。确认断开？
        </p>
      </ConfirmDialog>
    </div>
  );
}
