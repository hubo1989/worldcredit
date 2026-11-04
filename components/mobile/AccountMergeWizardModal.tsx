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
    } else if (bankCards.length > 0 && bankCards[0].account_id) {
      setTargetAccountId(bankCards[0].account_id)
    }
  }, [candidateAccounts, bankCards])

  const toggleCard = (id: string) => {
    setSelectedCardIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const handleMerge = async () => {
    if (!targetAccountId) {
      setError('请选择合并的目标账户')
      return
    }
    if (selectedCardIds.length === 0) {
      setError('请勾选至少一张待合并卡片')
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
                onChange={e => setSelectedBank(e.target.value)}
                className='w-full rounded-xl border border-d-border bg-d-subtle px-3 py-2 text-[14px] text-d-text outline-none'
              >
                {bankOptions.map(b => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>

            {candidateAccounts.length > 0 && (
              <div>
                <label className='mb-1.5 block text-[12px] font-semibold text-d-text'>
                  归入的目标账户
                </label>
                <select
                  value={targetAccountId}
                  onChange={e => setTargetAccountId(e.target.value)}
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
                  const isChecked = selectedCardIds.includes(c.id)
                  const isTargetAnchor = c.account?.primary_card_id === c.id
                  return (
                    <label
                      key={c.id}
                      className={
                        'flex cursor-pointer items-center justify-between rounded-xl border p-3 transition-colors ' +
                        (isChecked
                          ? 'border-d-accent bg-d-accent-light/10'
                          : 'border-d-border bg-d-subtle')
                      }
                    >
                      <div className='flex items-center gap-2.5'>
                        <input
                          type='checkbox'
                          checked={isChecked}
                          onChange={() => toggleCard(c.id)}
                          className='h-4 w-4 rounded border-d-border text-d-accent'
                        />
                        <div>
                          <div className='text-[13px] font-semibold text-d-text'>
                            {c.name_override || c.card_product?.card_name || '信用卡'}
                            {c.card_number_last4 && ` (尾号 ${c.card_number_last4})`}
                          </div>
                          {isTargetAnchor && (
                            <span className='text-[10px] text-d-accent font-medium'>
                              当前账户锚点卡
                            </span>
                          )}
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
            </div>

            <div className='mt-2 flex justify-end gap-2'>
              <Button variant='secondary' onClick={onClose} disabled={loading}>
                取消
              </Button>
              <Button
                variant='primary'
                onClick={handleMerge}
                loading={loading}
              >
                <span className='inline-flex items-center gap-1.5'>
                  <MergeIcon size={16} />
                  <span>确认合并</span>
                </span>
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
