'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { Modal } from '@/components/obsidian/overlays'
import { Alert, Spinner } from '@/components/obsidian/feedback'
import { AdminPagination } from '@/components/admin/AdminShell'
import { SearchIcon, SyncIcon, ChevronDownIcon, ChevronUpIcon } from '@/components/icons/WcIcon'
import {
  getEmailParseLogs,
  getEmailParseLogHolders,
  discardEmailParseLog,
  createCardFromEmailParseLog,
} from '@/lib/api/admin'

/** RFC 2047 解码：把 =?UTF-8?B?...?= 这类编码主题还原成可读文本 */
function decodeMimeSubject(raw: string | null): string {
  if (!raw) return ''
 return raw.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, charset, enc, text) => {
    // 参数类型断言：正则捕获组在 TS 里推导不出具体类型
    const ch = charset as string, en = enc as string, tx = text as string
    try {
      if (en.toUpperCase() === 'B') {
        const bin = atob(tx)
        const bytes = Uint8Array.from(bin, (c: string) => c.charCodeAt(0))
        return new TextDecoder(ch).decode(bytes)
      }
      const qBytes = tx.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m: string, h: string) => String.fromCharCode(parseInt(h, 16)))
      return new TextDecoder(ch).decode(Uint8Array.from(qBytes, (c: string) => c.charCodeAt(0)))
    } catch {
      return text
    }
  }).replace(/\s+/g, ' ').trim()
}

const STATUS_CLS: Record<string, string> = {
  success: 'bg-d-success-soft text-d-success-ink',
  failed: 'bg-d-danger-soft text-d-danger-ink',
  skipped: 'bg-d-subtle text-d-muted',
}

const STATUS_LABEL: Record<string, string> = {
  success: '成功',
  failed: '失败',
  skipped: '跳过',
}

interface ParsedEmailBill {
  is_bill?: boolean
  bank_name?: string
  card_last4?: string | null
  bill_amount?: number | null
  min_payment?: number | null
  due_date?: string
  bill_month?: string
  statement_date?: string | null
  currency?: string
  confidence?: number
}

interface EmailLogHolderOption {
  id: string
  name: string
}

function parseEmailBill(text: string | null | undefined): ParsedEmailBill | null {
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as ParsedEmailBill
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function needsManualBankCard(row: LogRow): boolean {
  if (row.status !== 'failed') return false
  const message = row.error_msg ?? ''
  return message.includes('未匹配到银行「') && message.includes('请在界面手动添加该卡')
}

interface LogRow {
  id: string
  user_id: string
  from_email?: string
  subject?: string
  bill_id?: string
  status: 'success' | 'failed' | 'skipped'
  error_msg?: string
  raw_ai_response?: string
  created_at: string
}

function formatTime(iso: string): string {
  try {
    const normalized = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z'
    return new Date(normalized).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return iso
  }
}

function formatJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

function LogRowDetail({
  row,
  resolving,
  onDiscard,
  onCreate,
}: {
  row: LogRow
  resolving: boolean
  onDiscard: (row: LogRow) => void
  onCreate: (row: LogRow) => void
}) {
  const parsed = parseEmailBill(row.raw_ai_response)
  return (
    <div className='rounded-xl bg-d-subtle/60 p-4 text-[13px]'>
      <p className='mb-1 text-d-muted'>邮件 ID：{row.id}</p>
      <p className='mb-1 text-d-muted'>用户：{row.user_id.slice(0, 8)}…</p>
      {row.bill_id && (
        <p className='mb-1 text-d-muted'>关联账单：{row.bill_id}</p>
      )}
      {row.error_msg && (
        <p className='mt-1 break-all'>错误/说明：{row.error_msg}</p>
      )}
      {needsManualBankCard(row) && parsed?.bank_name && (
        <div className='mt-3'>
          <Alert
            severity="warning"
            action={
              <div className='flex gap-2'>
                <Button size='sm' variant='secondary' disabled={resolving} onClick={() => onDiscard(row)}>
                  丢弃
                </Button>
                <Button size='sm' disabled={resolving} onClick={() => onCreate(row)}>
                  新建银行和卡片
                </Button>
              </div>
            }
          >
            这封账单已解析出银行「{parsed.bank_name}」和尾号「{parsed.card_last4 ?? '—'}」，但产品目录没有匹配项。
            请选择丢弃这条待处理记录，或确认信息后新建银行/卡片并导入账单。
          </Alert>
        </div>
      )}
      {row.raw_ai_response && (
        <>
          <p className='mt-3 font-semibold'>AI 解析结果</p>
          <pre className='mt-1 max-h-[300px] overflow-auto whitespace-pre-wrap rounded-lg bg-d-bg p-3 text-[12px] text-d-text/80'>
            {formatJson(row.raw_ai_response)}
          </pre>
        </>
      )}
    </div>
  )
}

function Row({
  row,
  resolving,
  onDiscard,
  onCreate,
}: {
  row: LogRow
  resolving: boolean
  onDiscard: (row: LogRow) => void
  onCreate: (row: LogRow) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <tr className='border-t border-d-border/60 transition-colors hover:bg-d-subtle/40'>
        <td className='w-10 px-3 py-2'>
          <button
            type='button'
            aria-label={open ? '收起详情' : '展开详情'}
            onClick={() => setOpen(!open)}
            className='rounded-lg p-1 text-d-muted hover:bg-d-subtle'
          >
            {open ? <ChevronUpIcon size={16} /> : <ChevronDownIcon size={16} />}
          </button>
        </td>
        <td className='px-3 py-2 whitespace-nowrap tabular-nums'>{formatTime(row.created_at)}</td>
        <td className='px-3 py-2'>{row.from_email || '—'}</td>
        <td className='max-w-[300px] truncate px-3 py-2' title={decodeMimeSubject(row.subject ?? null)}>
          {decodeMimeSubject(row.subject ?? null) || '—'}
        </td>
        <td className='px-3 py-2'>
          <span className={'rounded-md px-2 py-0.5 text-[11px] font-semibold ' + (STATUS_CLS[row.status] ?? '')}>
            {STATUS_LABEL[row.status] ?? row.status}
          </span>
        </td>
        <td className='max-w-[250px] truncate px-3 py-2 text-d-muted' title={row.error_msg ?? ''}>
          {row.error_msg ?? '—'}
        </td>
      </tr>
      {open ? (
        <tr>
          <td colSpan={6} className='px-3 pb-3 pt-1'>
            <LogRowDetail
              row={row}
              resolving={resolving}
              onDiscard={onDiscard}
              onCreate={onCreate}
            />
          </td>
        </tr>
      ) : null}
    </>
  )
}

const STATUS_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'success', label: '成功' },
  { value: 'failed', label: '失败' },
  { value: 'skipped', label: '跳过' },
]

export default function EmailLogsPage() {
  const [loading, setLoading] = useState(true)
  const [rows, setRows] = useState<LogRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(20)
  const [statusFilter, setStatusFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [resolutionLog, setResolutionLog] = useState<LogRow | null>(null)
  const [resolutionOpen, setResolutionOpen] = useState(false)
  const [resolutionLoading, setResolutionLoading] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resolutionError, setResolutionError] = useState<string | null>(null)
  const [holders, setHolders] = useState<EmailLogHolderOption[]>([])
  const [holderId, setHolderId] = useState('')
  const [bankName, setBankName] = useState('')
  const [cardName, setCardName] = useState('')
  const [currency, setCurrency] = useState('CNY')
  const [country, setCountry] = useState('CN')

  const loadLogs = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const result = await getEmailParseLogs({
        page,
        pageSize: rowsPerPage,
        status: statusFilter === 'all' ? null : (statusFilter as 'success' | 'failed' | 'skipped'),
        search: search || null,
      })
      setRows(result.rows)
      setTotal(result.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [page, rowsPerPage, statusFilter, search])

  useEffect(() => { void loadLogs() }, [loadLogs])

  const openResolution = useCallback(async (row: LogRow) => {
    const parsed = parseEmailBill(row.raw_ai_response)
    if (!parsed?.bank_name) {
      setResolutionError('AI 解析结果缺少银行名称')
      return
    }
    setResolutionLog(row)
    setResolutionOpen(true)
    setResolutionError(null)
    setResolutionLoading(true)
    setBankName(parsed.bank_name)
    setCardName(`${parsed.bank_name}信用卡`)
    setCurrency((parsed.currency ?? 'CNY').toUpperCase())
    setCountry(parsed.currency?.toUpperCase() === 'CNY' ? 'CN' : '')
    try {
      const options = await getEmailParseLogHolders(row.id)
      setHolders(options)
      setHolderId(options[0]?.id ?? '')
      if (options.length === 0) setResolutionError('该用户还没有持卡人，请先创建持卡人')
    } catch (err) {
      setResolutionError(err instanceof Error ? err.message : '获取持卡人失败')
    } finally {
      setResolutionLoading(false)
    }
  }, [])

  const handleDiscard = useCallback(async (row: LogRow) => {
    try {
      setResolving(true)
      setResolutionError(null)
      await discardEmailParseLog(row.id)
      await loadLogs()
    } catch (err) {
      setResolutionError(err instanceof Error ? err.message : '丢弃失败')
    } finally {
      setResolving(false)
    }
  }, [loadLogs])

  const submitResolution = useCallback(async () => {
    if (!resolutionLog) return
    try {
      setResolving(true)
      setResolutionError(null)
      await createCardFromEmailParseLog({
        logId: resolutionLog.id,
        holderId,
        bankName,
        cardName,
        currency,
        country,
      })
      setResolutionOpen(false)
      setResolutionLog(null)
      await loadLogs()
    } catch (err) {
      setResolutionError(err instanceof Error ? err.message : '新建失败')
    } finally {
      setResolving(false)
    }
  }, [bankName, cardName, country, currency, holderId, loadLogs, resolutionLog])


  return (
    <div className='p-2'>
      <div className='mb-6 flex items-center justify-between gap-4'>
        <div>
          <h1 className='text-[26px] font-bold'>邮件日志</h1>
          <p className='text-[13px] text-d-muted'>每封收到的邮件及其处理结果（共 {total} 条）</p>
        </div>
        <button
          type='button'
          aria-label='刷新'
          onClick={() => void loadLogs()}
          disabled={loading}
          className='rounded-xl p-2 text-d-muted hover:bg-d-subtle disabled:opacity-50'
        >
          <SyncIcon size={18} />
        </button>
      </div>

      <div className='mb-4 flex flex-wrap items-center gap-4 rounded-2xl border border-d-border bg-d-surface p-4'>
        <div className='min-w-[260px] flex-1 sm:max-w-sm'>
          <TextField
            placeholder="搜索发件人或主题"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') { setSearch(searchInput); setPage(0) } }}
            startAdornment={<SearchIcon size={18} />}
          />
        </div>
        <div
          className='inline-flex overflow-hidden rounded-xl border border-d-border'
          role='group'
          aria-label='状态筛选'
        >
          {STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              type='button'
              onClick={() => { setStatusFilter(f.value); setPage(0) }}
              className={
                'h-9 px-3.5 text-[13px] font-semibold transition-colors ' +
                (statusFilter === f.value
                  ? 'bg-d-accent text-white'
                  : 'bg-d-surface text-d-muted hover:bg-d-subtle')
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className='mb-4'>
          <Alert severity="error">{error}</Alert>
        </div>
      )}
      {resolutionError && !resolutionOpen && (
        <div className='mb-4'>
          <Alert severity="error">{resolutionError}</Alert>
        </div>
      )}

      <div className='rounded-2xl border border-d-border bg-d-surface'>
        {loading ? (
          <div className='flex justify-center py-12'>
            <Spinner size={24} />
          </div>
        ) : rows.length === 0 ? (
          <div className='py-12 text-center text-d-muted'>暂无记录</div>
        ) : (
          <>
            <div className='overflow-x-auto'>
              <table className='w-full border-collapse text-[13px]'>
                <thead className='bg-d-subtle/50'>
                  <tr className='[&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-semibold [&>th]:text-d-muted'>
                    <th />
                    <th>时间</th>
                    <th>发件人</th>
                    <th>主题</th>
                    <th>状态</th>
                    <th>说明</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <Row
                      key={r.id}
                      row={r}
                      resolving={resolving}
                      onDiscard={row => void handleDiscard(row)}
                      onCreate={row => void openResolution(row)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <AdminPagination
              count={total}
              page={page}
              rowsPerPage={rowsPerPage}
              rowsPerPageOptions={[10, 20, 50]}
              onPageChange={setPage}
              onRowsPerPageChange={n => { setRowsPerPage(n); setPage(0) }}
            />
          </>
        )}
      </div>

      <Modal
        open={resolutionOpen && !!resolutionLog}
        onClose={() => setResolutionOpen(false)}
        title='新建银行和卡片'
        footer={
          <>
            <Button variant='ghost' onClick={() => setResolutionOpen(false)} disabled={resolving}>
              取消
            </Button>
            <Button
              onClick={() => void submitResolution()}
              disabled={
                resolving ||
                resolutionLoading ||
                !holderId ||
                !bankName.trim() ||
                !cardName.trim() ||
                !currency.trim() ||
                !country.trim()
              }
            >
              新建并导入账单
            </Button>
          </>
        }
      >
        <p className='mb-4 text-[13px] leading-5 text-d-muted'>
          将按以下信息补齐银行目录、卡产品和卡片，并把原邮件中的账单写入账本；同名且同币种的产品、同持卡人同尾号卡片会直接复用。
        </p>
        {resolutionError && (
          <div className='mb-4'>
            <Alert severity="error">{resolutionError}</Alert>
          </div>
        )}
        {resolutionLoading ? (
          <div className='flex justify-center py-8'>
            <Spinner size={24} />
          </div>
        ) : (
          <div className='flex flex-col gap-4'>
            <SelectField
              required
              label="持卡人"
              placeholder="选择持卡人"
              value={holderId}
              onChange={(e) => setHolderId(e.target.value)}
              disabled={resolving}
              options={holders.map((holder) => ({
                value: holder.id,
                label: holder.name,
              }))}
            />
            <TextField
              required
              label="银行名称"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              disabled={resolving}
            />
            <TextField
              required
              label="卡片名称"
              value={cardName}
              onChange={(e) => setCardName(e.target.value)}
              disabled={resolving}
            />
            <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
              <TextField
                required
                label="币种"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
                disabled={resolving}
              />
              <TextField
                required
                label="国家/地区"
                value={country}
                onChange={(e) => setCountry(e.target.value.toUpperCase())}
                disabled={resolving}
              />
            </div>
            {resolutionLog && (
              <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
                <TextField
                  label="卡尾号"
                  value={parseEmailBill(resolutionLog.raw_ai_response)?.card_last4 ?? ''}
                  disabled
                />
                <TextField
                  label="账单金额"
                  value={parseEmailBill(resolutionLog.raw_ai_response)?.bill_amount ?? ''}
                  disabled
                />
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
