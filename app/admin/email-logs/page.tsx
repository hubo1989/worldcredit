'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Typography, Paper, Box, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, TextField, InputAdornment,
  IconButton, Chip, Collapse, CircularProgress, ToggleButtonGroup, ToggleButton,
  Tooltip, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, MenuItem
} from '@mui/material'
import { Search as SearchIcon, Refresh as RefreshIcon, KeyboardArrowDown, KeyboardArrowUp } from '@mui/icons-material'
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

const STATUS_COLOR: Record<string, 'success' | 'error' | 'default'> = {
  success: 'success',
  failed: 'error',
  skipped: 'default',
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
    <Box sx={{ p: 2, bgcolor: 'action.hover', borderRadius: 1 }}>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        邮件 ID：{row.id}
      </Typography>
      <Typography variant="body2" color="text.secondary" gutterBottom>
        用户：{row.user_id.slice(0, 8)}…
      </Typography>
      {row.bill_id && (
        <Typography variant="body2" color="text.secondary" gutterBottom>
          关联账单：{row.bill_id}
        </Typography>
      )}
      {row.error_msg && (
        <Typography variant="body2" sx={{ mt: 1, wordBreak: 'break-all' }}>
          错误/说明：{row.error_msg}
        </Typography>
      )}
      {needsManualBankCard(row) && parsed?.bank_name && (
        <Alert
          severity="warning"
          sx={{ mt: 2 }}
          action={
            <Stack direction="row" spacing={1} sx={{ pt: 0.5 }}>
              <Button size="small" color="inherit" disabled={resolving} onClick={() => onDiscard(row)}>
                丢弃
              </Button>
              <Button size="small" variant="contained" disabled={resolving} onClick={() => onCreate(row)}>
                新建银行和卡片
              </Button>
            </Stack>
          }
        >
          这封账单已解析出银行「{parsed.bank_name}」和尾号「{parsed.card_last4 ?? '—'}」，但产品目录没有匹配项。
          请选择丢弃这条待处理记录，或确认信息后新建银行/卡片并导入账单。
        </Alert>
      )}
      {row.raw_ai_response && (
        <>
          <Typography variant="body2" sx={{ mt: 2, fontWeight: 600 }}>
            AI 解析结果
          </Typography>
          <Box component="pre" sx={{ mt: 0.5, p: 1.5, bgcolor: 'grey.900', color: 'grey.100', borderRadius: 1, fontSize: 12, overflow: 'auto', maxHeight: 300, whiteSpace: 'pre-wrap' }}>
            {formatJson(row.raw_ai_response)}
          </Box>
        </>
      )}
    </Box>
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
      <TableRow hover>
        <TableCell sx={{ width: 40 }}>
          <IconButton size="small" onClick={() => setOpen(!open)}>
            {open ? <KeyboardArrowUp /> : <KeyboardArrowDown />}
          </IconButton>
        </TableCell>
        <TableCell>{formatTime(row.created_at)}</TableCell>
        <TableCell>{row.from_email || '—'}</TableCell>
        <TableCell sx={{ maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Tooltip title={decodeMimeSubject(row.subject ?? null)}>
            <span>{decodeMimeSubject(row.subject ?? null) || '—'}</span>
          </Tooltip>
        </TableCell>
        <TableCell>
          <Chip size="small" color={STATUS_COLOR[row.status]} label={STATUS_LABEL[row.status] ?? row.status} />
        </TableCell>
        <TableCell sx={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Tooltip title={row.error_msg ?? ''}>
            <span>{row.error_msg ?? '—'}</span>
          </Tooltip>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell sx={{ pb: 1, pt: 1, border: 0 }} colSpan={6}>
          <Collapse in={open} timeout="auto" unmountOnExit>
            <LogRowDetail
              row={row}
              resolving={resolving}
              onDiscard={onDiscard}
              onCreate={onCreate}
            />
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  )
}

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
    <Box sx={{ p: 3 }}>
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <Typography variant="h5">邮件日志</Typography>
          <Typography variant="body2" color="text.secondary">每封收到的邮件及其处理结果（共 {total} 条）</Typography>
        </div>
        <IconButton onClick={() => void loadLogs()} disabled={loading}>
          <RefreshIcon />
        </IconButton>
      </Box>

      <Paper sx={{ mb: 2, p: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <TextField size="small" placeholder="搜索发件人或主题" value={searchInput}
          onChange={e => setSearchInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') { setSearch(searchInput); setPage(0) } }}
          sx={{ minWidth: 260 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon />
              </InputAdornment>
            ),
          }}
        />
        <ToggleButtonGroup size="small" value={statusFilter} exclusive
          onChange={(_, v) => { if (v) { setStatusFilter(v); setPage(0) } }}>
          <ToggleButton value="all">全部</ToggleButton>
          <ToggleButton value="success">成功</ToggleButton>
          <ToggleButton value="failed">失败</ToggleButton>
          <ToggleButton value="skipped">跳过</ToggleButton>
        </ToggleButtonGroup>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>
      )}
      {resolutionError && !resolutionOpen && (
        <Alert severity="error" sx={{ mb: 2 }}>{resolutionError}</Alert>
      )}

      <Paper>
        {loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : rows.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 8 }}>
            <Typography color="text.secondary">暂无记录</Typography>
          </Box>
        ) : (
          <>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell />
                    <TableCell>时间</TableCell>
                    <TableCell>发件人</TableCell>
                    <TableCell>主题</TableCell>
                    <TableCell>状态</TableCell>
                    <TableCell>说明</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows.map(r => (
                    <Row
                      key={r.id}
                      row={r}
                      resolving={resolving}
                      onDiscard={row => void handleDiscard(row)}
                      onCreate={row => void openResolution(row)}
                    />
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={total}
              page={page}
              rowsPerPage={rowsPerPage}
              rowsPerPageOptions={[10, 20, 50]}
              onPageChange={(_, p) => setPage(p)}
              onRowsPerPageChange={e => { setRowsPerPage(parseInt(e.target.value, 10)); setPage(0) }}
            />
          </>
        )}
      </Paper>

      <Dialog
        open={resolutionOpen && !!resolutionLog}
        onClose={() => setResolutionOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>新建银行和卡片</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            将按以下信息补齐银行目录、卡产品和卡片，并把原邮件中的账单写入账本；同名且同币种的产品、同持卡人同尾号卡片会直接复用。
          </Typography>
          {resolutionError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {resolutionError}
            </Alert>
          )}
          {resolutionLoading ? (
            <Stack alignItems="center" sx={{ py: 4 }}>
              <CircularProgress size={24} />
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ pt: 1 }}>
              <TextField
                select
                required
                label="持卡人"
                value={holderId}
                onChange={(e) => setHolderId(e.target.value)}
                disabled={resolving}
              >
                {holders.map((holder) => (
                  <MenuItem key={holder.id} value={holder.id}>
                    {holder.name}
                  </MenuItem>
                ))}
              </TextField>
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
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
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
              </Stack>
              {resolutionLog && (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
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
                </Stack>
              )}
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setResolutionOpen(false)} disabled={resolving}>
            取消
          </Button>
          <Button
            variant="contained"
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
        </DialogActions>
      </Dialog>
    </Box>
  )
}