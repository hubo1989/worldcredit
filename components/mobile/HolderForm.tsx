// components/mobile/HolderForm.tsx
'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { Alert } from '@/components/obsidian/feedback'
import { TextField } from '@/components/obsidian/fields'
import { CloseIcon } from '@/components/icons/WcIcon'
import type { CardHolder } from '@/lib/types'

// 暗色底上可辨的持卡人色板（原 MUI 亮色色板在 #131a2a 面板上发灰）。
const COLORS = ['#7aadff', '#ff8a8a', '#6ee7a0', '#ffc46b', '#c4a5ff', '#5fd4d0']

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: {
    name: string
    phone?: string
    email?: string
    avatar_color: string
    aliases?: string[]
  }) => void | Promise<void>
  initial?: CardHolder
}

function parseAliasesText(raw: string): string[] {
  return raw
    .split(/[,，、\n]/)
    .map(s => s.trim())
    .filter(Boolean)
}

export function HolderForm({ open, onClose, onSubmit, initial }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [email, setEmail] = useState(initial?.email ?? '')
  const [color, setColor] = useState(initial?.avatar_color ?? COLORS[0])
  const [aliases, setAliases] = useState<string[]>(initial?.aliases ?? [])
  const [aliasInput, setAliasInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setPhone(initial?.phone ?? '')
      setEmail(initial?.email ?? '')
      setColor(initial?.avatar_color ?? COLORS[0])
      setAliases(Array.isArray(initial?.aliases) ? initial.aliases : [])
      setAliasInput('')
      setSubmitting(false)
      setFormError(null)
    }
  }, [open, initial])

  const appendUniqueAliases = (base: string[], additions: string[]): string[] => {
    const next = [...base]
    for (const item of additions) {
      const normalized = item.toUpperCase()
      if (!next.some(a => a.toUpperCase() === normalized)) {
        next.push(item)
      }
    }
    return next
  }

  const appendAliasInput = () => {
    const parsed = parseAliasesText(aliasInput)
    if (parsed.length === 0) return
    setAliases(prev => appendUniqueAliases(prev, parsed))
    setAliasInput('')
  }

  const removeAlias = (target: string) => {
    setAliases(prev => prev.filter(a => a !== target))
  }

  const handleSubmit = async () => {
    if (!name.trim() || submitting) return
    setSubmitting(true)
    setFormError(null)
    try {
      const pendingAliases = parseAliasesText(aliasInput)
      const mergedAliases = appendUniqueAliases(aliases, pendingAliases)
      await onSubmit({
        name: name.trim(),
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        avatar_color: color,
        aliases: mergedAliases,
      })
      onClose()
    } catch (err) {
      setFormError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Modal
      open={open}
      title={initial ? '编辑持卡人' : '添加持卡人'}
      onClose={onClose}
      dismissible={!submitting}
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={!name.trim() || submitting} loading={submitting}>
            保存
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        {formError && <Alert severity='error'>{formError}</Alert>}
        <TextField
          label='姓名'
          required
          value={name}
          onChange={e => setName(e.target.value)}
          autoFocus
        />
        <TextField
          label='手机号'
          value={phone}
          onChange={e => setPhone(e.target.value)}
        />
        <TextField
          label='邮箱（选填，用于邮件账单持卡人自动归属）'
          type='email'
          value={email}
          onChange={e => setEmail(e.target.value)}
        />

        {/* 账单常用别名（如英文拼音 BO HU、呼先生） */}
        <div className='flex flex-col gap-2'>
          <div className='flex items-end gap-2'>
            <TextField
              label='账单匹配别名（选填）'
              placeholder='如：BO HU, HU BO, 呼先生'
              value={aliasInput}
              onChange={e => setAliasInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  appendAliasInput()
                }
              }}
              helperText='用于港美英文月结单与邮件称呼自动认人'
            />
            <button
              type='button'
              onClick={appendAliasInput}
              className='mb-[22px] h-11 shrink-0 rounded-xl border border-d-border bg-d-subtle px-3 text-[13px] font-semibold text-d-accent-light'
            >
              添加
            </button>
          </div>
          {aliases.length > 0 && (
            <div className='flex flex-wrap gap-1.5'>
              {aliases.map(alias => (
                <span
                  key={alias}
                  className='inline-flex items-center gap-1 rounded-full border border-d-border bg-d-subtle px-2.5 py-1 text-[12px] text-d-text'
                >
                  <span>{alias}</span>
                  <button
                    type='button'
                    aria-label={`移除别名 ${alias}`}
                    onClick={() => removeAlias(alias)}
                    className='text-d-muted hover:text-d-danger-ink'
                  >
                    <CloseIcon size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        <div className='flex flex-wrap gap-2.5 pt-1'>
          {COLORS.map(c => (
            <button
              key={c}
              type='button'
              aria-label={`选择颜色 ${c}`}
              onClick={() => setColor(c)}
              className='h-9 w-9 rounded-full transition-[box-shadow] '
              style={{
                backgroundColor: c,
                // 选中态用同色外环，避免亮色 border token 在暗底上突兀
                boxShadow: c === color ? `0 0 0 3px var(--color-d-surface), 0 0 0 5px ${c}` : 'none',
              }}
            />
          ))}
        </div>
      </div>
    </Modal>
  )
}
