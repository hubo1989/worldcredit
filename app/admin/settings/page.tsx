'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/obsidian/controls'
import { TextField } from '@/components/obsidian/fields'
import { Toggle } from '@/components/obsidian/controls'
import { Alert, Spinner } from '@/components/obsidian/feedback'
import { Toast } from '@/components/obsidian/overlays'
import { CheckIcon } from '@/components/icons/WcIcon'
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
    return (
      <div className='flex justify-center py-16'>
        <Spinner size={28} />
      </div>
    )
  }

  return (
    <div>
      <div className='mb-8 flex items-center justify-between gap-4'>
        <div>
          <h1 className='mb-1 text-[26px] font-bold'>系统设置</h1>
          <p className='text-[13px] text-d-muted'>配置全平台基础参数、运行模式及通知信息</p>
        </div>
        <Button onClick={handleSaveAll} loading={saving}>
          <CheckIcon size={16} />
          {saving ? '保存中...' : '保存全部'}
        </Button>
      </div>

      <div className='grid grid-cols-1 gap-8 md:grid-cols-2'>
        {/* 基础配置 */}
        <div className='rounded-2xl border border-d-border bg-d-surface p-6'>
          <p className='mb-6 text-[16px] font-semibold'>平台基础信息</p>
          <div className='flex flex-col gap-6'>
            <TextField
              label="平台标题"
              value={settings.platformName}
              onChange={(e) => setSettings({ ...settings, platformName: e.target.value })}
            />
            <TextField
              label="客服支持邮箱"
              value={settings.supportEmail}
              onChange={(e) => setSettings({ ...settings, supportEmail: e.target.value })}
            />
            <TextField
              label="默认记账币种"
              value={settings.defaultCurrency}
              onChange={(e) => setSettings({ ...settings, defaultCurrency: e.target.value })}
            />
          </div>
        </div>

        {/* 运行状态控制 */}
        <div className='h-full rounded-2xl border border-d-border bg-d-surface p-6'>
          <p className='mb-6 text-[16px] font-semibold'>运行状态控制</p>
          <div className='flex flex-col gap-4'>
            <div className='flex items-center justify-between rounded-xl bg-d-subtle/50 p-4'>
              <div>
                <p className='text-[14px] font-medium'>开放新用户注册</p>
                <p className='text-[12px] text-d-muted'>关闭后，登录页将隐藏注册入口</p>
              </div>
              <Toggle
                checked={settings.enableRegistration}
                onChange={(v) => handleSave('enableRegistration', v)}
                ariaLabel='开放新用户注册'
              />
            </div>

            <div className='flex items-center justify-between rounded-xl bg-d-subtle/50 p-4'>
              <div>
                <p className='text-[14px] font-medium'>维护模式</p>
                <p className='text-[12px] text-d-muted'>开启后，非管理员用户登录将显示维护提示</p>
              </div>
              <Toggle
                checked={settings.maintenanceMode}
                onChange={(v) => handleSave('maintenanceMode', v)}
                ariaLabel='维护模式'
              />
            </div>

            <Alert severity='warning'>
              维护模式会立即中断所有普通用户的实时会话，请谨慎操作。
            </Alert>
          </div>
        </div>

        {/* AI Agent 配置 */}
        <div className='rounded-2xl border border-d-border bg-d-surface p-6 md:col-span-2'>
          <p className='mb-1 text-[16px] font-semibold'>AI Agent 自动化配置</p>
          <p className='mb-6 text-[13px] text-d-muted'>
            集成 OpenAI 兼容接口，为银行和信用卡管理提供自动补全功能
          </p>
          <div className='grid grid-cols-1 gap-6 md:grid-cols-3'>
            <div className='flex flex-col gap-2'>
              <TextField
                label="API Key"
                type="password"
                autoComplete="new-password"
                placeholder={aiKeyConfigured ? '已配置（留空则保持不变）' : 'sk-...'}
                value={aiApiKeyInput}
                onChange={(e) => setAiApiKeyInput(e.target.value)}
              />
              <div className='flex items-center gap-2'>
                <span className={'text-[12px] ' + (aiKeyConfigured ? 'text-d-success-ink' : 'text-d-muted')}>
                  {aiKeyConfigured ? '● 已配置' : '○ 未配置'}
                </span>
                <Button
                  size='sm'
                  variant='secondary'
                  onClick={handleSaveAiKey}
                  disabled={saving}
                >
                  保存密钥
                </Button>
              </div>
              <p className='text-[12px] text-d-muted'>
                密钥仅存于服务端，保存后不再回显；AI 调用由服务端代为执行。
              </p>
            </div>
            <TextField
              label="API Base URL (OpenAI 兼容)"
              placeholder="https://api.openai.com/v1"
              value={settings.ai_base_url || ''}
              onChange={(e) => setSettings({ ...settings, ai_base_url: e.target.value })}
            />
            <TextField
              label="Model ID"
              placeholder="gpt-4o"
              value={settings.ai_model || ''}
              onChange={(e) => setSettings({ ...settings, ai_model: e.target.value })}
            />
          </div>
        </div>
      </div>

      <Toast
        open={snackbar.open}
        message={snackbar.message}
        severity={snackbar.severity}
        autoHideMs={4000}
        onClose={() => setSnackbar({ ...snackbar, open: false })}
      />
    </div>
  )
}
