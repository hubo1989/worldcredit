'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Box, Typography, Paper, Stack, Chip, Button, IconButton,
  Divider, Tooltip, Skeleton, Card, CardContent
} from '@mui/material'
import {
  Email as EmailIcon,
  ContentCopy as ContentCopyIcon,
  CheckCircleOutline as CheckIcon,
  Sync as SyncIcon,
  CheckCircle as SuccessIcon,
  ErrorOutline as ErrorIcon,
  HelpOutline as SkipIcon,
  AddTask as AddTaskIcon
} from '@mui/icons-material'
import { useAuth } from '@/lib/auth'
import type { EmailParseLogWithParsed } from '@/lib/api/emailBills'
import { getEmailParseLogs } from '@/lib/api/emailBills'
import { EmailBillSyncModal } from './EmailBillSyncModal'
import { format } from 'date-fns'

const DOMAIN = '20160325.xyz'

interface Props {
  onBillSynced?: () => void
}

export function EmailBillsList({ onBillSynced }: Props) {
  const { user } = useAuth()
  const [logs, setLogs] = useState<EmailParseLogWithParsed[]>([])
  const [loading, setLoading] = useState(true)
  const [copied, setCopied] = useState(false)

  const [selectedLog, setSelectedLog] = useState<EmailParseLogWithParsed | null>(null)
  const [syncModalOpen, setSyncModalOpen] = useState(false)

  const forwardAddress = user ? `bills+${user.id}@${DOMAIN}` : null

  const fetchLogs = useCallback(async () => {
    try {
      setLoading(true)
      const data = await getEmailParseLogs()
      setLogs(data)
    } catch (err) {
      console.error('Fetch email parse logs error:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const handleCopy = async () => {
    if (!forwardAddress) return
    try {
      await navigator.clipboard.writeText(forwardAddress)
      setCopied(true)
    } catch {
      const el = document.createElement('textarea')
      el.value = forwardAddress
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
    }
  }

  const handleOpenSync = (log: EmailParseLogWithParsed) => {
    setSelectedLog(log)
    setSyncModalOpen(true)
  }

  const handleSyncSuccess = () => {
    fetchLogs()
    if (onBillSynced) onBillSynced()
  }

  return (
    <Box>
      {/* 专属转发邮箱 Banner */}
      <Card variant="outlined" sx={{ borderRadius: 3, mb: 3, bgcolor: 'primary.50', borderColor: 'primary.200' }}>
        <CardContent sx={{ py: 2 }}>
          <Stack direction="row" spacing={1.5} alignItems="center" sx={{ mb: 1 }}>
            <EmailIcon color="primary" />
            <Typography variant="subtitle1" fontWeight={700}>
              专属账单转发邮箱
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            将银行发来的电子账单邮件转发至此地址，系统将自动识别解析并汇入下方邮件账单列表。
          </Typography>

          {forwardAddress && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                bgcolor: 'white',
                borderRadius: 2,
                px: 2,
                py: 1,
                border: '1px solid',
                borderColor: 'grey.300'
              }}
            >
              <Typography
                variant="body2"
                fontFamily="monospace"
                sx={{ flex: 1, wordBreak: 'break-all', fontWeight: 600, color: 'primary.main' }}
              >
                {forwardAddress}
              </Typography>
              <Tooltip title={copied ? '已复制！' : '复制地址'}>
                <IconButton
                  size="small"
                  onClick={handleCopy}
                  color={copied ? 'success' : 'default'}
                >
                  {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            </Box>
          )}
        </CardContent>
      </Card>

      {/* 邮件账单列表标题 */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="subtitle1" fontWeight={700}>
          邮件账单历史明细 ({logs.length})
        </Typography>
        <Button
          size="small"
          startIcon={<SyncIcon />}
          onClick={fetchLogs}
        >
          刷新列表
        </Button>
      </Box>

      {/* 列表渲染 */}
      {loading ? (
        <Stack spacing={2}>
          {[1, 2, 3].map(i => (
            <Skeleton key={i} variant="rounded" height={110} sx={{ borderRadius: 3 }} />
          ))}
        </Stack>
      ) : logs.length === 0 ? (
        <Paper sx={{ p: 6, textAlign: 'center', borderRadius: 3, bgcolor: 'grey.50' }}>
          <EmailIcon sx={{ fontSize: 56, color: 'text.disabled', opacity: 0.4, mb: 1 }} />
          <Typography color="text.secondary">暂未收到邮件账单</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
            将银行账单邮件转发至上方专属邮箱后刷新即可查看
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {logs.map(log => {
            const parsed = log.parsedData
            const isSuccess = log.status === 'success'
            const isSkipped = log.status === 'skipped'
            const isFailed = log.status === 'failed'

            return (
              <Paper
                key={log.id}
                variant="outlined"
                sx={{
                  p: 2,
                  borderRadius: 3,
                  borderColor: isSuccess ? 'success.light' : isFailed ? 'warning.light' : 'divider',
                  bgcolor: isSuccess ? 'success.50' : 'background.paper',
                  transition: 'all 0.2s ease',
                  '&:hover': { boxShadow: 1 }
                }}
              >
                {/* 第一行：状态 + 发件人/时间 */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {isSuccess && (
                      <Chip
                        icon={<SuccessIcon />}
                        label="已建立/同步到账户"
                        color="success"
                        size="small"
                        sx={{ fontWeight: 600 }}
                      />
                    )}
                    {isFailed && (
                      <Chip
                        icon={<ErrorIcon />}
                        label="待关联/可一键同步"
                        color="warning"
                        size="small"
                        sx={{ fontWeight: 600 }}
                      />
                    )}
                    {isSkipped && (
                      <Chip
                        icon={<SkipIcon />}
                        label="未识别为账单"
                        color="default"
                        size="small"
                      />
                    )}
                  </Box>

                  <Typography variant="caption" color="text.secondary">
                    {log.created_at ? format(new Date(log.created_at), 'yyyy-MM-dd HH:mm') : ''}
                  </Typography>
                </Box>

                {/* 邮件主题与发件人 */}
                <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 0.5 }}>
                  {log.subject || '（无邮件主题）'}
                </Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
                  来自: {log.from_email || '未知发件人'}
                </Typography>

                {/* 邮件解析提取的信息卡片 */}
                {parsed && (parsed.bank_name || parsed.bill_amount != null) && (
                  <Box
                    sx={{
                      p: 1.5,
                      bgcolor: 'grey.50',
                      borderRadius: 2,
                      mb: 1.5,
                      border: '1px dashed #e0e0e0'
                    }}
                  >
                    <Stack direction="row" flexWrap="wrap" gap={1.5} justifyContent="space-between" alignItems="center">
                      <Box>
                        <Typography variant="caption" color="text.secondary" display="block">
                          提取账户与卡号
                        </Typography>
                        <Typography variant="body2" fontWeight={700}>
                          {parsed.bank_name || '银行'} {parsed.card_last4 ? `(*${parsed.card_last4})` : ''}
                        </Typography>
                      </Box>

                      <Box>
                        <Typography variant="caption" color="text.secondary" display="block">
                          账单日 / 还款日
                        </Typography>
                        <Typography variant="body2">
                          {parsed.statement_date || '未设置'} → <strong>{parsed.due_date || '未提取'}</strong>
                        </Typography>
                      </Box>

                      <Box sx={{ textAlign: 'right' }}>
                        <Typography variant="caption" color="text.secondary" display="block">
                          本期总账单
                        </Typography>
                        <Typography variant="body1" fontWeight={800} color="error.main">
                          ¥ {parsed.bill_amount ?? 0}
                        </Typography>
                      </Box>
                    </Stack>
                  </Box>
                )}

                {log.error_msg && (
                  <Typography variant="caption" color="error.main" sx={{ display: 'block', mb: 1 }}>
                    提示: {log.error_msg}
                  </Typography>
                )}

                {/* 底部操作区 */}
                <Divider sx={{ my: 1 }} />
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
                  {isSuccess ? (
                    <Typography variant="caption" color="success.main" sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <SuccessIcon fontSize="small" /> 账单信息已绑定到账户
                    </Typography>
                  ) : (
                    <Button
                      size="small"
                      variant="contained"
                      color="primary"
                      startIcon={<AddTaskIcon />}
                      onClick={() => handleOpenSync(log)}
                      sx={{ borderRadius: 2 }}
                    >
                      同步到本账户
                    </Button>
                  )}
                </Box>
              </Paper>
            )
          })}
        </Stack>
      )}

      {/* 同步弹窗 */}
      <EmailBillSyncModal
        open={syncModalOpen}
        onClose={() => setSyncModalOpen(false)}
        onSuccess={handleSyncSuccess}
        log={selectedLog}
      />
    </Box>
  )
}
