'use client'
// components/mobile/GmailConnectPanel.tsx — 连接 Gmail / 立即同步 / 断开。
// 为什么不再引导「转发到专属地址」：转发会破坏银行 DKIM，银行域 DMARC
// p=reject 时 Cloudflare 直接 550 5.7.1 拒收（实测 2026-10-26 退信），
// 信进不了 worker。直连 Gmail API 绕开整个 SMTP 转发链。
import { useCallback, useEffect, useState } from 'react'
import { getGmailConnection, syncGmailNow, disconnectGmail, type GmailConnectionStatus } from '@/lib/api/gmail'

export function GmailConnectPanel() {
  const [status, setStatus] = useState<GmailConnectionStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setStatus(await getGmailConnection())
    } catch {
      // 面板降级为未连接状态，不打断设置页
      setStatus(null)
    }
  }, [])
  useEffect(() => {
    void reload()
  }, [reload])

  const sync = async () => {
    setBusy(true)
    setNotice('同步中…')
    try {
      // 每封账单邮件要过一遍 LLM 解析（5–15s/封），一次性同步几十封会超过
      // Cloudflare ~100s 代理超时（首次回填实测 9 分钟）→ 请求被 524 掐断、
      // 界面报「同步失败」但后台其实还在跑。分轮拉取：每轮 6 封，看
      // remaining 续拉，单请求稳在超时线以内。
      const acc = { written: 0, drafted: 0, skipped: 0, failed: 0 }
      let remaining = 1
      for (let round = 0; remaining > 0 && round < 30; round++) {
        const s = await syncGmailNow(undefined, { maxMessages: 6 })
        acc.written += s.written
        acc.drafted += s.drafted
        acc.skipped += s.skipped
        acc.failed += s.failed
        remaining = s.remaining
        setNotice(`同步中… 落账单 ${acc.written}｜草稿 ${acc.drafted}｜剩余 ${remaining} 封`)
      }
      setNotice(
        `同步完成：落账单 ${acc.written}，草稿 ${acc.drafted}，跳过 ${acc.skipped}，失败 ${acc.failed}`
      )
      await reload()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!window.confirm('断开后将删除服务端的邮箱授权与原文副本，已导入账单保留。确认？')) return
    setBusy(true)
    try {
      await disconnectGmail()
      setNotice('已断开')
      await reload()
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!status?.connected) {
    return (
      <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
        <p className='text-[15px] font-semibold leading-5 text-d-text'>Gmail 直连拉取</p>
        <p className='mt-1 text-[12px] leading-4 text-d-muted'>
          授权只读 Gmail 后，系统直接拉取银行账单邮件并解析入库，原文留证，不经过转发（转发会被银行 DMARC 拒收）。
        </p>
        <a
          href='/api/auth/gmail/start'
          className='mt-3 inline-flex h-10 items-center rounded-full border border-d-accent px-4 text-[12px] font-semibold text-d-accent-light'
        >
          连接 Gmail（只读）
        </a>
        {status?.last_error && (
          <p className='mt-2 text-[12px] leading-4 text-d-muted'>上次错误：{status.last_error}</p>
        )}
        {notice && <p className='mt-2 text-[12px] leading-4 text-d-muted'>{notice}</p>}
      </div>
    )
  }

  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
      <p className='text-[15px] font-semibold leading-5 text-d-text'>{status.email}</p>
      <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
        {status.last_sync_at ? `上次同步 ${status.last_sync_at}` : '尚未同步'}
        {status.last_sync_summary ? `｜${status.last_sync_summary}` : ''}
      </p>
      {status.last_error && <p className='mt-1 text-[12px] leading-4 text-d-muted'>错误：{status.last_error}</p>}
      {notice && <p className='mt-2 text-[12px] leading-4 text-d-muted'>{notice}</p>}
      <div className='mt-3 flex gap-2'>
        <button
          type='button'
          onClick={sync}
          disabled={busy}
          className='h-10 rounded-full border border-d-accent px-4 text-[12px] font-semibold text-d-accent-light disabled:opacity-50'
        >
          {busy ? '同步中…' : '立即同步'}
        </button>
        <button
          type='button'
          onClick={disconnect}
          disabled={busy}
          className='h-10 rounded-full border border-d-border px-4 text-[12px] font-semibold text-d-muted disabled:opacity-50'
        >
          断开
        </button>
      </div>
    </div>
  )
}
