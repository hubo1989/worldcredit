'use client'

import { useState, useMemo, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { SelectField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { MergeIcon, AiSparkleIcon } from '@/components/icons/WcIcon'
import type { CardHolder } from '@/lib/types'
import { mergeHolders } from '@/lib/api/holders'

interface Props {
  open: boolean
  onClose: () => void
  holders: CardHolder[]
  cardCounts: Record<string, number>
  onSuccess: () => void
}

/** 小标签 pill（对应 MUI Chip 的降级自绘）。 */
function Pill({ children, tone = 'default' }: { children: React.ReactNode; tone?: 'default' | 'accent' | 'warn' }) {
  const toneCls =
    tone === 'accent'
      ? 'border-d-accent/40 text-d-accent-light'
      : tone === 'warn'
        ? 'border-d-warn-ink/40 bg-d-gold-soft text-d-warn-ink'
        : 'border-d-border text-d-muted'
  return (
    <span className={'inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-semibold leading-none ' + toneCls}>
      {children}
    </span>
  )
}

export function MergeHoldersDialog({
  open,
  onClose,
  holders,
  cardCounts,
  onSuccess,
}: Props) {
  // 选中的主持卡人 ID（默认选持有卡片最多或者第一个）
  const [primaryId, setPrimaryId] = useState<string>('')
  // 选中的被合并持卡人 ID 列表
  const [sourceIds, setSourceIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 当弹窗打开时，初始化默认主持卡人（卡片最多的优先作为主身份）
  useEffect(() => {
    if (open && holders.length > 0) {
      const sorted = [...holders].sort((a, b) => (cardCounts[b.id] || 0) - (cardCounts[a.id] || 0))
      setPrimaryId(sorted[0]?.id || holders[0].id)
      setSourceIds([])
      setError(null)
    }
  }, [open, holders, cardCounts])

  // 主持卡人对象
  const primaryHolder = useMemo(() => {
    return holders.find(h => h.id === primaryId)
  }, [holders, primaryId])

  // 可被合并的备选持卡人列表（排除主持卡人本身）
  const candidateHolders = useMemo(() => {
    return holders.filter(h => h.id !== primaryId)
  }, [holders, primaryId])

  // 智能识别相似别名（如姓氏相同、包含*、包含"先生"/"女士"、或拼音相关的候选人）
  const autoSuggestedIds = useMemo(() => {
    if (!primaryHolder) return []
    const pName = primaryHolder.name.trim()
    const pSurname = pName[0]

    return candidateHolders
      .filter(c => {
        const cName = c.name.trim()
        // 1. 同姓且名字包含 *
        if (cName[0] === pSurname && (cName.includes('*') || cName.includes('先生') || cName.includes('女士'))) {
          return true
        }
        // 2. 名字完全相同（同名重复录入）
        if (cName === pName) return true
        // 3. 通用别名如 "主持卡人"
        if (cName === '主持卡人') return true
        // 4. 拼音或者英文简写（如 ZHANG SAN / SAN ZHANG）
        if (/^[A-Za-z\s]+$/.test(cName)) return true
        return false
      })
      .map(c => c.id)
  }, [primaryHolder, candidateHolders])

  // 一键全选智能推荐的相似身份
  const handleSelectSuggested = () => {
    setSourceIds(autoSuggestedIds)
  }

  // 切换单个源持卡人选择
  const handleToggleSource = (id: string) => {
    setSourceIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  // 计算将要合并转移的卡片数量
  const transferCardsCount = useMemo(() => {
    return sourceIds.reduce((sum, id) => sum + (cardCounts[id] || 0), 0)
  }, [sourceIds, cardCounts])

  // 收集将被合并的所有名字作为别名预览
  const collectedAliases = useMemo(() => {
    const names = new Set<string>()
    candidateHolders
      .filter(c => sourceIds.includes(c.id))
      .forEach(c => {
        if (c.name && c.name !== primaryHolder?.name) names.add(c.name)
        if (Array.isArray(c.aliases)) {
          c.aliases.forEach(a => {
            if (a && a !== primaryHolder?.name) names.add(a)
          })
        }
      })
    return Array.from(names)
  }, [candidateHolders, sourceIds, primaryHolder])

  // 提交合并
  const handleMerge = async () => {
    if (!primaryId || sourceIds.length === 0) return
    setLoading(true)
    setError(null)
    try {
      await mergeHolders(primaryId, sourceIds)
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '合并持卡人失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => !loading && onClose()}
      dismissible={!loading}
      maxWidth='md'
      title={
        <span className='flex items-center gap-2'>
          <MergeIcon size={20} className='text-d-text' />
          持卡人归拢合并
        </span>
      }
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={loading}>取消</Button>
          <Button
            onClick={handleMerge}
            disabled={loading || sourceIds.length === 0}
            loading={loading}
          >
            {sourceIds.length > 0 ? `确认归拢合并 (${sourceIds.length} 个身份)` : '请选择合并项'}
          </Button>
        </>
      }
    >
      <p className='mb-5 text-[14px] leading-5 text-d-muted'>
        由于邮件账单中常出现脱敏姓名（如 <strong className='text-d-text'>张*</strong>、<strong className='text-d-text'>张先生</strong>、<strong className='text-d-text'>ZHANG SAN</strong>），您可以将这些重复身份一键归拢合并到真实主持卡人名下。其名下卡片将自动转移，同时沉淀为别名库。
      </p>

      {error && (
        <div className='mb-4'>
          <Alert severity='error'>{error}</Alert>
        </div>
      )}

      {/* 1. 选择保留的主身份 */}
      <p className='mb-2 text-[17px] font-semibold leading-6 text-d-text'>
        1. 选择保留的主持卡人 (目标主身份)
      </p>
      <div className='mb-6'>
        <SelectField
          label='主持卡人'
          value={primaryId}
          onChange={e => {
            setPrimaryId(e.target.value)
            setSourceIds([]) // 切换主持卡人时重置被合并项
          }}
          options={holders.map(h => ({
            value: h.id,
            label: `${h.name} · ${cardCounts[h.id] || 0} 张卡`,
          }))}
        />
      </div>

      {/* 2. 选择被归拢的重复持卡人 */}
      {/* 长标题 + 操作按钮同行：标题可换行(min-w-0)，按钮文案不可拆且不收缩 */}
      <div className='mb-2 flex items-center justify-between gap-2'>
        <p className='min-w-0 text-[17px] font-semibold leading-6 text-d-text'>
          2. 选择需要归拢合并进来的重复身份 ({sourceIds.length}/{candidateHolders.length})
        </p>
        {autoSuggestedIds.length > 0 && (
          <Button
            variant='ghost'
            size='sm'
            onClick={handleSelectSuggested}
            className='shrink-0 whitespace-nowrap text-[12px]'
          >
            <AiSparkleIcon size={14} />
            智能全选相似 ({autoSuggestedIds.length})
          </Button>
        )}
      </div>

      {candidateHolders.length === 0 ? (
        <p className='py-4 text-center text-[13px] leading-5 text-d-muted'>
          没有其他可合并的持卡人
        </p>
      ) : (
        <div className='mb-5 max-h-[220px] overflow-y-auto rounded-2xl border border-d-border bg-d-bg p-1'>
          <div className='flex flex-col gap-1'>
            {candidateHolders.map(c => {
              const isSelected = sourceIds.includes(c.id)
              const isSuggested = autoSuggestedIds.includes(c.id)
              const count = cardCounts[c.id] || 0

              return (
                <button
                  key={c.id}
                  type='button'
                  onClick={() => handleToggleSource(c.id)}
                  aria-pressed={isSelected}
                  className={
                    'flex w-full items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors ' +
                    (isSelected
                      ? 'border-d-accent bg-d-subtle'
                      : 'border-transparent bg-d-surface hover:bg-d-subtle')
                  }
                >
                  <span className='flex min-w-0 items-center gap-2.5'>
                    <span
                      className={
                        'flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border text-[10px] font-bold leading-none ' +
                        (isSelected ? 'border-d-accent bg-d-accent text-white' : 'border-d-border')
                      }
                      style={{ width: 18, height: 18 }}
                    >
                      {isSelected ? '✓' : ''}
                    </span>
                    <span
                      className='flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold text-white'
                      style={{ backgroundColor: c.avatar_color }}
                    >
                      {c.name.charAt(0)}
                    </span>
                    <span className='min-w-0'>
                      <span className='flex items-center gap-1.5'>
                        <span className='truncate text-[14px] font-semibold leading-5 text-d-text'>
                          {c.name}
                        </span>
                        {isSuggested && <Pill tone='warn'>相似推荐</Pill>}
                      </span>
                      {c.aliases && c.aliases.length > 0 && (
                        <span className='block truncate text-[13px] leading-4 text-d-muted'>
                          已有别名: {c.aliases.join('、')}
                        </span>
                      )}
                    </span>
                  </span>

                  <Pill tone={count > 0 ? 'accent' : 'default'}>{count} 张卡</Pill>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* 3. 合并预览卡片 */}
      {sourceIds.length > 0 && primaryHolder && (
        <div className='rounded-2xl border border-d-success-ink/30 bg-d-success-soft p-4'>
          <p className='mb-2 text-[17px] font-semibold leading-6 text-d-success-ink'>
            🎯 合并生效预览
          </p>
          <div className='flex flex-col gap-1 text-[14px] leading-5 text-d-text'>
            <p>
              • 目标主持卡人：<strong>{primaryHolder.name}</strong>
            </p>
            <p>
              • 转移卡片数：
              <strong>
                原 {cardCounts[primaryHolder.id] || 0} 张 + 迁入 {transferCardsCount} 张 = 合计{' '}
                {(cardCounts[primaryHolder.id] || 0) + transferCardsCount} 张
              </strong>
            </p>
            {collectedAliases.length > 0 && (
              <p className='flex flex-wrap items-center gap-1'>
                • 沉淀别名库：
                {collectedAliases.map(a => (
                  <Pill key={a}>{a}</Pill>
                ))}
              </p>
            )}
          </div>
        </div>
      )}
    </Modal>
  )
}
