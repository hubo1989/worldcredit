'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import { Button, Toggle } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { Alert, Spinner } from '@/components/obsidian/feedback'
import { Toast, ConfirmDialog } from '@/components/obsidian/overlays'
import { CheckIcon } from '@/components/icons/WcIcon'
import { getSystemSettings, updateSystemSettings } from '@/lib/api/admin'
import { CURRENCY_OPTIONS } from '@/components/settings/shared'

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

const DEFAULT_SETTINGS: SystemSettings = {
  platformName: 'WorldCredit',
  supportEmail: 'support@worldcredit.com',
  enableRegistration: true,
  maintenanceMode: false,
  defaultCurrency: 'CNY',
  ai_base_url: 'https://api.openai.com/v1',
  ai_model: 'gpt-4o',
}

type DraftKey = 'platformName' | 'supportEmail' | 'defaultCurrency' | 'ai_base_url' | 'ai_model'
const DRAFT_KEYS: DraftKey[] = ['platformName', 'supportEmail', 'defaultCurrency', 'ai_base_url', 'ai_model']

export default function AdminSettingsPage() {
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [toggleBusy, setToggleBusy] = useState<'enableRegistration' | 'maintenanceMode' | null>(null)

  // 服务端真实基准值（用于对比 dirty 和防覆盖）
  const [serverSettings, setServerSettings] = useState<SystemSettings | null>(null)
  // 前端编辑草稿
  const [formSettings, setFormSettings] = useState<SystemSettings>(DEFAULT_SETTINGS)

  const [aiKeyConfigured, setAiKeyConfigured] = useState(false)
  // 只写不读：密钥从不从服务端取回，输入框始终初始为空
  const [aiApiKeyInput, setAiApiKeyInput] = useState('')

  // 维护模式高危确认弹窗
  const [confirmMaintenanceOpen, setConfirmMaintenanceOpen] = useState(false)

  const [notice, setNotice] = useState<{ open: boolean; message: string; severity: 'success' | 'error' }>({
    open: false,
    message: '',
    severity: 'success',
  })

  const fetchData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const data = await getSystemSettings()
      const merged: SystemSettings = {
        platformName: String(data.platformName || DEFAULT_SETTINGS.platformName),
        supportEmail: String(data.supportEmail || DEFAULT_SETTINGS.supportEmail),
        enableRegistration: data.enableRegistration !== false,
        maintenanceMode: Boolean(data.maintenanceMode),
        defaultCurrency: String(data.defaultCurrency || DEFAULT_SETTINGS.defaultCurrency),
        ai_base_url: String(data.ai_base_url || DEFAULT_SETTINGS.ai_base_url),
        ai_model: String(data.ai_model || DEFAULT_SETTINGS.ai_model),
      }
      setServerSettings(merged)
      setFormSettings(merged)
      setAiKeyConfigured(data.ai_api_key_set === true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : '拉取系统设置失败'
      console.error('Failed to fetch settings:', err)
      setLoadError(msg)
      setServerSettings(null) // 失败时清空，防止被保存覆盖
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // 计算 dirty 字段列表
  const dirtyKeys = useMemo(() => {
    if (!serverSettings) return []
    return DRAFT_KEYS.filter((k) => (formSettings[k] ?? '') !== (serverSettings[k] ?? ''))
  }, [serverSettings, formSettings])

  const hasDraftChanges = dirtyKeys.length > 0 || aiApiKeyInput.trim().length > 0
  const canSave = !loading && !loadError && serverSettings !== null && hasDraftChanges

  // 校验：邮箱格式
  const emailInvalid = Boolean(
    formSettings.supportEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formSettings.supportEmail)
  )

  // 统一保存草稿表单（基础参数 + AI 端点/模型 + 可选新 API Key）
  const handleSaveAll = async () => {
    if (!serverSettings || !canSave) return
    if (emailInvalid) {
      setNotice({ open: true, message: '请填写合法的客服支持邮箱', severity: 'error' })
      return
    }

    setSaving(true)
    try {
      // 1. 提交所有 dirty 字段（串行提交，避免并发写冲突导致丢更新）
      const succeededKeys: DraftKey[] = []
      const failedKeys: DraftKey[] = []

      for (const k of dirtyKeys) {
        try {
          await updateSystemSettings(k, formSettings[k] as string | boolean)
          succeededKeys.push(k)
        } catch (err) {
          failedKeys.push(k)
          console.error(`Failed to save setting ${k}:`, err)
        }
      }

      // 仅将成功的字段合并到 serverSettings，失败字段仍保留在 dirty 状态
      if (succeededKeys.length > 0) {
        setServerSettings((prev) => {
          if (!prev) return prev
          const updated = { ...prev }
          for (const k of succeededKeys) {
            // @ts-expect-error dynamic assign
            updated[k] = formSettings[k]
          }
          return updated
        })
      }

      // 2. 若用户输入了新的 API Key，独立安全更新
      let aiKeySuccess = true
      const hasAiKeyInput = Boolean(aiApiKeyInput.trim())
      if (hasAiKeyInput) {
        try {
          await updateSystemSettings('ai_api_key', aiApiKeyInput.trim())
          setAiApiKeyInput('')
          setAiKeyConfigured(true)
        } catch (err) {
          aiKeySuccess = false
          console.error('Failed to save ai_api_key:', err)
        }
      }

      // 3. 汇总成败提示
      const baseFailed = failedKeys.length > 0
      if (!baseFailed && aiKeySuccess) {
        setNotice({ open: true, message: '系统设置已保存', severity: 'success' })
      } else if (!baseFailed && !aiKeySuccess) {
        setNotice({
          open: true,
          message: '基础设置已保存，但 AI API 密钥更新失败，请重试',
          severity: 'error',
        })
      } else if (succeededKeys.length > 0) {
        const keyMsg = `部分设置已保存（${succeededKeys.length} 项成功，${failedKeys.length} 项失败）`
        const extraMsg = hasAiKeyInput
          ? aiKeySuccess
            ? '，API 密钥已保存'
            : '，API 密钥保存失败'
          : ''
        setNotice({
          open: true,
          message: `${keyMsg}${extraMsg}，未生效项已保留在编辑态`,
          severity: 'error',
        })
      } else {
        setNotice({
          open: true,
          message: '保存失败，请检查网络或服务状态',
          severity: 'error',
        })
      }
    } catch (err) {
      console.error('Save settings failed:', err)
      setNotice({ open: true, message: '保存失败，请检查网络或服务状态', severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  // 撤销未保存改动
  const handleResetDraft = () => {
    if (serverSettings) {
      setFormSettings({ ...serverSettings })
      setAiApiKeyInput('')
      setNotice({ open: true, message: '已撤销未保存的改动', severity: 'success' })
    }
  }

  // 运行控制开关保存
  const handleToggleRegistration = async (val: boolean) => {
    setToggleBusy('enableRegistration')
    try {
      await updateSystemSettings('enableRegistration', val)
      setFormSettings((prev) => ({ ...prev, enableRegistration: val }))
      setServerSettings((prev) => (prev ? { ...prev, enableRegistration: val } : prev))
      setNotice({ open: true, message: '新用户注册设置已更新', severity: 'success' })
    } catch (err) {
      console.error('Update registration failed:', err)
      setNotice({ open: true, message: '更新失败', severity: 'error' })
    } finally {
      setToggleBusy(null)
    }
  }

  const handleMaintenanceToggleClick = (val: boolean) => {
    if (val) {
      // 开启维护模式：拦截弹窗确认
      setConfirmMaintenanceOpen(true)
    } else {
      // 关闭维护模式：直接执行
      void executeMaintenanceChange(false)
    }
  }

  const executeMaintenanceChange = async (val: boolean) => {
    setToggleBusy('maintenanceMode')
    setConfirmMaintenanceOpen(false)
    try {
      await updateSystemSettings('maintenanceMode', val)
      setFormSettings((prev) => ({ ...prev, maintenanceMode: val }))
      setServerSettings((prev) => (prev ? { ...prev, maintenanceMode: val } : prev))
      setNotice({
        open: true,
        message: val ? '已开启维护模式' : '维护模式已关闭',
        severity: 'success',
      })
    } catch (err) {
      console.error('Update maintenance mode failed:', err)
      setNotice({ open: true, message: '更新维护模式失败', severity: 'error' })
    } finally {
      setToggleBusy(null)
    }
  }

  // 单独更新 API Key
  const handleSaveAiKeyOnly = async () => {
    if (!aiApiKeyInput.trim()) {
      setNotice({ open: true, message: '请输入新的 API Key', severity: 'error' })
      return
    }
    setSaving(true)
    try {
      await updateSystemSettings('ai_api_key', aiApiKeyInput.trim())
      setAiApiKeyInput('')
      setAiKeyConfigured(true)
      setNotice({ open: true, message: 'API Key 已更新', severity: 'success' })
    } catch (err) {
      console.error('Update AI key failed:', err)
      setNotice({ open: true, message: 'API Key 更新失败', severity: 'error' })
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className='flex justify-center py-24'>
        <Spinner size={32} />
      </div>
    )
  }

  return (
    <div className='pb-12 text-d-text'>
      {/* 顶栏：标题 + 统一保存/重置控制 */}
      <div className='mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h1 className='text-[24px] font-bold tracking-tight'>系统设置</h1>
          <p className='mt-1 text-[13px] text-d-muted'>
            配置全平台基础参数、准入运行模式及 AI 自动化参数
          </p>
        </div>
        <div className='flex items-center gap-2.5'>
          {hasDraftChanges && (
            <Button variant='secondary' size='sm' onClick={handleResetDraft} disabled={saving}>
              撤销更改
            </Button>
          )}
          <Button onClick={handleSaveAll} loading={saving} disabled={!canSave}>
            <CheckIcon size={16} />
            {saving ? '保存中...' : hasDraftChanges ? '保存更改' : '已是最新'}
          </Button>
        </div>
      </div>

      {/* 首屏异常告警防护：拉取失败时禁用「保存更改」，严禁覆写线上配置 */}
      {loadError && (
        <div className='mb-6'>
          <Alert severity='error'>
            <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <p className='font-semibold'>配置拉取失败，已锁死保存操作</p>
                <p className='text-[12px] opacity-90'>
                  错误信息：{loadError}。系统禁止在加载失败状态下覆盖线上配置，请检查服务连接后重试。
                </p>
              </div>
              <Button size='sm' variant='secondary' onClick={fetchData}>
                重试加载
              </Button>
            </div>
          </Alert>
        </div>
      )}

      {/* 维护模式高危常驻警告条 */}
      {formSettings.maintenanceMode && (
        <div className='mb-6'>
          <Alert severity='warning'>
            <div className='flex items-center justify-between'>
              <span>
                <strong>当前系统处于维护模式</strong>：所有非管理员用户的在线访问已中断。
              </span>
              <button
                type='button'
                onClick={() => handleMaintenanceToggleClick(false)}
                className='ml-3 rounded-lg border border-d-border bg-d-subtle px-2.5 py-1 text-[11px] font-semibold text-d-text hover:bg-d-surface'
              >
                立即解除维护
              </button>
            </div>
          </Alert>
        </div>
      )}

      {/* 设置主网格 */}
      <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
        {/* 左列：平台基础信息（统一草稿表单组） */}
        <div className='rounded-2xl border border-d-border bg-d-surface p-5 sm:p-6'>
          <div className='mb-5 flex items-center justify-between'>
            <p className='text-[16px] font-bold'>平台基础信息</p>
            <span className='rounded bg-d-subtle px-2 py-0.5 text-[11px] font-medium text-d-muted'>
              统一草稿保存
            </span>
          </div>

          <div className='flex flex-col gap-5'>
            <TextField
              label='平台标题'
              value={formSettings.platformName}
              disabled={!serverSettings}
              onChange={(e) => setFormSettings({ ...formSettings, platformName: e.target.value })}
            />

            <TextField
              label='客服支持邮箱'
              type='email'
              value={formSettings.supportEmail}
              disabled={!serverSettings}
              error={emailInvalid}
              helperText={emailInvalid ? '请输入合法的邮箱格式（如 support@example.com）' : undefined}
              onChange={(e) => setFormSettings({ ...formSettings, supportEmail: e.target.value })}
            />

            <SelectField
              label='默认记账币种'
              value={formSettings.defaultCurrency}
              options={CURRENCY_OPTIONS}
              disabled={!serverSettings}
              onChange={(e) => setFormSettings({ ...formSettings, defaultCurrency: e.target.value })}
              helperText='新持卡人建档与无币种交易的默认基准币种'
            />
          </div>
        </div>

        {/* 右列：运行与准入控制卡（实时开关组，即时生效） */}
        <div className='flex flex-col justify-between rounded-2xl border border-d-border bg-d-surface p-5 sm:p-6'>
          <div>
            <div className='mb-5 flex items-center justify-between'>
              <p className='text-[16px] font-bold'>准入与运行控制</p>
              <span className='rounded bg-d-accent/20 px-2 py-0.5 text-[11px] font-medium text-d-accent-light'>
                即时生效
              </span>
            </div>

            <div className='flex flex-col gap-4'>
              <div className='flex min-h-[52px] items-center justify-between rounded-xl border border-d-border/60 bg-d-subtle/50 p-4'>
                <div className='min-w-0 pr-3'>
                  <p className='text-[14px] font-semibold text-d-text'>开放新用户注册</p>
                  <p className='mt-0.5 text-[12px] text-d-muted'>
                    关闭后，登录页将隐藏注册入口，仅受邀用户可访问
                  </p>
                </div>
                <Toggle
                  checked={formSettings.enableRegistration}
                  disabled={!serverSettings || toggleBusy === 'enableRegistration'}
                  onChange={handleToggleRegistration}
                  ariaLabel='开放新用户注册'
                />
              </div>

              <div className='flex min-h-[52px] items-center justify-between rounded-xl border border-d-border/60 bg-d-subtle/50 p-4'>
                <div className='min-w-0 pr-3'>
                  <div className='flex items-center gap-2'>
                    <p className='text-[14px] font-semibold text-d-text'>全站维护模式</p>
                    {formSettings.maintenanceMode && (
                      <span className='rounded-full bg-d-danger/20 px-2 py-0.5 text-[10px] font-bold text-d-danger-ink border border-d-danger/40'>
                        已开启
                      </span>
                    )}
                  </div>
                  <p className='mt-0.5 text-[12px] text-d-muted'>
                    开启后立即阻断非管理员访问，需二次确认防止误触
                  </p>
                </div>
                <Toggle
                  checked={formSettings.maintenanceMode}
                  disabled={!serverSettings || toggleBusy === 'maintenanceMode'}
                  onChange={handleMaintenanceToggleClick}
                  ariaLabel='全站维护模式'
                />
              </div>
            </div>
          </div>

          <div className='mt-4 rounded-xl border border-d-border/60 bg-d-bg p-3'>
            <p className='text-[12px] leading-5 text-d-muted'>
              💡 准入开关直接作用于边缘 Worker 鉴权中间件，切换后无需点击上方「保存更改」即可全局即刻生效。
            </p>
          </div>
        </div>

        {/* 通栏底卡：AI Agent 自动化配置 */}
        <div className='rounded-2xl border border-d-border bg-d-surface p-5 sm:p-6 md:col-span-2'>
          <div className='mb-2 flex items-center justify-between'>
            <p className='text-[16px] font-bold'>AI Agent 自动化配置</p>
            <span className='rounded bg-d-subtle px-2 py-0.5 text-[11px] font-medium text-d-muted'>
              密钥独立写入 · 端点统一草稿
            </span>
          </div>
          <p className='mb-6 text-[13px] text-d-muted'>
            集成 OpenAI 兼容接口，为银行账单解析、汇率折算与智能补全提供大模型算力支持。
          </p>

          <div className='grid grid-cols-1 gap-6 md:grid-cols-3'>
            {/* 凭据区：只写不回显 */}
            <div className='flex flex-col justify-between rounded-xl border border-d-border/60 bg-d-subtle/30 p-4'>
              <div>
                <TextField
                  label='API Key（只写不回显）'
                  type='password'
                  autoComplete='new-password'
                  placeholder={aiKeyConfigured ? '已配置（留空保持原密钥）' : 'sk-...'}
                  value={aiApiKeyInput}
                  disabled={!serverSettings}
                  onChange={(e) => setAiApiKeyInput(e.target.value)}
                  helperText='密钥绝不从服务端回显；保存后原密文由 Cloudflare 安全隔离。'
                />
              </div>
              <div className='mt-4 flex items-center justify-between pt-2'>
                <span
                  className={
                    'text-[12px] font-semibold ' +
                    (aiKeyConfigured ? 'text-d-success-ink' : 'text-d-muted')
                  }
                >
                  {aiKeyConfigured ? '● 密钥已就绪' : '○ 尚未配置密钥'}
                </span>
                <Button
                  size='sm'
                  variant='secondary'
                  disabled={!aiApiKeyInput.trim() || saving || !serverSettings}
                  onClick={handleSaveAiKeyOnly}
                >
                  单独更新密钥
                </Button>
              </div>
            </div>

            {/* 端点与模型：统一纳入表单草稿 */}
            <div className='md:col-span-2 flex flex-col gap-4 rounded-xl border border-d-border/60 bg-d-subtle/30 p-4'>
              <TextField
                label='API Base URL (OpenAI 兼容端点)'
                placeholder='https://api.openai.com/v1'
                value={formSettings.ai_base_url || ''}
                disabled={!serverSettings}
                onChange={(e) => setFormSettings({ ...formSettings, ai_base_url: e.target.value })}
                helperText='支持官方 OpenAI、Cloudflare AI Gateway 或自建反向代理'
              />
              <TextField
                label='Model ID (大模型标识符)'
                placeholder='gpt-4o'
                value={formSettings.ai_model || ''}
                disabled={!serverSettings}
                onChange={(e) => setFormSettings({ ...formSettings, ai_model: e.target.value })}
                helperText='推荐使用具备视觉或结构化输出能力的模型（如 gpt-4o, claude-3-5-sonnet）'
              />
            </div>
          </div>
        </div>
      </div>

      {/* 维护模式高危拦截确认弹窗 */}
      <ConfirmDialog
        open={confirmMaintenanceOpen}
        title='开启全站维护模式'
        onClose={() => setConfirmMaintenanceOpen(false)}
        actions={
          <>
            <button
              type='button'
              onClick={() => setConfirmMaintenanceOpen(false)}
              className='min-h-[40px] rounded-xl border border-d-border bg-d-subtle px-4 text-[13px] font-semibold text-d-muted transition-colors active:bg-d-surface'
            >
              取消
            </button>
            <button
              type='button'
              onClick={() => executeMaintenanceChange(true)}
              className='min-h-[40px] rounded-xl bg-d-danger px-4 text-[13px] font-semibold text-white transition-opacity active:opacity-85'
            >
              确认开启维护
            </button>
          </>
        }
      >
        <p className='text-[13px] leading-5 text-d-muted'>
          开启全站维护模式后，所有普通用户的实时访问与会话将立即中断，仅管理员账号允许登录后台。确定立即开启吗？
        </p>
      </ConfirmDialog>

      {/* 统一反馈 Toast */}
      <Toast
        open={notice.open}
        message={notice.message}
        severity={notice.severity}
        autoHideMs={3500}
        onClose={() => setNotice((prev) => ({ ...prev, open: false }))}
      />
    </div>
  )
}
