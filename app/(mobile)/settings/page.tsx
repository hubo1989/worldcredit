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
  Chip,
  Collapse,
  Paper,
} from '@mui/material'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import CheckCircleIcon from '@mui/icons-material/CheckCircleOutline'
import ForwardIcon from '@mui/icons-material/ForwardToInbox'
import AdminIcon from '@mui/icons-material/AdminPanelSettings'
import LogoutIcon from '@mui/icons-material/Logout'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/auth'
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
        // 每个入口行：无边框，层级由分层阴影表达（列表深度 12px）
        backgroundColor: 'var(--paper)',
        border: 0,
        borderRadius: 'var(--radius-depth-1)',
        boxShadow: 'var(--shadow-e1)',
        px: 2,
        py: 1.75,
        cursor: 'pointer',
        transition: 'box-shadow 150ms var(--ease-out), background-color 150ms var(--ease-out)',
        '&:active': { backgroundColor: 'rgba(10, 31, 68, 0.03)' },
      }}
    >
      {/*
        360 下「带状态 chip」的行可用宽度 = 296 − 图标 48 − chip 88 − 右箭头 24
        − 3×12px 间距 = 100px，比「邮箱账单导入」自身需要的 110px 窄，标题于是被
        折成「邮箱账单导 / 入」。标题与 chip 都是不可拆的语义单元，所以只对这一行
        把行间距从 12px 收到 8px 腾出 12px；其余入口行保持原 12px 节奏不变。
      */}
      <Stack direction="row" spacing={rightSlot ? 1 : 1.5} alignItems="center">
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
            color: 'var(--strong)',
            flexShrink: 0,
            '& svg': { fontSize: 22 },
          }}
        >
          {icon}
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontSize: 'var(--type-section-size)',
              lineHeight: 'var(--type-section-line)',
              fontWeight: 'var(--type-section-weight)',
              letterSpacing: 'var(--type-section-tracking)',
              color: 'var(--text)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {title}
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
              mt: 0.25,
              // 带 rightSlot（如「专属就绪」Chip）的行会窄约 88px。这里不截断：
              // 「专属地址直传，免登记来源邮箱」被省略号吃掉半句就丢了功能说明，
              // 实测折到 2 行只让该行高 76→90px（+14px），信息完整更值。
              // 标题本身仍是 nowrap + ellipsis，保证列表首行对齐。
            }}
          >
            {subtitle}
          </Typography>
        </Box>
        {rightSlot}
        {/* 右箭头：跳转项用 ChevronRightIcon；可折叠项展开后用 ChevronDownIcon */}
        <Box sx={{ color: 'var(--text-disabled)', display: 'flex', alignItems: 'center', '& svg': { fontSize: 20 } }}>
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

  // 用会话 role 判定（服务端按 lib/admin-emails.ts 写入），不再在浏览器端
  // 维护第二份邮箱白名单，避免与服务端口径漂移。
  const isAdmin = user?.role === 'admin'

  const handleSignOut = async () => {
    try {
      await signOut()
      router.push('/login')
    } catch (err) {
      setNotice({ open: true, message: err instanceof Error ? err.message : '退出登录失败', severity: 'error' })
    }
  }

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

  return (
    <Container sx={{ py: 3, pb: 12 }}>
      {/* 顶部标题「我的」+ 用户标识 */}
      <Typography
        variant="h5"
        sx={{
          fontSize: 'var(--type-title-size)',
          lineHeight: 'var(--type-title-line)',
          fontWeight: 'var(--type-title-weight)',
          letterSpacing: 'var(--type-title-tracking)',
          color: 'var(--text)',
          mb: 0.5,
        }}
      >
        我的
      </Typography>
      <Typography
        sx={{
          fontSize: 'var(--type-body-size)',
          lineHeight: 'var(--type-body-line)',
          letterSpacing: 'var(--type-body-tracking)',
          color: 'var(--muted)',
          mb: 2.5,
        }}
      >
        {user?.email || '已登录用户'}
      </Typography>

      <Stack spacing={2}>
        {/* 管理员专属控制台卡片（保留） */}
        {isAdmin && (
          <Card
            sx={{
              // 管理端靛蓝：取 Design.md admin-indigo 色阶最深两档
              background: 'linear-gradient(135deg, #312e81 0%, #3730a3 100%)',
              color: '#ffffff',
              border: 0,
              borderRadius: 'var(--radius-depth-3)',
              // 管理端品牌浮层：靛蓝光晕而非中性分层
              boxShadow: '0 8px 32px rgba(49, 46, 129, 0.25)',
            }}
          >
            <CardContent sx={{ p: 2.5 }}>
              <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
                <Box>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                    <AdminIcon color="warning" fontSize="small" />
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      系统管理员权限
                    </Typography>
                  </Stack>
                  <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'rgba(255,255,255,0.85)', display: 'block' }}>
                    管理全平台银行、卡产品、公共权益与 AI 配置
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  color="warning"
                  size="small"
                  onClick={() => router.push('/admin')}
                  sx={{ fontWeight: 700, whiteSpace: 'nowrap', borderRadius: 'var(--radius-pill)' }}
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
          subtitle="专属地址直传，免登记来源邮箱"
          onClick={() => setOpenGmail(v => !v)}
          expanded={openGmail}
          rightSlot={
            <Chip
              size="small"
              label="专属就绪"
              color="primary"
              variant="outlined"
              sx={{ mr: 0.5, fontWeight: 600 }}
            />
          }
        />

        {/* 邮箱账单导入展开区：仅保留专属地址直传 */}
        <Collapse in={openGmail} sx={{ width: '100%' }}>
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: -0.5 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ImportIcon />}
                onClick={() => router.push('/gmail-ledger')}
                sx={{ borderRadius: 'var(--radius-pill)', fontWeight: 600 }}
              >
                查看邮箱账单明细流水
              </Button>
            </Box>
            {/* 账单自动录入地址 */}
            <Card elevation={0} sx={{ border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e2)' }}>
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
                      bgcolor: 'rgba(37,99,235,0.10)',
                      color: 'var(--strong)',
                    }}
                  >
                    <ForwardIcon fontSize="small" />
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Typography
                      variant="h6"
                      sx={{
                        fontSize: 'var(--type-section-size)',
                        lineHeight: 'var(--type-section-line)',
                        fontWeight: 'var(--type-section-weight)',
                        letterSpacing: 'var(--type-section-tracking)',
                        color: 'var(--text)',
                      }}
                    >
                      收账单邮箱
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 'var(--type-body-size)',
                        lineHeight: 'var(--type-body-line)',
                        letterSpacing: 'var(--type-body-tracking)',
                        color: 'var(--muted)',
                      }}
                    >
                      转发银行账单至以下地址，系统将自动解析入库
                    </Typography>
                  </Box>
                </Stack>

                <Divider sx={{ my: 2, borderStyle: 'dashed', borderColor: 'var(--track)' }} />

                <Stack spacing={1.5}>
                  {forwardAddress && (
                    <Box
                      sx={{
                        bgcolor: 'background.default',
                        borderRadius: 'var(--radius-depth-1)',
                        p: 1.75,
                        border: 0,
                        boxShadow: 'var(--shadow-e1)',
                      }}
                    >
                      <Stack direction="row" alignItems="center" spacing={1}>
                        <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
                            sx={{
                              fontSize: 'var(--type-body-size)',
                              lineHeight: 'var(--type-body-line)',
                              letterSpacing: 'var(--type-body-tracking)',
                              color: 'var(--muted)',
                              fontWeight: 600,
                            }}
                          >
                            专属地址
                          </Typography>
                          <Typography
                            variant="body2"
                            className="num-tabular"
                            sx={{
                              fontFamily: 'var(--font-mono)',
                              fontSize: 'var(--type-body-size)',
                              lineHeight: 'var(--type-body-line)',
                              fontWeight: 600,
                              color: 'var(--text)',
                              wordBreak: 'break-all',
                              mt: 0.25,
                            }}
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
                </Stack>

                <Alert severity="info" sx={{ mt: 2, borderRadius: 'var(--radius-depth-1)' }}>
                  该地址包含你的用户 ID，系统按收件地址即可归属到你的账号，无需登记来源邮箱。请用自动转发规则把银行账单转到此地址。
                </Alert>
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
            border: 0,
            borderRadius: 'var(--radius-depth-1)',
            boxShadow: 'var(--shadow-e1)',
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
            sx={{ fontWeight: 700, borderRadius: 'var(--radius-pill)', textTransform: 'none' }}
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
