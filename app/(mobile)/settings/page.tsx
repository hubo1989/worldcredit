'use client'

import { useState } from 'react'
import {
  Container,
  Typography,
  Box,
  Card,
  CardContent,
  IconButton,
  Tooltip,
  Snackbar,
  Alert,
  Divider,
  Stack,
  Button,
} from '@mui/material'
import {
  ContentCopy as ContentCopyIcon,
  Email as EmailIcon,
  CheckCircleOutline as CheckIcon,
} from '@mui/icons-material'
import { useAuth } from '@/lib/auth'

const DOMAIN = '20160325.xyz'

export default function SettingsPage() {
  const { user } = useAuth()
  const [copied, setCopied] = useState(false)

  const forwardAddress = user ? `bills+${user.id}@${DOMAIN}` : null

  const handleCopy = async () => {
    if (!forwardAddress) return
    try {
      await navigator.clipboard.writeText(forwardAddress)
      setCopied(true)
    } catch {
      // Fallback for browsers without clipboard API
      const el = document.createElement('textarea')
      el.value = forwardAddress
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
    }
  }

  return (
    <Container sx={{ py: 3 }}>
      {/* Page title */}
      <Typography variant="h5" fontWeight={700} sx={{ mb: 3 }}>
        设置
      </Typography>

      {/* ── Email auto-import section ── */}
      <Typography
        variant="overline"
        color="text.secondary"
        sx={{ display: 'block', mb: 1, px: 0.5 }}
      >
        账单自动录入
      </Typography>

      <Card variant="outlined" sx={{ borderRadius: 3 }}>
        <CardContent>
          <Stack direction="row" spacing={1.5} alignItems="flex-start" sx={{ mb: 1.5 }}>
            <EmailIcon color="primary" sx={{ mt: 0.5 }} />
            <Box>
              <Typography variant="subtitle1" fontWeight={600}>
                专属转发邮箱
              </Typography>
              <Typography variant="body2" color="text.secondary">
                将账单邮件转发到此地址，系统将自动识别并录入账单
              </Typography>
            </Box>
          </Stack>

          <Divider sx={{ my: 1.5 }} />

          {forwardAddress ? (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                bgcolor: 'grey.100',
                borderRadius: 2,
                px: 2,
                py: 1.5,
              }}
            >
              <Typography
                variant="body2"
                fontFamily="monospace"
                sx={{ flex: 1, wordBreak: 'break-all', color: 'text.primary' }}
              >
                {forwardAddress}
              </Typography>
              <Tooltip title={copied ? '已复制！' : '复制地址'}>
                <IconButton
                  size="small"
                  onClick={handleCopy}
                  color={copied ? 'success' : 'default'}
                  aria-label="复制转发邮箱地址"
                >
                  {copied ? (
                    <CheckIcon fontSize="small" />
                  ) : (
                    <ContentCopyIcon fontSize="small" />
                  )}
                </IconButton>
              </Tooltip>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary">
              登录后查看专属地址
            </Typography>
          )}

          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', mt: 1.5, lineHeight: 1.6 }}
          >
            支持国内外主流银行账单邮件。系统会自动解析银行、账单金额、还款日等信息，并支持一键建立账户并同步账单。
          </Typography>

          <Button
            variant="outlined"
            fullWidth
            sx={{ mt: 2, borderRadius: 2 }}
            href="/bills"
          >
            前往查看邮件账单列表与同步状态
          </Button>
        </CardContent>
      </Card>
    </Container>
  )
}
