'use client'

import { useEffect, useState, useCallback } from 'react'
import { ConfirmDialog } from '@/components/obsidian/overlays'
import {
  BenefitIcon, AiSparkleIcon, PlusIcon,
} from '@/components/icons/WcIcon'
import {
  getAllMyBenefits,
  recordBenefitUsage,
  autoEnrichCardBenefits,
  createBenefit,
  updateBenefit,
  deleteBenefit
} from '@/lib/api/benefits'
import { BenefitEditDialog } from '@/components/mobile/BenefitEditDialog'
import type { Benefit, CardProduct } from '@/lib/types'

import { useAuth } from '@/lib/auth'

type BenefitWithStats = Benefit & {
  card_product?: CardProduct,
  usage_count: number
}

export default function BenefitsPage() {
  const { user } = useAuth()
  const [benefits, setBenefits] = useState<BenefitWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [collectingAi, setCollectingAi] = useState(false)
  const [selectedBenefit, setSelectedBenefit] = useState<BenefitWithStats | null>(null)

  // Usage Record Dialog State
  const [useOpen, setUseOpen] = useState(false)
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Edit Dialog State
  const [editOpen, setEditOpen] = useState(false)
  const [editingBenefit, setEditingBenefit] = useState<BenefitWithStats | null>(null)

  const loadData = useCallback(async () => {
    if (!user) return
    try {
      setLoading(true)
      const data = await getAllMyBenefits(user.id)
      setBenefits(data as BenefitWithStats[])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { loadData() }, [loadData])

  const handleUseBenefit = async () => {
    if (!selectedBenefit) return
    setSubmitting(true)
    try {
      await recordBenefitUsage({
        benefit_id: selectedBenefit.id,
        used_at: new Date().toISOString().split('T')[0],
        note: note || undefined
      })
      setUseOpen(false)
      setNote('')
      loadData()
    } catch (err) {
      alert('登记失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setSubmitting(false)
    }
  }

  const handleAutoCollectAi = async () => {
    if (benefits.length === 0) {
      alert('请先添加至少一张信用卡后再尝试 AI 自动搜集权益。')
      return
    }

    // 默认针对当前第一张卡产品的发卡行和卡名进行搜集
    const sampleCard = benefits[0]?.card_product
    if (!sampleCard) {
      alert('未检测到关联卡片产品')
      return
    }

    setCollectingAi(true)
    try {
      const added = await autoEnrichCardBenefits(sampleCard.id, sampleCard.bank_name, sampleCard.card_name)
      if (added.length > 0) {
        alert('✨ AI 自动搜集成功！已成功检索并添加了 ' + added.length + ' 项专属权益。')
        loadData()
      } else {
        alert('未检索到更多新权益。')
      }
    } catch (err) {
      alert('AI 自动搜集失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCollectingAi(false)
    }
  }

  const handleDeleteBenefit = async (id: string) => {
    if (!confirm('确定要删除这项权益吗？')) return
    try {
      await deleteBenefit(id)
      loadData()
    } catch (err) {
      alert('删除失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  // 计算到期/重置预警 (近 30 天内重置且尚有额度未享用)
  const expiringBenefits = benefits.filter(b => {
    const remaining = Number(b.quota) - b.usage_count
    return remaining > 0 && b.period === 'yearly' && b.reset_month
  })

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-4 text-d-text'>
      {/* 页头与 AI 搜集/手动新增按钮：360 下按钮整颗换行，不与标题互抢宽度 */}
      <div className='mb-4 flex flex-wrap items-start justify-between gap-x-2.5 gap-y-1.5'>
        <div className='min-w-0 flex-1'>
          <p className='whitespace-nowrap text-[20px] font-bold leading-7 text-d-text'>我的权益</p>
          <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
            智能追踪与享用您的信用卡专属权益
          </p>
        </div>
        <div className='flex shrink-0 gap-2'>
          <button
            type='button'
            disabled={collectingAi}
            onClick={handleAutoCollectAi}
            className='flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full bg-d-accent px-3.5 text-[12px] font-semibold text-white disabled:opacity-60'
          >
            <AiSparkleIcon size={14} />
            {collectingAi ? 'AI 搜集中...' : 'AI 搜集权益'}
          </button>
          <button
            type='button'
            onClick={() => {
              setEditingBenefit(null)
              setEditOpen(true)
            }}
            className='flex h-10 items-center gap-1.5 whitespace-nowrap rounded-full border border-d-accent px-3.5 text-[12px] font-semibold text-d-accent-light'
          >
            <PlusIcon size={14} />
            手动添加
          </button>
        </div>
      </div>

      {/* 权益到期/重置预警 Banner */}
      {expiringBenefits.length > 0 && (
        <div className='mb-4 rounded-xl bg-d-gold-soft p-3'>
          <p className='text-[12px] font-semibold leading-5 text-d-warn-ink'>
            提示：您有 {expiringBenefits.length} 项专属权益（如 {expiringBenefits[0].name}）仍有剩余额度未享用，请注意及时使用。
          </p>
        </div>
      )}

      {loading ? (
        <div className='flex flex-col gap-3'>
          {[1, 2, 3].map(i => (
            <div key={i} className='wc-skeleton h-[120px] w-full rounded-2xl' />
          ))}
        </div>
      ) : benefits.length === 0 ? (
        <div className='rounded-2xl border border-dashed border-d-border bg-d-surface p-8 text-center'>
          <BenefitIcon size={48} className='mx-auto mb-4 text-d-muted' />
          <p className='text-[13px] font-semibold leading-5 text-d-text'>暂无可用权益</p>
          <p className='mb-4 mt-1 block text-[12px] leading-4 text-d-muted'>
            点击「AI 搜集权益」自动检索卡片权益或手动添加
          </p>
          <button
            type='button'
            onClick={handleAutoCollectAi}
            className='mx-auto flex h-11 items-center gap-1.5 rounded-full bg-d-accent px-5 text-[13px] font-semibold text-white'
          >
            <AiSparkleIcon size={15} />
            一键 AI 自动搜集
          </button>
        </div>
      ) : (
        <div className='flex flex-col gap-3'>
          {benefits.map(b => {
            const remaining = Math.max(0, Number(b.quota) - b.usage_count)
            const progress = (b.usage_count / Number(b.quota)) * 100

            return (
              <div key={b.id} className='rounded-2xl border border-d-border bg-d-surface p-4'>
                <div className='mb-3 flex gap-3'>
                  <div className='flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-d-subtle text-d-accent-light'>
                    <BenefitIcon size={22} />
                  </div>
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-[12px] leading-4 text-d-muted'>
                      {b.card_product?.bank_name} · {b.card_product?.card_name}
                    </p>
                    <p className='mt-0.5 text-[15px] font-semibold leading-5 text-d-text'>{b.name}</p>
                    {b.description && (
                      <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>{b.description}</p>
                    )}
                  </div>
                  <div className='flex shrink-0 gap-1.5'>
                    <button
                      type='button'
                      aria-label='编辑权益'
                      onClick={() => {
                        setEditingBenefit(b)
                        setEditOpen(true)
                      }}
                      className='text-[12px] font-semibold text-d-muted'
                    >
                      编辑
                    </button>
                    <button
                      type='button'
                      aria-label='删除权益'
                      onClick={() => handleDeleteBenefit(b.id)}
                      className='text-[12px] font-semibold text-d-danger-ink'
                    >
                      删除
                    </button>
                  </div>
                </div>

                <div className='mb-1.5 flex items-end justify-between gap-2'>
                  <div className='min-w-0'>
                    <p
                      className={
                        'text-[13px] font-semibold leading-5 ' +
                        (remaining > 0 ? 'text-d-accent-light' : 'text-d-muted')
                      }
                    >
                      可用剩余：{remaining} / {b.quota} 次
                    </p>
                    {b.reset_month ? (
                      <p className='text-[12px] leading-4 text-d-muted'>每年 {b.reset_month} 月重置</p>
                    ) : b.expiry_date ? (
                      <p className='text-[12px] leading-4 text-d-muted'>截止：{b.expiry_date}</p>
                    ) : null}
                  </div>
                </div>

                {/* 进度条：已用占比 */}
                <div className='mb-3 h-1.5 w-full overflow-hidden rounded-full bg-d-border'>
                  <div
                    className='h-full rounded-full bg-d-accent'
                    style={{ width: Math.min(100, progress) + '%' }}
                  />
                </div>

                <button
                  type='button'
                  disabled={remaining <= 0}
                  onClick={() => {
                    setSelectedBenefit(b)
                    setUseOpen(true)
                  }}
                  className='flex h-11 w-full items-center justify-center gap-1.5 rounded-full bg-d-accent text-[13px] font-semibold text-white disabled:opacity-50'
                >
                  <PlusIcon size={15} />
                  登记享用权益
                </button>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={useOpen}
        title='登记权益享用'
        onClose={submitting ? () => {} : () => setUseOpen(false)}
        actions={
          <>
            <button
              type='button'
              onClick={() => setUseOpen(false)}
              disabled={submitting}
              className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
            >
              取消
            </button>
            <button
              type='button'
              onClick={handleUseBenefit}
              disabled={submitting}
              className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-50'
            >
              {submitting ? '登记中...' : '确认登记享用'}
            </button>
          </>
        }
      >
        <p className='text-[13px] leading-5 text-d-muted'>
          正在登记享用: <strong className='text-d-text'>{selectedBenefit?.name}</strong>
        </p>
        <label className='mt-3 block'>
          <span className='mb-1 block text-[12px] font-semibold text-d-muted'>使用场景与备注 (选填)</span>
          <textarea
            rows={3}
            value={note}
            placeholder='例如: 浦东机场 T2 专车接送'
            onChange={e => setNote(e.target.value)}
            className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none placeholder:text-d-muted focus:border-d-accent'
          />
        </label>
      </ConfirmDialog>

      {/* 手动新增/编辑 Dialog */}
      <BenefitEditDialog
        open={editOpen}
        cardProductId={editingBenefit?.card_product_id || (benefits[0]?.card_product_id || '')}
        benefit={editingBenefit}
        onClose={() => setEditOpen(false)}
        onSaved={loadData}
        onSave={async (data) => {
          if (editingBenefit) {
            await updateBenefit(editingBenefit.id, data)
          } else {
            await createBenefit(data)
          }
        }}
      />
    </div>
  )
}
