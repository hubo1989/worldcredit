'use client'

import React, { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/obsidian/controls'
import { Toast } from '@/components/obsidian/overlays'
import { AiSparkleIcon, ChevronDownIcon } from '@/components/icons/WcIcon'
import { aiComplete } from '@/lib/api/ai'

interface AiCompleteButtonProps {
  type: 'bank' | 'card_product'
  formData: Record<string, unknown>
  onComplete: (completedData: Record<string, unknown>) => void
  availableFields: { key: string; label: string }[]
}

export default function AiCompleteButton({
  type,
  formData,
  onComplete,
  availableFields,
}: AiCompleteButtonProps) {
  const [loading, setLoading] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // 点击外部关闭逐项菜单
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const handleAllComplete = async () => {
    if (loading) return

    // 基础校验：至少要有名称
    const nameField = type === 'bank' ? 'name' : 'card_name'
    if (!formData[nameField]) {
      alert(`请先填写${type === 'bank' ? '银行' : '卡片'}名称`)
      return
    }

    setLoading(true)
    setErrorMsg(null)
    try {
      const result = await aiComplete({
        type,
        data: formData,
      })
      if (!result || Object.keys(result).length === 0) {
        setErrorMsg('AI 未能识别该信息，请尝试补充更多关键词')
        return
      }
      onComplete(result)
    } catch (err) {
      console.error('AI Complete Full Error:', err)
      setErrorMsg(err instanceof Error ? err.message : 'AI 补全失败')
    } finally {
      setLoading(false)
    }
  }

  const handleFieldComplete = async (fieldKey: string) => {
    setMenuOpen(false)
    setLoading(true)
    setErrorMsg(null)
    try {
      const result = await aiComplete({
        type,
        data: formData,
        fields: [fieldKey],
      })
      onComplete(result)
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'AI 补全失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className='inline-flex flex-col items-end'>
      <div ref={menuRef} className='relative inline-flex overflow-hidden rounded-xl'>
        <Button
          onClick={handleAllComplete}
          loading={loading}
          className='rounded-none'
        >
          {!loading ? <AiSparkleIcon size={16} /> : null}
          {loading ? '补全中...' : 'AI 一键补全'}
        </Button>
        <button
          type='button'
          aria-label='逐项生成'
          onClick={() => setMenuOpen((v) => !v)}
          disabled={loading}
          className='border-l border-white/25 bg-d-accent px-2 text-white disabled:opacity-50'
        >
          <ChevronDownIcon size={16} />
        </button>

        {menuOpen ? (
          <div className='absolute right-0 top-full z-50 mt-1 min-w-[180px] overflow-hidden rounded-xl border border-d-border bg-d-surface py-1 text-left shadow-xl'>
            <p className='px-3.5 py-1.5 text-[12px] font-bold text-d-muted'>逐项生成</p>
            {availableFields.map((field) => (
              <button
                key={field.key}
                type='button'
                onClick={() => handleFieldComplete(field.key)}
                className='block w-full px-3.5 py-2 text-left text-[13px] text-d-text hover:bg-d-subtle'
              >
                {field.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <Toast
        open={Boolean(errorMsg)}
        message={errorMsg ?? ''}
        severity='error'
        autoHideMs={6000}
        onClose={() => setErrorMsg(null)}
      />
    </div>
  )
}
