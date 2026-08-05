'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  TextField,
  Button,
  Chip,
  Switch,
  FormControlLabel
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import EmailIcon from '@mui/icons-material/Email'
import CheckIcon from '@mui/icons-material/CheckCircleOutline'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import ForwardIcon from '@mui/icons-material/ForwardToInbox'
import AdminIcon from '@mui/icons-material/AdminPanelSettings'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
import {
  addBillEmailSource,
  deleteBillEmailSource,
  getBillEmailSources,
  setBillEmailSourceActive,
  type BillEmailSource,
} from '@/lib/api/bill-emails'
import { useUserPreferences } from '@/lib/hooks/useUserPreferences'
import { DisplayPreferencesCard } from '@/components/settings/DisplayPreferencesCard'
import { ReminderPreferencesCard } from '@/components/settings/ReminderPreferencesCard'

const DOMAIN = '20160325.xyz'
const DIRECT_INBOX = `bills@${DOMAIN}`
const ADMIN_EMAILS = ['admin@worldcredit.com']

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

export default function SettingsPage() {
  const { user } = useAuth()
  const router = useRouter()
  const { displayConfig, reminderConfig, updateDisplay, updateReminder, loading: loadingPrefs } = useUserPreferences()

  const isAdmin = Boolean(user && ADMIN_EMAILS.includes(user.email))

  const [sources, setSources] = useState<BillEmailSource[]>([])
  const [sourceEmail, setSourceEmail] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [loadingSources, setLoadingSources] = useState(false)
  const [savingSource, setSavingSource] = useState(false)

  const [notice, setNotice] = useState<{ open: boolean; message: string; severity: 'success' | 'error' | 'info' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  const forwardAddress = user ? `bills+${user.id}@${DOMAIN}` : null

  const loadSources = useCallback(async () => {
    if (!user?.id) return
    setLoadingSources(true)
    try {
      setSources(await getBillEmailSources(user.id))
    } catch (err: any) {
      setNotice({ open: true, message: err?.message || '加载邮箱失败', severity: 'error' })
    } finally {
      setLoadingSources(false)
    }
  }, [user?.id])

  useEffect(() => {
    loadSources()
  }, [loadSources])

  const activeCount = useMemo(() => sources.filter(s => s.is_active).length, [sources])

  const copyText = async (text: string, label = '已复制') => {
    try {
      await navigator.clipboard.writeText(text)
      setNotice({ open: true, message: label, severity: 'success' })
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setNotice({ open: true, message: label, severity: 'success' })
    }
  }

  const handleAddSource = async () => {
    if (!user?.id) return
    const email = sourceEmail.trim().toLowerCase()
    if (!isValidEmail(email)) {
      setNotice({ open: true, message: '请输入有效邮箱地址', severity: 'error' })
      return
    }

    setSavingSource(true)
    try {
      await addBillEmailSource(user.id, email, sourceLabel)
      setSourceEmail('')
      setSourceLabel('')
      await loadSources()
      setNotice({ open: true, message: '账单来源邮箱已添加', severity: 'success' })
    } catch (err: any) {
      setNotice({ open: true, message: err?.message || '添加失败', severity: 'error' })
    } finally {
      setSavingSource(false)
    }
  }

  const handleToggleSource = async (source: BillEmailSource) => {
    try {
      await setBillEmailSourceActive(source.id, !source.is_active)
      await loadSources()
    } catch (err: any) {
      setNotice({ open: true, message: err?.message || '更新失败', severity: 'error' })
    }
  }

  const handleDeleteSource = async (source: BillEmailSource) => {
    try {
      await deleteBillEmailSource(source.id)
      await loadSources()
      setNotice({ open: true, message: '已删除来源邮箱', severity: 'success' })
    } catch (err: any) {
      setNotice({ open: true, message: err?.message || '删除失败', severity: 'error' })
    }
  }

  return (
    <Container sx={{ py: 3, pb: 10 }}>
      <Typography variant="h5" fontWeight={800} sx={{ mb: 3 }}>
        设置
      </Typography>

      <Stack spacing={3}>
        {/* 0. 管理员专属控制台卡片 */}
        {isAdmin && (
          <Card
            sx={{
              background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
              color: '#ffffff',
              borderRadius: 4,
              boxShadow: '0 8px 32px rgba(49, 46, 129, 0.25)'
            }}
          >
            <CardContent sx={{ p: 2.5 }}>
              <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <AdminIcon color="warning" fontSize="small" />
                    <Typography variant="subtitle1" fontWeight={800}>
                      系统管理员权限
                    </Typography>
                  </Stack>
                  <Typography variant="caption" sx={{ opacity: 0.85, display: 'block' }}>
                    管理全平台银行、卡产品、公共权益与 AI 配置
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  color="warning"
                  size="small"
                  onClick={() => router.push('/admin')}
                  sx={{ fontWeight: 800, whiteSpace: 'nowrap', borderRadius: 2.5 }}
                >
                  进入后台
                </Button>
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* 1. 模块化显示要素偏好设置组件 */}
        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: -1.5, px: 0.5, fontWeight: 700 }}>
          界面显示偏好
        </Typography>
        <DisplayPreferencesCard
          config={displayConfig}
          onChange={async (updates) => {
            await updateDisplay(updates)
            setNotice({ open: true, message: '界面显示偏好已保存', severity: 'success' })
          }}
          disabled={loadingPrefs}
        />

        {/* 2. 模块化提醒设置组件 */}
        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: -1.5, px: 0.5, fontWeight: 700 }}>
          提醒通道与节点
        </Typography>
        <ReminderPreferencesCard
          config={reminderConfig}
          onChange={async (updates) => {
            await updateReminder(updates)
            setNotice({ open: true, message: '提醒规则设置已保存', severity: 'success' })
          }}
          disabled={loadingPrefs}
        />

        {/* 3. 账单自动录入地址 */}
        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: -1.5, px: 0.5, fontWeight: 700 }}>
          账单自动录入地址
        </Typography>
        <Card variant="outlined">
          <CardContent sx={{ p: 2.5 }}>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: 3,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'info.light',
                  color: 'info.main'
                }}
              >
                <ForwardIcon fontSize="small" />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Typography variant="subtitle1" fontWeight={700}>
                  收账单邮箱
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  转发银行账单至以下地址，系统将自动解析入库
                </Typography>
              </Box>
            </Stack>

            <Divider sx={{ my: 2, borderStyle: 'dashed' }} />

            <Stack spacing={1.5}>
              {forwardAddress && (
                <Box sx={{ bgcolor: 'background.default', borderRadius: 3, p: 1.75, border: '1px solid', borderColor: 'divider' }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary" fontWeight={700}>
                        专属地址（推荐，免登记来源邮箱）
                      </Typography>
                      <Typography variant="body2" fontFamily="monospace" fontWeight={600} sx={{ wordBreak: 'break-all', mt: 0.25 }}>
                        {forwardAddress}
                      </Typography>
                    </Box>
                    <Tooltip title="复制专属地址">
                      <IconButton size="small" onClick={() => copyText(forwardAddress, '专属地址已复制')}>
                        <ContentCopyIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </Box>
              )}

              <Box sx={{ bgcolor: 'background.default', borderRadius: 3, p: 1.75, border: '1px solid', borderColor: 'divider' }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="caption" color="text.secondary" fontWeight={700}>
                      公共地址（需要登记来源邮箱）
                    </Typography>
                    <Typography variant="body2" fontFamily="monospace" fontWeight={600} sx={{ wordBreak: 'break-all', mt: 0.25 }}>
                      {DIRECT_INBOX}
                    </Typography>
                  </Box>
                  <Tooltip title="复制公共地址">
                    <IconButton size="small" onClick={() => copyText(DIRECT_INBOX, '公共地址已复制')}>
                      <ContentCopyIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Stack>
              </Box>
            </Stack>

            <Alert severity="info" sx={{ mt: 2, borderRadius: 3 }}>
              登录后直接使用专属地址进行自动转发最方便；云端 Email Worker 会自动按用户 ID 绑定账单。
            </Alert>
          </CardContent>
        </Card>

        {/* 4. 来源邮箱来源配置 */}
        <Typography variant="overline" color="text.secondary" sx={{ display: 'block', mb: -1.5, px: 0.5, fontWeight: 700 }}>
          公共地址来源授权
        </Typography>
        <Card variant="outlined">
          <CardContent sx={{ p: 2.5 }}>
            <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: 3,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  bgcolor: 'success.light',
                  color: 'success.dark'
                }}
              >
                <EmailIcon fontSize="small" />
              </Box>
              <Box sx={{ flex: 1 }}>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <Typography variant="subtitle1" fontWeight={700}>
                    账单来源邮箱
                  </Typography>
                  <Chip size="small" label={`${activeCount} 个启用`} color={activeCount > 0 ? 'success' : 'default'} />
                </Stack>
                <Typography variant="body2" color="text.secondary">
                  使用公共地址时登记转发账单的源邮箱
                </Typography>
              </Box>
            </Stack>

            <Stack spacing={1.5} sx={{ mb: 2 }}>
              <TextField
                fullWidth
                size="small"
                label="来源邮箱 *"
                placeholder="例如 hubo1989@gmail.com"
                value={sourceEmail}
                onChange={e => setSourceEmail(e.target.value)}
              />
              <TextField
                fullWidth
                size="small"
                label="备注（选填）"
                placeholder="例如 Gmail 主邮箱 / 招行账单邮箱"
                value={sourceLabel}
                onChange={e => setSourceLabel(e.target.value)}
              />
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                onClick={handleAddSource}
                disabled={savingSource || !sourceEmail.trim()}
                sx={{ borderRadius: 3 }}
              >
                {savingSource ? '添加中...' : '添加邮箱'}
              </Button>
            </Stack>

            <Divider sx={{ my: 2, borderStyle: 'dashed' }} />

            {loadingSources ? (
              <Typography variant="body2" color="text.secondary">正在加载...</Typography>
            ) : sources.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                暂无来源邮箱。使用专属地址时可不添加；使用公共地址时必须添加。
              </Typography>
            ) : (
              <Stack spacing={1.25}>
                {sources.map(source => (
                  <Box
                    key={source.id}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 3,
                      p: 1.5,
                      bgcolor: 'background.default'
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body2" fontWeight={700} sx={{ wordBreak: 'break-all' }}>
                        {source.email}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {source.label || '未命名来源'}
                      </Typography>
                    </Box>
                    <FormControlLabel
                      label=""
                      control={<Switch size="small" checked={source.is_active} onChange={() => handleToggleSource(source)} />}
                      sx={{ mr: 0 }}
                    />
                    <Tooltip title="删除">
                      <IconButton size="small" color="error" onClick={() => handleDeleteSource(source)}>
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Box>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Stack>

      <Snackbar
        open={notice.open}
        autoHideDuration={2500}
        onClose={() => setNotice(prev => ({ ...prev, open: false }))}
      >
        <Alert severity={notice.severity} icon={notice.severity === 'success' ? <CheckIcon fontSize="small" /> : undefined}>
          {notice.message}
        </Alert>
      </Snackbar>
    </Container>
  )
}
