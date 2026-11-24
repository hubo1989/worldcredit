'use client'
// components/mobile/StatementPasswordVaultPanel.tsx — 家庭月结单密码本管理面板。
// 密码只写不读：列表仅展示规则名称、关联持卡人/银行、提示词与命中次数，永不回显明文密码。
import { useCallback, useEffect, useState } from 'react'
import { Modal, ConfirmDialog } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { Alert, Spinner } from '@/components/obsidian/feedback'
import { LockIcon, PlusIcon, TrashIcon } from '@/components/icons/WcIcon'
import { getHolders } from '@/lib/api/holders'
import { getBanks, type BankItem } from '@/lib/api/banks'
import type { CardHolder } from '@/lib/types'
import {
  listPasswordRules,
  createPasswordRule,
  updatePasswordRule,
  deletePasswordRule,
  type StatementPasswordRuleDto,
} from './omnibusApi'

const HINT_TEMPLATES = ['身份证后6位', '生日 DDMMYYYY', '查询密码', '证件号后6位']

export function StatementPasswordVaultPanel() {
  const [rules, setRules] = useState<StatementPasswordRuleDto[]>([])
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [banks, setBanks] = useState<BankItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<StatementPasswordRuleDto | null>(null)
  const [label, setLabel] = useState('')
  const [password, setPassword] = useState('')
  const [holderId, setHolderId] = useState('')
  const [bankId, setBankId] = useState('')
  const [bankKeyword, setBankKeyword] = useState('')
  const [hint, setHint] = useState('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const [deletingRule, setDeletingRule] = useState<StatementPasswordRuleDto | null>(null)
  const [deleting, setDeleting] = useState(false)

  const reload = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [ruleList, holderList, bankList] = await Promise.all([
        listPasswordRules(),
        getHolders().catch(() => [] as CardHolder[]),
        getBanks().catch(() => [] as BankItem[]),
      ])
      setRules(ruleList)
      setHolders(holderList)
      setBanks(bankList)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载月结单密码本失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const openCreate = () => {
    setEditingRule(null)
    setLabel('')
    setPassword('')
    setHolderId('')
    setBankId('')
    setBankKeyword('')
    setHint('')
    setFormError(null)
    setFormOpen(true)
  }

  const openEdit = (rule: StatementPasswordRuleDto) => {
    setEditingRule(rule)
    setLabel(rule.label)
    setPassword('')
    setHolderId(rule.holder_id ?? '')
    setBankId(rule.bank_id ?? '')
    setBankKeyword(rule.bank_keyword ?? '')
    setHint(rule.hint ?? '')
    setFormError(null)
    setFormOpen(true)
  }

  const handleSave = async () => {
    setFormError(null)
    if (!label.trim()) {
      setFormError('请填写规则名称')
      return
    }
    if (!editingRule && !password) {
      setFormError('请输入 PDF 解密密码')
      return
    }
    setSaving(true)
    try {
      if (editingRule) {
        await updatePasswordRule(editingRule.id, {
          label: label.trim(),
          ...(password ? { password } : {}),
          holder_id: holderId || null,
          bank_id: bankId || null,
          bank_keyword: bankKeyword.trim() || null,
          hint: hint.trim() || null,
        })
      } else {
        await createPasswordRule({
          label: label.trim(),
          password,
          holder_id: holderId || null,
          bank_id: bankId || null,
          bank_keyword: bankKeyword.trim() || null,
          hint: hint.trim() || null,
        })
      }
      setFormOpen(false)
      await reload()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleConfirmDelete = async () => {
    if (!deletingRule) return
    setDeleting(true)
    try {
      await deletePasswordRule(deletingRule.id)
      setDeletingRule(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }

  const holderName = (id: string | null) =>
    id ? holders.find(h => h.id === id)?.name || '指定持卡人' : '全部持卡人'

  const bankName = (id: string | null, kw: string | null) => {
    if (id) return banks.find(b => b.id === id)?.name || kw || '指定银行'
    return kw || '通用银行'
  }

  return (
    <div className='rounded-2xl border border-d-border bg-d-surface p-4'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <p className='flex items-center gap-1.5 text-[15px] font-semibold text-d-text'>
            <LockIcon size={16} className='text-d-gold' />
            月结单密码本
          </p>
          <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
            解密密码采用 AES-GCM 加密保存（只写不读），用于自动解密邮件和上传的加密 PDF。
          </p>
        </div>
        <button
          type='button'
          onClick={openCreate}
          className='inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-xl bg-d-accent px-3 text-[12px] font-semibold text-white'
        >
          <PlusIcon size={14} />
          添加规则
        </button>
      </div>

      {error && (
        <div className='mt-3'>
          <Alert severity='error'>{error}</Alert>
        </div>
      )}

      {loading ? (
        <div className='flex justify-center py-6'>
          <Spinner size={20} />
        </div>
      ) : rules.length === 0 ? (
        <div className='mt-3 rounded-xl border border-dashed border-d-border bg-d-bg/50 px-4 py-5 text-center'>
          <p className='text-[13px] text-d-muted'>
            尚未添加密码规则。添加后收到加密 PDF 月结单将自动尝试解密。
          </p>
        </div>
      ) : (
        <div className='mt-3 flex flex-col gap-2'>
          {rules.map(rule => (
            <div
              key={rule.id}
              className='flex items-center justify-between gap-3 rounded-xl border border-d-border bg-d-bg/60 p-3'
            >
              <div className='min-w-0 flex-1'>
                <p className='truncate text-[14px] font-semibold text-d-text'>{rule.label}</p>
                <div className='mt-1 flex flex-wrap gap-1.5 text-[11px]'>
                  <span className='rounded-md border border-d-border bg-d-surface px-1.5 py-0.5 text-d-muted'>
                    {holderName(rule.holder_id)}
                  </span>
                  <span className='rounded-md border border-d-border bg-d-surface px-1.5 py-0.5 text-d-muted'>
                    {bankName(rule.bank_id, rule.bank_keyword)}
                  </span>
                  {rule.hint && (
                    <span className='rounded-md bg-d-gold-soft px-1.5 py-0.5 text-d-gold'>
                      提示：{rule.hint}
                    </span>
                  )}
                  <span className='px-1 py-0.5 text-d-muted'>已命中 {rule.use_count} 次</span>
                </div>
              </div>
              <div className='flex shrink-0 items-center gap-1.5'>
                <button
                  type='button'
                  onClick={() => openEdit(rule)}
                  className='min-h-[36px] rounded-lg border border-d-border bg-d-surface px-2.5 text-[12px] font-semibold text-d-accent-light'
                >
                  编辑
                </button>
                <button
                  type='button'
                  aria-label={`删除规则 ${rule.label}`}
                  onClick={() => setDeletingRule(rule)}
                  className='flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-d-danger/40 bg-d-danger-soft text-d-danger-ink'
                >
                  <TrashIcon size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={formOpen}
        title={editingRule ? '编辑密码规则' : '添加密码规则'}
        onClose={() => !saving && setFormOpen(false)}
        dismissible={!saving}
        footer={
          <>
            <Button variant='ghost' onClick={() => setFormOpen(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void handleSave()} loading={saving}>
              保存
            </Button>
          </>
        }
      >
        <div className='flex flex-col gap-3'>
          {formError && <Alert severity='error'>{formError}</Alert>}
          <TextField
            label='规则名称'
            required
            placeholder='例如：本人身份证后6位 / 汇丰生日'
            value={label}
            onChange={e => setLabel(e.target.value)}
          />
          <TextField
            label={editingRule ? '新密码（留空则保持原密码不变）' : 'PDF 解密密码'}
            required={!editingRule}
            type='password'
            placeholder={editingRule ? '不修改请留空' : '仅加密写入，不会再次明文回显'}
            value={password}
            onChange={e => setPassword(e.target.value)}
          />
          <SelectField
            label='绑定持卡人（选填）'
            value={holderId}
            onChange={e => setHolderId(e.target.value)}
            options={[
              { value: '', label: '全部持卡人通用' },
              ...holders.map(h => ({ value: h.id, label: h.name })),
            ]}
          />
          <SelectField
            label='绑定银行（选填）'
            value={bankId}
            onChange={e => setBankId(e.target.value)}
            options={[
              { value: '', label: '不限银行（或按关键词匹配）' },
              ...banks.map(b => ({ value: b.id, label: b.name })),
            ]}
          />
          <TextField
            label='银行关键词（选填）'
            placeholder='例如：HSBC / 建行'
            value={bankKeyword}
            onChange={e => setBankKeyword(e.target.value)}
          />
          <div>
            <TextField
              label='密码记忆提示（选填，解密失败时展示）'
              placeholder='例如：身份证后6位 / DDMMYYYY'
              value={hint}
              onChange={e => setHint(e.target.value)}
            />
            <div className='mt-1.5 flex flex-wrap gap-1.5'>
              {HINT_TEMPLATES.map(tpl => (
                <button
                  key={tpl}
                  type='button'
                  onClick={() => setHint(tpl)}
                  className='rounded-full border border-d-border bg-d-subtle px-2.5 py-0.5 text-[11px] text-d-muted hover:text-d-text'
                >
                  {tpl}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={deletingRule !== null}
        title='删除密码规则'
        onClose={() => !deleting && setDeletingRule(null)}
        actions={
          <>
            <Button variant='ghost' size='sm' onClick={() => setDeletingRule(null)} disabled={deleting}>
              取消
            </Button>
            <Button variant='danger' size='sm' onClick={() => void handleConfirmDelete()} loading={deleting}>
              确认删除
            </Button>
          </>
        }
      >
        <p className='text-[13px] leading-5 text-d-muted'>
          确定删除密码规则「{deletingRule?.label}」吗？删除后不会影响已解密或已入库的账单。
        </p>
      </ConfirmDialog>
    </div>
  )
}
