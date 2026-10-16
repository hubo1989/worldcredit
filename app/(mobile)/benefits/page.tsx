'use client'

// app/(mobile)/benefits/page.tsx — 我的权益台账（P1，Task 12）。数据走统一
// getBenefitLedger RPC；余额/状态/文案由 availability + view-model 计算，
// 页面不再自行判断。目录维护入口保留 admin-only。

import { useCallback, useEffect, useState } from 'react'
import { AiSparkleIcon, PlusIcon } from '@/components/icons/WcIcon'
import {
  getAllMyBenefits,
  autoEnrichCardBenefits,
  createBenefit,
  updateBenefit,
  deleteBenefit,
} from '@/lib/api/benefits'
import { getBenefitLedger, setOpportunityFollowed } from '@/lib/api/opportunities'
import { BenefitLedgerView, type CatalogBenefitCard } from '@/components/opportunities/BenefitLedgerView'
import { BenefitEditDialog, type BenefitProductOption } from '@/components/mobile/BenefitEditDialog'
import { getAllCardsWithProduct } from '@/lib/api/cards'
import { useAuth } from '@/lib/auth'
import type { LedgerRow, OpportunityDto } from '@/lib/opportunities/queries.server'
import type { Benefit } from '@/lib/types'

export default function BenefitsPage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [rows, setRows] = useState<LedgerRow[]>([])
  const [catalogBenefits, setCatalogBenefits] = useState<CatalogBenefitCard[]>([])
  const [products, setProducts] = useState<BenefitProductOption[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [collectingAi, setCollectingAi] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingBenefit, setEditingBenefit] = useState<(Benefit & { definition_id?: string | null }) | null>(null)

  const loadData = useCallback(async () => {
    if (!user) return
    try {
      setLoading(true)
      setLoadError(null)
      // 台账与目录并行；目录行提供账户初始化入口与定义 id
      const [ledger, catalog, cards] = await Promise.all([
        getBenefitLedger({ limit: 100 }),
        getAllMyBenefits(user.id),
        getAllCardsWithProduct(),
      ])
      setRows(ledger.items)
      const accountBenefitIds = new Set(
        (catalog ?? []).flatMap((b) => (b.accounts ?? []).length > 0 ? [b.id] : []),
      )
      setCatalogBenefits(
        (catalog ?? []).map((b) => ({
          id: b.id,
          definition_id: b.definition_id ?? null,
          name: b.name,
          bank_name: b.card_product?.bank_name ?? null,
          card_name: b.card_product?.card_name ?? null,
          hasAccount: accountBenefitIds.has(b.id),
        })),
      )
      const seen = new Set<string>()
      const productOptions: BenefitProductOption[] = []
      for (const card of cards || []) {
        const p = card.card_product
        if (!p || seen.has(p.id)) continue
        seen.add(p.id)
        productOptions.push({ id: p.id, bank_name: p.bank_name, card_name: p.card_name })
      }
      setProducts(productOptions)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const handleFollowToggle = useCallback(
    async (dto: OpportunityDto) => {
      try {
        await setOpportunityFollowed({
          account_id: dto.account_id,
          followed: !dto.followed,
          expected_revision: null,
        })
        await loadData()
      } catch (err) {
        alert(err instanceof Error ? err.message : String(err))
      }
    },
    [loadData],
  )

  const handleOpenEntry = useCallback((dto: OpportunityDto) => {
    // 打开银行入口只提示“已打开入口”，不改变关注/领取/使用状态
    if (dto.entry.website_url) {
      window.open(dto.entry.website_url, '_blank', 'noopener')
    }
  }, [])

  const handleAutoCollectAi = async () => {
    if (catalogBenefits.length === 0 && products.length === 0) {
      alert('请先添加至少一张信用卡后再尝试 AI 自动搜集权益。')
      return
    }
    const sample = products[0]
    if (!sample) {
      alert('未检测到关联卡片产品')
      return
    }
    setCollectingAi(true)
    try {
      const added = await autoEnrichCardBenefits(sample.id, sample.bank_name, sample.card_name)
      if (added.length > 0) {
        alert(`✨ 已检索到 ${added.length} 项权益，待来源复核后进入目录。`)
        await loadData()
      } else {
        alert('未检索到更多新权益。')
      }
    } catch (err) {
      alert('AI 搜集失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setCollectingAi(false)
    }
  }

  const handleDeleteBenefit = async (id: string) => {
    if (!confirm('确定要归档这项权益吗？历史使用记录会保留。')) return
    try {
      await deleteBenefit(id)
      await loadData()
    } catch (err) {
      alert('归档失败: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-4 text-d-text'>
      <div className='mb-4 flex flex-wrap items-start justify-between gap-x-2.5 gap-y-1.5'>
        <div className='min-w-0 flex-1'>
          <p className='whitespace-nowrap text-[20px] font-bold leading-7 text-d-text'>我的权益</p>
          <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
            个人台账：余额、使用历史与核对状态
          </p>
        </div>
        {isAdmin && (
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
        )}
      </div>

      {isAdmin && editingBenefit && (
        <div className='mb-3 flex gap-2 text-[12px] font-semibold'>
          <button type='button' onClick={() => setEditOpen(true)} className='text-d-accent-light'>
            编辑「{editingBenefit.name}」
          </button>
          <button
            type='button'
            onClick={() => void handleDeleteBenefit(editingBenefit.id)}
            className='text-d-danger-ink'
          >
            归档
          </button>
        </div>
      )}

      <BenefitLedgerView
        rows={rows}
        catalogBenefits={catalogBenefits}
        loading={loading}
        error={loadError}
        onReload={() => void loadData()}
        onFollowToggle={(dto) => void handleFollowToggle(dto)}
        onOpenEntry={handleOpenEntry}
      />

      {isAdmin && (
        <BenefitEditDialog
          open={editOpen}
          cardProductId={editingBenefit?.card_product_id || ''}
          products={products}
          benefit={editingBenefit}
          onClose={() => setEditOpen(false)}
          onSaved={() => void loadData()}
          onSave={async (data) => {
            if (editingBenefit) {
              await updateBenefit(editingBenefit.id, data)
            } else {
              await createBenefit(data)
            }
          }}
        />
      )}
    </div>
  )
}
