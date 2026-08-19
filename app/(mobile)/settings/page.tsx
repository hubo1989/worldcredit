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
  FormControlLabel,
  Collapse,
  Paper,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import EmailIcon from '@mui/icons-material/Email'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline'
import AddIcon from '@mui/icons-material/Add'
import DeleteIcon from '@mui/icons-material/DeleteOutline'
import ForwardIcon from '@mui/icons-material/ForwardToInbox'
import AdminIcon from '@mui/icons-material/AdminPanelSettings'
import LogoutIcon from '@mui/icons-material/Logout'
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
import {
  UserIcon,
  PromoIcon,
  BenefitIcon,
  ImportIcon,
  BellIcon,
  SettingsIcon,
  ChevronRightIcon,
  ChevronDownIcon,
} from '@/components/icons/WcIcon'

const DOMAIN = '20160325.xyz'
const DIRECT_INBOX = `bills@${DOMAIN}`
const ADMIN_EMAILS = ['admin@worldcredit.com']

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
}

/** 我的页管理入口行（§5.1）。点击整行触发 onClick（跳转或展开）。 */
interface MineEntryProps {
  icon: React.ReactNode
  title: string
  subtitle: string
  onClick: () => void
  expanded?: boolean
  rightSlot?: React.ReactNode
}

function MineEntry({ icon, title, subtitle, onClick, expanded, rightSlot }: MineEntryProps) {
  return (
    <Paper
      onClick={onClick}
      elevation={0}
      sx={{
        // 每个入口行：白底 + 12px 圆角 + 左右 16 / 上下 14
        backgroundColor: 'var(--paper)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-card)',
        px: 2,
        py: 1.75,
        cursor: 'pointer',
        transition: 'background-color 150ms ease, border-color 150ms ease',
        '&:active': { backgroundColor: 'rgba(10, 31, 68, 0.03)' },
      }}
    >
      <Stack direction="row" spacing={1.5} alignItems="center">
        {/* 左侧 48x48 圆形浅底 + navy-600 图标 */}
        <Box
          sx={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(30, 58, 138, 0.08)',
            color: 'var(--navy-600)',
            flexShrink: 0,
            '& svg': { fontSize: 22 },
          }}
        >
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{ fontSize: 15, fontWeight: 600, color: 'var(--navy-800)', lineHeight: 1.3 }}
          >
            {title}
          </Typography>
          <Typography
            sx={{
              fontSize: 12.5,
              color: 'text.secondary',
              lineHeight: 1.3,
              mt: 0.25,
            }}
          >
            {subtitle}
          </Typography>
        </Box>
        {rightSlot}
        {/* 右箭头：跳转项用 ChevronRightIcon；可折叠项展开后用 ChevronDownIcon */}
        <Box sx={{ color: '#9AA3B2', display: 'flex', alignItems: 'center', '& svg': { fontSize: 20 } }}>
          {expanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
        </Box>
      </Stack>
    </Paper>
  )
}

export default function SettingsPage() {
  const { user, signOut } = useAuth()
  const router = useRouter()
  const { displayConfig, reminderConfig, updateDisplay, updateReminder, loading: loadingPrefs } = useUserPreferences()

  const isAdmin = Boolean(user && ADMIN_EMAILS.includes(user.email))

  const handleSignOut = async () => {
    try {
      await signOut()
      router.push('/login')
    } catch (err: any) {
      setNotice({ open: true, message: err?.message || '退出登录失败', severity: 'error' })
    }
  }

  // Gmail 来源邮箱相关状态（保留原 settings 页的全部功能）
  const [sources, setSources] = useState<BillEmailSource[]>([])
  const [sourceEmail, setSourceEmail] = useState('')
  const [sourceLabel, setSourceLabel] = useState('')
  const [loadingSources, setLoadingSources] = useState(false)
  const [savingSource, setSavingSource] = useState(false)

  // 折叠面板：提醒偏好 / 设置 / Gmail 账单导入
  const [openReminder, setOpenReminder] = useState(false)
  const [openSettings, setOpenSettings] = useState(false)
  const [openGmail, setOpenGmail] = useState(false)

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

  // 邮箱账单管理入口状态
  const emailBillSubtitle =
    activeCount > 0
      ? `已授权 ${sources.length} 个来源邮箱（${activeCount} 个已启用）`
      : '支持专属邮箱直传与授权转发'

  return (
    <Container sx={{ py: 3, pb: 12 }}>
      {/* 顶部标题「我的」+ 用户标识 */}
      <Typography variant="h5" fontWeight={800} sx={{ mb: 0.5, color: 'var(--navy-800)' }}>
        我的
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
        {user?.email || '已登录用户'}
      </Typography>

      <Stack spacing={2}>
        {/* 管理员专属控制台卡片（保留） */}
        {isAdmin && (
          <Card
            sx={{
              background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 100%)',
              color: '#ffffff',
              borderRadius: 4,
              boxShadow: '0 8px 32px rgba(49, 46, 129, 0.25)',
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

        {/* 管理入口列表（§5.1） */}
        <MineEntry
          icon={<UserIcon />}
          title="家庭管理"
          subtitle="持卡人与卡片管理"
          onClick={() => router.push('/holders')}
        />

        <MineEntry
          icon={<PromoIcon />}
          title="优惠活动"
          subtitle="可用优惠"
          onClick={() => router.push('/promos')}
        />

        <MineEntry
          icon={<BenefitIcon />}
          title="我的权益"
          subtitle="权益使用进度"
          onClick={() => router.push('/benefits')}
        />

        <MineEntry
          icon={<ImportIcon />}
          title="邮箱账单导入"
          subtitle={emailBillSubtitle}
          onClick={() => setOpenGmail(v => !v)}
          expanded={openGmail}
          rightSlot={
            <Chip
              size="small"
              label={activeCount > 0 ? `${activeCount}个启用` : '专属就绪'}
              color={activeCount > 0 ? 'success' : 'primary'}
              variant={activeCount > 0 ? 'filled' : 'outlined'}
              sx={{ mr: 0.5, fontWeight: 600 }}
            />
          }
        />

        {/* 邮箱账单导入展开区：保留原「账单自动录入地址」+「来源邮箱配置」全部功能 */}
        <Collapse in={openGmail} sx={{ width: '100%' }}>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: -0.5 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ImportIcon />}
                onClick={() => router.push('/gmail-ledger')}
                sx={{ borderRadius: 2.5, fontWeight: 600 }}
              >
                查看邮箱账单明细流水
              </Button>
            </Box>
            {/* 账单自动录入地址 */}
            <Card variant="outlined" sx={{ borderRadius: 'var(--radius-card)' }}>
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
                      color: 'info.main',
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
                    <Box
                      sx={{
                        bgcolor: 'background.default',
                        borderRadius: 3,
                        p: 1.75,
                        border: '1px solid',
                        borderColor: 'divider',
                      }}
                    >
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography variant="caption" color="text.secondary" fontWeight={700}>
                            专属地址（推荐，免登记来源邮箱）
                          </Typography>
                          <Typography
                            variant="body2"
                            className="num-tabular"
                            fontFamily="monospace"
                            fontWeight={600}
                            sx={{ wordBreak: 'break-all', mt: 0.25 }}
                          >
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

                  <Box
                    sx={{
                      bgcolor: 'background.default',
                      borderRadius: 3,
                      p: 1.75,
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  >
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="caption" color="text.secondary" fontWeight={700}>
                          公共地址（需要登记来源邮箱）
                        </Typography>
                        <Typography
                          variant="body2"
                          className="num-tabular"
                          fontFamily="monospace"
                          fontWeight={600}
                          sx={{ wordBreak: 'break-all', mt: 0.25 }}
                        >
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

            {/* 来源邮箱配置 */}
            <Card variant="outlined" sx={{ borderRadius: 'var(--radius-card)' }}>
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
                      color: 'success.dark',
                    }}
                  >
                    <EmailIcon fontSize="small" />
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" alignItems="center" spacing={1}>
                      <Typography variant="subtitle1" fontWeight={700}>
                        账单来源邮箱
                      </Typography>
                      <Chip
                        size="small"
                        label={`${activeCount} 个启用`}
                        color={activeCount > 0 ? 'success' : 'default'}
                      />
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
                  <Typography variant="body2" color="text.secondary">
                    正在加载...
                  </Typography>
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
                          bgcolor: 'background.default',
                        }}
                      >
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            variant="body2"
                            className="num-tabular"
                            fontWeight={700}
                            sx={{ wordBreak: 'break-all' }}
                          >
                            {source.email}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {source.label || '未命名来源'}
                          </Typography>
                        </Box>
                        <FormControlLabel
                          label=""
                          control={
                            <Switch
                              size="small"
                              checked={source.is_active}
                              onChange={() => handleToggleSource(source)}
                            />
                          }
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
        </Collapse>

        {/* 提醒偏好：折叠保留 ReminderPreferencesCard 全部功能 */}
        <MineEntry
          icon={<BellIcon />}
          title="提醒偏好"
          subtitle="还款提醒通道与节点"
          onClick={() => setOpenReminder(v => !v)}
          expanded={openReminder}
        />
        <Collapse in={openReminder} sx={{ width: '100%' }}>
          <ReminderPreferencesCard
            config={reminderConfig}
            onChange={async updates => {
              await updateReminder(updates)
              setNotice({ open: true, message: '提醒规则设置已保存', severity: 'success' })
            }}
            disabled={loadingPrefs}
          />
        </Collapse>

        {/* 设置：折叠保留 DisplayPreferencesCard 全部功能 */}
        <MineEntry
          icon={<SettingsIcon />}
          title="设置"
          subtitle="界面显示偏好与隐私模式"
          onClick={() => setOpenSettings(v => !v)}
          expanded={openSettings}
        />
        <Collapse in={openSettings} sx={{ width: '100%' }}>
          <DisplayPreferencesCard
            config={displayConfig}
            onChange={async updates => {
              await updateDisplay(updates)
              setNotice({ open: true, message: '界面显示偏好已保存', severity: 'success' })
            }}
            disabled={loadingPrefs}
          />
        </Collapse>

        {/* 退出登录（单独一行，避免误触） */}
        <Paper
          elevation={0}
          sx={{
            backgroundColor: 'var(--paper)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius-card)',
            px: 2,
            py: 1.75,
            mt: 1,
          }}
        >
          <Button
            fullWidth
            variant="text"
            color="error"
            startIcon={<LogoutIcon />}
            onClick={handleSignOut}
            sx={{ fontWeight: 700, borderRadius: 2.5, textTransform: 'none' }}
          >
            退出登录
          </Button>
        </Paper>
      </Stack>

      <Snackbar
        open={notice.open}
        autoHideDuration={2500}
        onClose={() => setNotice(prev => ({ ...prev, open: false }))}
      >
        <Alert
          severity={notice.severity}
          icon={notice.severity === 'success' ? <CheckCircleIcon fontSize="small" /> : undefined}
        >
          {notice.message}
        </Alert>
      </Snackbar>
    </Container>
  )
}
