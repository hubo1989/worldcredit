'use client'

import { useState, useEffect } from 'react'
import {
  Box, Typography, Paper, Button, TextField, Grid,
  Switch, CircularProgress, Alert, Snackbar
} from '@mui/material'
import { Save as SaveIcon } from '@mui/icons-material'
import { getSystemSettings, updateSystemSettings } from '@/lib/api/admin'

interface SystemSettings {
  platformName: string
  supportEmail: string
  enableRegistration: boolean
  maintenanceMode: boolean
  defaultCurrency: string
  /** 服务端只回是否已配置，绝不回显密钥本身 */
  ai_api_key_set?: boolean
  ai_base_url?: string
  ai_model?: string
  [key: string]: unknown
}

/** 服务端派生的状态标志（<key>_set），不是可写设置，保存时须排除。 */
const isDerivedSettingKey = (key: string) => key.endsWith('_set')

export default function SettingsPage() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [settings, setSettings] = useState<SystemSettings>({
    platformName: 'WorldCredit',
    supportEmail: 'support@worldcredit.com',
    enableRegistration: true,
    maintenanceMode: false,
    defaultCurrency: 'CNY'
  })
  const [snackbar, setSnackbar] = useState({ open: false, message: '', severity: 'success' as 'success' | 'error' })
  const [aiKeyConfigured, setAiKeyConfigured] = useState(false)
  // 只写不读的草稿：密钥从不从服务端取回，输入框始终为空
  const [aiApiKeyInput, setAiApiKeyInput] = useState('')

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true)
      try {
        const data = await getSystemSettings()
        if (Object.keys(data).length > 0) {
          setAiKeyConfigured(data.ai_api_key_set === true)
          setSettings(prev => ({ ...prev, ...data }) as SystemSettings)
        }
      } catch (error) {
        console.error('Failed to fetch settings:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [])

  const handleSave = async (key: string, value: string | boolean) => {
    setSaving(true)
    try {
      await updateSystemSettings(key, value)
      setSettings({ ...settings, [key]: value })
      setSnackbar({ open: true, message: '设置已更新', severity: 'success' })
    } catch (error) {
      console.error('Update failed:', error)
      setSnackbar({ open: true, message: '更新失败', severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAll = async () => {
    setSaving(true)
    try {
      await Promise.all(
        Object.entries(settings)
          .filter(([k]) => !isDerivedSettingKey(k))
          .map(([k, v]) => updateSystemSettings(k, v))
      )
      setSnackbar({ open: true, message: '全局设置已保存', severity: 'success' })
    } catch (error) {
      console.error('Save all failed:', error)
      setSnackbar({ open: true, message: '部分设置保存失败', severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  /** 密钥单独保存：只在用户输入了新值时才写入，避免空值覆盖已配置密钥。 */
  const handleSaveAiKey = async () => {
    if (!aiApiKeyInput.trim()) {
      setSnackbar({ open: true, message: '请输入新的 API Key', severity: 'error' })
      return
    }
    setSaving(true)
    try {
      await updateSystemSettings('ai_api_key', aiApiKeyInput.trim())
      setAiApiKeyInput('')
      setAiKeyConfigured(true)
      setSnackbar({ open: true, message: 'API Key 已更新', severity: 'success' })
    } catch (error) {
      console.error('Update AI key failed:', error)
      setSnackbar({ open: true, message: 'API Key 更新失败', severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress sx={{ color: '#818cf8' }} /></Box>
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ color: '#e4e6eb', fontWeight: 700, mb: 0.5 }}>
            系统设置
          </Typography>
          <Typography variant="body2" sx={{ color: '#9ca3af' }}>
            配置全平台基础参数、运行模式及通知信息
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSaveAll}
          disabled={saving}
          sx={{ bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' }, textTransform: 'none', borderRadius: 2, px: 3 }}
        >
          {saving ? '保存中...' : '保存全部'}
        </Button>
      </Box>

      <Grid container spacing={4}>
        {/* 基础配置 */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 4, bgcolor: '#181a24', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 3 }}>
            <Typography variant="h6" sx={{ color: '#e4e6eb', mb: 3, fontWeight: 600 }}>平台基础信息</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <TextField
                fullWidth
                label="平台标题"
                value={settings.platformName}
                onChange={(e) => setSettings({ ...settings, platformName: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
              <TextField
                fullWidth
                label="客服支持邮箱"
                value={settings.supportEmail}
                onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
              <TextField
                fullWidth
                label="默认记账币种"
                value={settings.defaultCurrency}
                onChange={(e) => setSettings({ ...settings, defaultCurrency: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Box>
          </Paper>
        </Grid>

        {/* 运行状态控制 */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Paper sx={{ p: 4, bgcolor: '#181a24', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 3, height: '100%' }}>
            <Typography variant="h6" sx={{ color: '#e4e6eb', mb: 3, fontWeight: 600 }}>运行状态控制</Typography>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 2 }}>
                <Box>
                  <Typography sx={{ color: '#e4e6eb', fontWeight: 500 }}>开放新用户注册</Typography>
                  <Typography variant="caption" sx={{ color: '#9ca3af' }}>关闭后，登录页将隐藏注册入口</Typography>
                </Box>
                <Switch
                  checked={settings.enableRegistration}
                  onChange={(e) => handleSave('enableRegistration', e.target.checked)}
                  sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: 'primary.main' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: 'primary.main' } }}
                />
              </Box>

              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', p: 2, bgcolor: 'rgba(255,255,255,0.02)', borderRadius: 2 }}>
                <Box>
                  <Typography sx={{ color: '#e4e6eb', fontWeight: 500 }}>维护模式</Typography>
                  <Typography variant="caption" sx={{ color: '#9ca3af' }}>开启后，非管理员用户登录将显示维护提示</Typography>
                </Box>
                <Switch
                  checked={settings.maintenanceMode}
                  onChange={(e) => handleSave('maintenanceMode', e.target.checked)}
                  sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#f59e0b' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#f59e0b' } }}
                />
              </Box>

              <Alert
                severity="warning"
                sx={{ bgcolor: 'rgba(245, 158, 11, 0.05)', color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.2)', '& .MuiAlert-icon': { color: '#f59e0b' } }}
              >
                维护模式会立即中断所有普通用户的实时会话，请谨慎操作。
              </Alert>
            </Box>
          </Paper>
        </Grid>

        {/* AI Agent 配置 */}
        <Grid size={{ xs: 12 }}>
          <Paper sx={{ p: 4, bgcolor: '#181a24', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 3 }}>
            <Typography variant="h6" sx={{ color: '#e4e6eb', mb: 1, fontWeight: 600 }}>AI Agent 自动化配置</Typography>
            <Typography variant="body2" sx={{ color: '#9ca3af', mb: 3 }}>
              集成 OpenAI 兼容接口，为银行和信用卡管理提供自动补全功能
            </Typography>
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 4 }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <TextField
                    fullWidth
                    label="API Key"
                    type="password"
                    autoComplete="new-password"
                    placeholder={aiKeyConfigured ? '已配置（留空则保持不变）' : 'sk-...'}
                    value={aiApiKeyInput}
                    onChange={(e) => setAiApiKeyInput(e.target.value)}
                    InputLabelProps={{ style: { color: '#9ca3af' } }}
                    sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="caption" sx={{ color: aiKeyConfigured ? '#4ade80' : '#9ca3af' }}>
                      {aiKeyConfigured ? '● 已配置' : '○ 未配置'}
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={handleSaveAiKey}
                      disabled={saving}
                      sx={{ textTransform: 'none', color: '#818cf8', borderColor: 'rgba(129,140,248,0.5)' }}
                    >
                      保存密钥
                    </Button>
                  </Box>
                  <Typography variant="caption" sx={{ color: '#9ca3af' }}>
                    密钥仅存于服务端，保存后不再回显；AI 调用由服务端代为执行。
                  </Typography>
                </Box>
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  fullWidth
                  label="API Base URL (OpenAI 兼容)"
                  placeholder="https://api.openai.com/v1"
                  value={settings.ai_base_url || ''}
                  onChange={(e) => setSettings({ ...settings, ai_base_url: e.target.value })}
                  InputLabelProps={{ style: { color: '#9ca3af' } }}
                  sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 4 }}>
                <TextField
                  fullWidth
                  label="Model ID"
                  placeholder="gpt-4o"
                  value={settings.ai_model || ''}
                  onChange={(e) => setSettings({ ...settings, ai_model: e.target.value })}
                  InputLabelProps={{ style: { color: '#9ca3af' } }}
                  sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
                />
              </Grid>
            </Grid>
          </Paper>
        </Grid>
      </Grid>

      <Snackbar
        open={snackbar.open}
        autoHideDuration={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      >
        <Alert severity={snackbar.severity} variant="filled" sx={{ width: '100%' }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
