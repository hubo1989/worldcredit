'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal, ConfirmDialog } from '@/components/obsidian/overlays'
import { Button, CheckRow } from '@/components/obsidian/controls'
import { SelectField, TextField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { PlusIcon, TrashIcon } from '@/components/icons/WcIcon'
import { currencySymbol } from '@/lib/fx'
import {
  categoryLabel,
  classifyBillItem,
  computeBillItemsDiscrepancy,
  normalizeBillItemInput,
  normalizeMerchantKey,
  signedItemAmount,
} from '@/lib/direction3/pure'
import {
  clearBillItems,
  createBillItem,
  deleteBillItem,
  getMerchantCategoryRules,
  updateBillItem,
} from '@/lib/direction3/rpc'
import {
  SPEND_CATEGORIES,
  SPEND_CATEGORY_LABELS,
  type BillItem,
  type BillItemType,
  type SpendCategory,
} from '@/lib/direction3/types'
import { BillItemImportModal } from './BillItemImportModal'

interface Props {
  billId: string
  billMonth: string
  billCurrency: string
  effectiveAmount: number
  items: BillItem[]
  loading?: boolean
  onChanged: () => Promise<void> | void
  memberCards?: Array<{ id: string; card_number_last4?: string; name_override?: string }>
}

const ITEM_TYPE_LABELS: Record<BillItemType, string> = {
  purchase: '消费',
  refund: '退款',
  fee: '费用',
  interest: '利息',
  installment: '分期入账',
  adjustment: '调账',
}

const CATEGORY_OPTIONS = [
  { value: '', label: '未分类' },
  ...SPEND_CATEGORIES.map((c) => ({ value: c, label: SPEND_CATEGORY_LABELS[c] })),
]

export function BillItemsSection({
  billId,
  billMonth,
  billCurrency,
  effectiveAmount,
  items,
  loading = false,
  onChanged,
  memberCards = [],
}: Props) {
  const [expanded, setExpanded] = useState(items.length > 0)
  const [importOpen, setImportOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<BillItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<BillItem | null>(null)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [userRules, setUserRules] = useState<Map<string, SpendCategory>>(new Map())

  const [description, setDescription] = useState('')
  const [merchantName, setMerchantName] = useState('')
  const [amountText, setAmountText] = useState('')
  const [itemType, setItemType] = useState<BillItemType>('purchase')
  const [category, setCategory] = useState<string>('')
  const [txDate, setTxDate] = useState('')
  const [cardId, setCardId] = useState('')
  const [rememberMerchant, setRememberMerchant] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (items.length > 0) setExpanded(true)
  }, [items.length])

  useEffect(() => {
    let cancelled = false
    getMerchantCategoryRules()
      .then((rules) => {
        if (cancelled || !Array.isArray(rules)) return
        const map = new Map<string, SpendCategory>()
        for (const r of rules) {
          map.set(r.normalized_merchant, r.category)
        }
        setUserRules(map)
      })
      .catch(() => {
        // 规则接口未就绪时静默回退内置词典
      })
    return () => {
      cancelled = true
    }
  }, [])

  const sym = currencySymbol(billCurrency)
  const discrepancy = useMemo(
    () => computeBillItemsDiscrepancy(effectiveAmount, items),
    [effectiveAmount, items],
  )

  const openCreate = () => {
    setEditingItem(null)
    setDescription('')
    setMerchantName('')
    setAmountText('')
    setItemType('purchase')
    setCategory('')
    setTxDate('')
    setCardId('')
    setRememberMerchant(true)
    setError(null)
    setEditorOpen(true)
  }

  const openEdit = (item: BillItem) => {
    setEditingItem(item)
    setDescription(item.description)
    setMerchantName(item.merchant_name ?? '')
    setAmountText(String(item.amount))
    setItemType(item.item_type)
    setCategory(item.category ?? '')
    setTxDate(item.transaction_date?.slice(0, 10) ?? '')
    setCardId(item.card_id ?? '')
    setRememberMerchant(true)
    setError(null)
    setEditorOpen(true)
  }

  const handleSaveItem = async () => {
    setError(null)
    const parsedAmt = Number(amountText)
    if (!description.trim()) {
      setError('请填写摘要或商户名称')
      return
    }
    if (!Number.isFinite(parsedAmt) || (itemType !== 'adjustment' && parsedAmt <= 0)) {
      setError(itemType === 'adjustment' ? '请输入有效的调账金额' : '金额必须大于 0')
      return
    }

    const normalized = normalizeBillItemInput(
      {
        description: description.trim(),
        merchant_name: merchantName.trim() || null,
        amount: parsedAmt,
        item_type: itemType,
        category: category || null,
        currency: billCurrency,
        transaction_date: txDate.trim() || null,
        source: 'manual',
      },
      userRules,
    )

    const chosenCat = category ? (category as SpendCategory) : normalized.category ?? null
    const canRemember = rememberMerchant && Boolean(chosenCat) && Boolean(normalizeMerchantKey(merchantName || description))

    setSubmitting(true)
    try {
      if (editingItem) {
        await updateBillItem(editingItem.id, {
          description: normalized.description,
          merchant_name: normalized.merchant_name ?? null,
          amount: normalized.amount,
          item_type: normalized.item_type,
          category: chosenCat,
          transaction_date: normalized.transaction_date ?? null,
          card_id: cardId || null,
          remember_merchant: canRemember,
        })
      } else {
        await createBillItem({
          ...normalized,
          bill_id: billId,
          category: chosenCat,
          card_id: cardId || null,
          remember_merchant: canRemember,
        })
      }
      setEditorOpen(false)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存明细失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDeleteItem = async () => {
    if (!deleteTarget) return
    setSubmitting(true)
    setError(null)
    try {
      await deleteBillItem(deleteTarget.id)
      setDeleteTarget(null)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除明细失败')
      setDeleteTarget(null)
    } finally {
      setSubmitting(false)
    }
  }

  const handleClearAll = async () => {
    setSubmitting(true)
    setError(null)
    try {
      await clearBillItems(billId)
      setClearConfirmOpen(false)
      await onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : '清空明细失败')
      setClearConfirmOpen(false)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className='mb-2.5'>
      <div className='mb-1.5 flex items-center justify-between'>
        <button
          type='button'
          onClick={() => setExpanded((v) => !v)}
          className='flex min-h-[44px] items-center gap-1.5 text-left text-[15px] font-semibold leading-5 text-d-text'
        >
          <span>交易明细（{items.length} 笔）</span>
          <span className='text-[12px] text-d-muted'>{expanded ? '收起' : '展开'}</span>
        </button>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={() => setImportOpen(true)}
            className='min-h-[44px] px-2 text-[13px] font-semibold text-d-accent-light'
          >
            导入CSV/文本
          </button>
          <button
            type='button'
            onClick={openCreate}
            className='inline-flex min-h-[44px] items-center gap-1 px-2 text-[13px] font-semibold text-d-accent-light'
          >
            <PlusIcon size={14} />
            添加明细
          </button>
        </div>
      </div>

      {expanded && (
        <div className='rounded-2xl border border-d-border bg-d-surface p-3.5'>
          {error && (
            <div className='mb-2.5'>
              <Alert severity='error'>{error}</Alert>
            </div>
          )}

          {discrepancy.hasDiscrepancy && (
            <div className='mb-3'>
              <Alert severity='info'>
                明细净额 {sym}
                {discrepancy.itemsNetTotal.toLocaleString()} 与账单应还 {sym}
                {effectiveAmount.toLocaleString()} 相差 {sym}
                {Math.abs(discrepancy.diff).toLocaleString()}
                （可能由上期结转、未录入消费、退款跨期或分期引起）
              </Alert>
            </div>
          )}

          {loading ? (
            <p className='py-4 text-center text-[13px] text-d-muted'>正在加载交易明细…</p>
          ) : items.length === 0 ? (
            <div className='py-3 text-center'>
              <p className='text-[13px] font-semibold text-d-text'>暂无交易明细</p>
              <p className='mt-1 text-[12px] text-d-muted'>
                交易明细为轻量可选项，不影响账单与还款；补录后可在分析页查看消费分类与精确日息
              </p>
            </div>
          ) : (
            <>
              <div className='flex flex-col'>
                {items.map((item, idx) => {
                  const signed = signedItemAmount(item)
                  const itemSym = currencySymbol(item.currency || billCurrency)
                  const isRefund = item.item_type === 'refund' || signed < 0
                  return (
                    <div
                      key={item.id}
                      className={
                        'flex items-center justify-between gap-2 py-2.5 ' +
                        (idx > 0 ? 'border-t border-d-border' : '')
                      }
                    >
                      <div className='min-w-0 flex-1'>
                        <div className='flex items-center gap-1.5'>
                          <p className='truncate text-[13px] font-semibold text-d-text'>
                            {item.merchant_name || item.description}
                          </p>
                          <span className='shrink-0 rounded-full bg-d-subtle px-2 py-0.5 text-[10px] font-semibold text-d-muted'>
                            {categoryLabel(item.category)}
                          </span>
                        </div>
                        <p className='mt-0.5 text-[11px] text-d-muted'>
                          {item.transaction_date ? item.transaction_date.slice(0, 10) : '未填日期'}
                          {' · '}
                          {ITEM_TYPE_LABELS[item.item_type] ?? item.item_type}
                          {item.merchant_name && item.description !== item.merchant_name
                            ? ` · ${item.description}`
                            : ''}
                        </p>
                      </div>
                      <div className='flex shrink-0 items-center gap-2'>
                        <span
                          className={
                            'num-tabular text-[14px] font-bold ' +
                            (isRefund ? 'text-d-success-ink' : 'text-d-text')
                          }
                        >
                          {signed < 0
                            ? `-${itemSym}${Math.abs(signed).toLocaleString()}`
                            : `${itemSym}${signed.toLocaleString()}`}
                        </span>
                        <button
                          type='button'
                          onClick={() => openEdit(item)}
                          className='min-h-[44px] px-1.5 text-[12px] font-semibold text-d-accent-light'
                        >
                          编辑
                        </button>
                        <button
                          type='button'
                          aria-label='删除明细'
                          onClick={() => setDeleteTarget(item)}
                          className='flex min-h-[44px] min-w-[32px] items-center justify-center text-d-danger-ink'
                        >
                          <TrashIcon size={15} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className='mt-2 flex items-center justify-between border-t border-d-border pt-2.5'>
                <span className='text-[12px] text-d-muted'>
                  明细净额：{sym}
                  {discrepancy.itemsNetTotal.toLocaleString()}
                </span>
                <button
                  type='button'
                  onClick={() => setClearConfirmOpen(true)}
                  className='min-h-[44px] px-2 text-[12px] font-semibold text-d-danger-ink'
                >
                  清空明细
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {/* 单条增改弹窗 */}
      <Modal
        open={editorOpen}
        onClose={() => !submitting && setEditorOpen(false)}
        dismissible={!submitting}
        title={editingItem ? '编辑交易明细' : '添加交易明细'}
        footer={
          <>
            <Button variant='ghost' onClick={() => setEditorOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleSaveItem} loading={submitting}>
              保存
            </Button>
          </>
        }
      >
        <div className='flex flex-col gap-3'>
          {error && <Alert severity='error'>{error}</Alert>}
          <TextField
            label='摘要 / 交易描述'
            required
            value={description}
            onChange={(e) => {
              const nextDesc = e.target.value
              setDescription(nextDesc)
              if (!editingItem && !category) {
                const auto = classifyBillItem(
                  { description: nextDesc, merchant_name: merchantName, item_type: itemType },
                  userRules,
                )
                if (auto) setCategory(auto)
              }
            }}
            placeholder='如：星巴克咖啡'
          />
          <TextField
            label='商户名（可选）'
            value={merchantName}
            onChange={(e) => setMerchantName(e.target.value)}
            placeholder='留空则使用摘要作为商户'
          />
          <div className='grid grid-cols-2 gap-2.5'>
            <TextField
              label={`金额 (${billCurrency})`}
              type='number'
              inputMode='decimal'
              step='0.01'
              required
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              startAdornment={<span>{sym}</span>}
            />
            <SelectField
              label='交易类型'
              value={itemType}
              onChange={(e) => setItemType(e.target.value as BillItemType)}
              options={[
                { value: 'purchase', label: '消费' },
                { value: 'refund', label: '退款（自动扣减）' },
                { value: 'fee', label: '费用' },
                { value: 'interest', label: '利息' },
                { value: 'installment', label: '分期入账' },
                { value: 'adjustment', label: '银行调账' },
              ]}
            />
          </div>
          <div className='grid grid-cols-2 gap-2.5'>
            <SelectField
              label='消费分类'
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              options={CATEGORY_OPTIONS}
            />
            <TextField
              label='交易日期（可选）'
              type='date'
              value={txDate}
              onChange={(e) => setTxDate(e.target.value)}
            />
          </div>
          {memberCards.length > 1 && (
            <SelectField
              label='归属卡片（合并账单可选）'
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              options={[
                { value: '', label: '未指定' },
                ...memberCards.map((mc) => ({
                  value: mc.id,
                  label: `${mc.name_override || '卡片'} · 尾号 ${mc.card_number_last4 || '----'}`,
                })),
              ]}
            />
          )}
          {category && (
            <CheckRow checked={rememberMerchant} onChange={setRememberMerchant}>
              <span>记住该商户自动归类为「{categoryLabel(category)}」</span>
            </CheckRow>
          )}
        </div>
      </Modal>

      <BillItemImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        billId={billId}
        billMonth={billMonth}
        billCurrency={billCurrency}
        existingItems={items}
        userRulesMap={userRules}
        onImported={onChanged}
      />

      {/* 删除单条确认（禁用原生 window.confirm） */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title='确认删除该条明细？'
        onClose={() => !submitting && setDeleteTarget(null)}
        actions={
          <>
            <Button variant='ghost' onClick={() => setDeleteTarget(null)} disabled={submitting}>
              取消
            </Button>
            <Button variant='danger' onClick={handleDeleteItem} loading={submitting}>
              确认删除
            </Button>
          </>
        }
      >
        <p className='text-[13px] text-d-muted'>
          将删除「{deleteTarget?.description}」（{sym}
          {deleteTarget ? Number(deleteTarget.amount).toLocaleString() : ''}），不会改变账单主金额。
        </p>
      </ConfirmDialog>

      {/* 清空全部确认（禁用原生 window.confirm） */}
      <ConfirmDialog
        open={clearConfirmOpen}
        title='确认清空本账单全部明细？'
        onClose={() => !submitting && setClearConfirmOpen(false)}
        actions={
          <>
            <Button variant='ghost' onClick={() => setClearConfirmOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button variant='danger' onClick={handleClearAll} loading={submitting}>
              确认清空
            </Button>
          </>
        }
      >
        <p className='text-[13px] text-d-muted'>
          将清空本账单全部 {items.length} 条交易明细。账单主金额与还款记录不受影响。
        </p>
      </ConfirmDialog>
    </div>
  )
}
