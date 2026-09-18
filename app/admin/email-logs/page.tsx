'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Typography, Paper, Box, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, TablePagination, TextField, InputAdornment,
  IconButton, Chip, Collapse, CircularProgress, ToggleButtonGroup, ToggleButton,
  Tooltip, Alert
} from '@mui/material'
import { Search as SearchIcon, Refresh as RefreshIcon, KeyboardArrowDown, KeyboardArrowUp } from '@mui/icons-material'
import { getEmailParseLogs } from '@/lib/api/admin'

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

function LogRowDetail({ row }: { row: LogRow }) {
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

function Row({ row }: { row: LogRow }) {
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
            <LogRowDetail row={row} />
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
                  {rows.map(r => <Row key={r.id} row={r} />)}
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
    </Box>
  )
}
