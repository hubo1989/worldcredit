'use client'

import { useState, useMemo, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { Alert } from '@/components/obsidian/feedback'
import { MergeIcon } from '@/components/icons/WcIcon'
import type { CreditCard, CardProduct, CreditAccount } from '@/lib/types'
import { mergeCardsIntoAccount } from '@/lib/api/accounts'

interface CardItem extends CreditCard {
  card_product?: CardProduct
  account?: CreditAccount
}

interface Props {
  open: boolean
  onClose: () => void
  cards: CardItem[]
  onSuccess: () => void
}

export function AccountMergeWizardModal({
  open,
  onClose,
  cards,
  onSuccess,
}: Props) {
  const [selectedBank, setSelectedBank] = useState<string>('')
  const [targetAccountId, setTargetAccountId] = useState<string>('')
  const [selectedCardIds, setSelectedCardIds] = useState<string[]>([])
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 按银行分组可合并的卡片（只有同人、同银行且拥有 >= 2 张卡的才有合并价值）
  const bankOptions = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const c of cards) {
      const bName = c.card_product?.bank_name || '其他银行'
      counts[bName] = (counts[bName] || 0) + 1
    }
    return Object.keys(counts).filter(b => counts[b] >= 2)
  }, [cards])

  useEffect(() => {
    if (open && bankOptions.length > 0) {
      setSelectedBank(bankOptions[0])
      setSelectedCardIds([])
      setShowConfirm(false)
      setError(null)
    }
  }, [open, bankOptions])

  // 当前所选银行名下的所有卡
  const bankCards = useMemo(() => {
    return cards.filter(c => (c.card_product?.bank_name || '其他银行') === selectedBank)
  }, [cards, selectedBank])

  // 候选目标合并账户（已建有账户者优先，或首张卡）
  const candidateAccounts = useMemo(() => {
    const accs = new Map<string, { id: string; label: string }>()
    for (const c of bankCards) {
      if (c.account) {
        accs.set(c.account.id, {
          id: c.account.id,
          label: `${c.account.bank_name || selectedBank}合并账户 (主卡尾号 ${c.card_number_last4 || '未知'})`,
        })
      } else if (c.account_id) {
        accs.set(c.account_id, {
          id: c.account_id,
          label: `${selectedBank}账户 (尾号 ${c.card_number_last4 || '未知'})`,
        })
      }
    }
    return Array.from(accs.values())
  }, [bankCards, selectedBank])

  useEffect(() => {
    if (candidateAccounts.length > 0) {
      setTargetAccountId(candidateAccounts[0].id)
    } else {
      setTargetAccountId('')
    }
    setShowConfirm(false)
  }, [candidateAccounts])

  // 当 targetAccountId 变动时，剔除已属于该目标账户的卡片勾选
  useEffect(() => {
    if (targetAccountId) {
      setSelectedCardIds(prev =>
        prev.filter(id => {
          const c = cards.find(item => item.id === id)
          return c && c.account_id !== targetAccountId && c.account?.id !== targetAccountId
        })
      )
    }
  }, [targetAccountId, cards])

  const toggleCard = (id: string) => {
    const card = cards.find(c => c.id === id)
    if (card && (card.account_id === targetAccountId || card.account?.id === targetAccountId)) {
      return
    }
    setShowConfirm(false)
    setSelectedCardIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const handleStartMerge = () => {
    if (!targetAccountId) {
      setError('请选择合并的目标账户')
      return
    }
    if (selectedCardIds.length === 0) {
      setError('请勾选至少一张待合并卡片')
      return
    }
    setError(null)
    setShowConfirm(true)
  }

  const handleConfirmMerge = async () => {
    if (!targetAccountId || selectedCardIds.length === 0) {
      return
    }

    setLoading(true)
    setError(null)
    try {
      await mergeCardsIntoAccount(targetAccountId, selectedCardIds)
      onSuccess()
      onClose()
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      setError(msg)
      setShowConfirm(false)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title='合并为统一账单账户'>
      <div className='flex flex-col gap-4 p-4'>
        <p className='text-[13px] text-d-muted leading-relaxed'>
          当你在同一家银行持有多张信用卡、且银行按账户合出一份对账单时，可在此将它们合并为统一账单账户。合并后每月仅产生一条权威账单，还款一笔即可全账户结清。
        </p>

        {error && <Alert severity='error'>{error}</Alert>}

        {bankOptions.length === 0 ? (
          <div className='py-6 text-center text-[13px] text-d-muted'>
            当前没有同一银行持有多张卡片的记录，无需合并。
          </div>
        ) : (
          <>
            <div>
              <label className='mb-1.5 block text-[12px] font-semibold text-d-text'>
                选择发卡行
              </label>
              <select
                value={selectedBank}
                onChange={e => {
                  setSelectedBank(e.target.value)
                  setSelectedCardIds([])
                  setShowConfirm(false)
                  setError(null)
                }}
                className='w-full rounded-xl border border-d-border bg-d-subtle px-3 py-2 text-[14px] text-d-text outline-none'
              >
                {bankOptions.map(b => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            {candidateAccounts.length === 0 ? (
              <Alert severity='warning'>
                该银行名下暂无已创建的账单账户。请先为其中一张卡片配置账户后再进行合并。
              </Alert>
            ) : (
              <div>
                <label className='mb-1.5 block text-[12px] font-semibold text-d-text'>
                  归入的目标账户
                </label>
                <select
                  value={targetAccountId}
                  onChange={e => {
                    setTargetAccountId(e.target.value)
                    setShowConfirm(false)
                  }}
                  className='w-full rounded-xl border border-d-border bg-d-subtle px-3 py-2 text-[14px] text-d-text outline-none'
                >
                  {candidateAccounts.map(acc => (
                    <option key={acc.id} value={acc.id}>
                      {acc.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className='mb-1.5 block text-[12px] font-semibold text-d-text'>
                勾选需要并入的卡片
              </label>
              <div className='flex flex-col gap-2'>
                {bankCards.map(c => {
                  const isBelongToTarget = !!targetAccountId && (c.account_id === targetAccountId || c.account?.id === targetAccountId)
                  const isTargetAnchor = isBelongToTarget && (c.account?.primary_card_id === c.id || bankCards.find(bc => (bc.account_id === targetAccountId || bc.account?.id === targetAccountId))?.id === c.id)
                  const isChecked = !isBelongToTarget && selectedCardIds.includes(c.id)
                  return (
                    <label
                      key={c.id}
                      className={
                        'flex items-center justify-between rounded-xl border p-3 transition-colors ' +
                        (isBelongToTarget
                          ? 'cursor-not-allowed opacity-60 border-d-border bg-d-subtle'
                          : isChecked
                          ? 'cursor-pointer border-d-accent bg-d-accent-light/10'
                          : 'cursor-pointer border-d-border bg-d-subtle')
                      }
                    >
                      <div className='flex items-center gap-2.5'>
                        <input
                          type='checkbox'
                          checked={isChecked}
                          disabled={isBelongToTarget}
                          onChange={() => toggleCard(c.id)}
                          className='h-4 w-4 rounded border-d-border text-d-accent disabled:opacity-50'
                        />
                        <div>
                          <div className='text-[13px] font-semibold text-d-text'>
                            {c.name_override || c.card_product?.card_name || '信用卡'}
                            {c.card_number_last4 && ` (尾号 ${c.card_number_last4})`}
                          </div>
                          {isTargetAnchor ? (
                            <span className='text-[10px] text-d-accent font-medium'>
                              当前账户锚点卡 (已在目标账户中，不可重复合并)
                            </span>
                          ) : isBelongToTarget ? (
                            <span className='text-[10px] text-d-muted font-medium'>
                              已在当前目标账户中
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>

            {showConfirm && (
              <Alert severity='warning'>
                确认将已勾选的 {selectedCardIds.length} 张卡片合并入目标账户吗？合并后，候选卡的历史账单归属（card_id）将改写为目标账户主卡，此操作不可撤销。
              </Alert>
            )}

            <div className='mt-2 flex justify-end gap-2'>
              <Button
                variant='secondary'
                onClick={showConfirm ? () => setShowConfirm(false) : onClose}
                disabled={loading}
              >
                {showConfirm ? '返回修改' : '取消'}
              </Button>
              {showConfirm ? (
                <Button
                  variant='primary'
                  onClick={handleConfirmMerge}
                  loading={loading}
                >
                  <span className='inline-flex items-center gap-1.5'>
                    <MergeIcon size={16} />
                    <span>确认执行合并</span>
                  </span>
                </Button>
              ) : (
                <Button
                  variant='primary'
                  onClick={handleStartMerge}
                  disabled={candidateAccounts.length === 0 || selectedCardIds.length === 0}
                >
                  <span className='inline-flex items-center gap-1.5'>
                    <MergeIcon size={16} />
                    <span>确认合并</span>
                  </span>
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
