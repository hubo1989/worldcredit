'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { getCardDetail, updateCard, getCardHolders } from '@/lib/api/cards'
import { CardForm } from '@/components/mobile/CardForm'
import { ChevronLeftIcon, ClockIcon } from '@/components/icons/WcIcon'
import { Modal } from '@/components/obsidian/overlays'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { getEffectiveBillingDay, getEffectiveDueConfig, formatCardTail, getEffectiveCardName, getEffectiveAnnualFee } from '@/lib/utils'
import type { CreditCard, CardProduct, CardHolder, Bill, Benefit } from '@/lib/types'

type CardDetail = CreditCard & {
  card_product: CardProduct
  card_holders?: CardHolder
}

type BillWithPaid = Bill & { paid_amount: number; computed_status: Bill['status'] }

/** 账单状态徽章（暗色）：淡底 + ink，与 bills 暗色视图同一口径 */
/**
 * 近 6 期账单趋势：按账期从旧到新的纵向柱状图（横向在窄屏放不下月份标签）。
 * 纯 SVG 实现，不引图表库；高度按最大账单金额归一化。
 * 已结清的柱子用成功色、未结清用强调色，趋势一眼可辨。
 */
function BillTrendChart({ bills }: { bills: BillWithPaid[] }) {
  // 从旧到新排：趋势图的横轴是时间
  const ordered = [...bills].sort((a, b) => a.bill_month.localeCompare(b.bill_month))
  const max = Math.max(...ordered.map(b => Number(b.bill_amount) || 0), 1)

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-end justify-between gap-2'>
        {ordered.map(b => {
          const amount = Number(b.bill_amount) || 0
          const pct = Math.max(4, Math.round((amount / max) * 100))
          const paid = b.computed_status === 'paid'
          return (
            <div key={b.id} className='flex min-w-0 flex-1 flex-col items-center gap-1'>
              <span className='num-tabular text-[10px] font-semibold leading-3 text-d-muted'>
                {amount >= 10000 ? (amount / 10000).toFixed(1) + 'w' : amount.toLocaleString()}
              </span>
              <div className='flex h-24 w-full items-end justify-center'>
                <div
                  className={
                    'w-full max-w-[26px] rounded-t-[4px] ' + (paid ? 'bg-d-success' : 'bg-d-accent')
                  }
                  style={{ height: pct + '%' }}
                />
              </div>
              <span className='text-[10px] leading-3 text-d-muted'>{b.bill_month.slice(2)}</span>
            </div>
          )
        })}
      </div>
      <p className='text-[10px] leading-4 text-d-muted'>
        <span className='mr-2 inline-flex items-center gap-1'>
          <span className='inline-block h-2 w-2 rounded-sm bg-d-accent' />未结清
        </span>
        <span className='inline-flex items-center gap-1'>
          <span className='inline-block h-2 w-2 rounded-sm bg-d-success' />已结清
        </span>
      </p>
    </div>
  )
}

export default function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [card, setCard] = useState<CardDetail | null>(null)
  const [bills, setBills] = useState<BillWithPaid[]>([])
  const [benefits, setBenefits] = useState<Array<Benefit & { used: number }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 编辑表单状态
  const [editOpen, setEditOpen] = useState(false)
  const [cardFormOpen, setCardFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [nameOverride, setNameOverride] = useState('')
  const [limitInput, setLimitInput] = useState('')
  const [billingDayInput, setBillingDayInput] = useState('')
  const [dueType, setDueType] = useState<'default' | 'after_billing' | 'fixed' | 'fixed_before_billing'>('default')
  const [dueValue, setDueValue] = useState('')
  const [annualFeeInput, setAnnualFeeInput] = useState('')
  const [holders, setHolders] = useState<Array<{ id: string; name: string }>>([])
  const [holderId, setHolderId] = useState('')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // 卡 + 卡产品 + 持卡人 + 最近账单（含已还聚合）+ 权益使用进度，一次 RPC 返回
      const detail = await getCardDetail(id)
      setCard({
        ...detail.card,
        card_holders: detail.card.card_holder,
      } as unknown as CardDetail)
      setBills(detail.bills as unknown as BillWithPaid[])
      setBenefits(detail.benefits)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载卡片失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  // 持卡人列表：编辑弹窗里转移归属用（邮件自动建卡挂错人时在这里修）
  useEffect(() => {
    getCardHolders().then(list => setHolders(list.map(h => ({ id: h.id, name: h.name })))).catch(() => {})
  }, [])

  const openEdit = () => {
    if (!card) return
    const product = card.card_product
    const due = getEffectiveDueConfig(card, product)
    setNameOverride(card.name_override || '')
    setLimitInput(String(Number(card.credit_limit) || 0))
    setBillingDayInput(String(getEffectiveBillingDay(card)))
    // 回填当前生效的还款规则（修改过后即是卡级覆盖，否则是产品默认）
    setDueType(card.override_due_type && card.override_due_value != null
      ? card.override_due_type
      : 'default')
    setDueValue(card.override_due_value != null
      ? String(card.override_due_value)
      : (card.override_due_type ? '' : String(due.value)))
    setAnnualFeeInput(card.annual_fee_override != null ? String(Number(card.annual_fee_override)) : '')
    setHolderId(card.holder_id || '')
    setEditError(null)
    setEditOpen(true)
  }

  const handleSave = async () => {
    if (!card) return
    const day = parseInt(billingDayInput, 10)
    const limitNum = parseFloat(limitInput)
    if (isNaN(limitNum) || limitNum < 0) {
      setEditError('请输入有效的总额度')
      return
    }
    if (isNaN(day) || day < 1 || day > 31) {
      setEditError('账单日必须是 1-31 之间的数字')
      return
    }
    if (dueType !== 'default') {
      const val = parseInt(dueValue, 10)
      if (isNaN(val) || val < 1 || (dueType !== 'after_billing' && val > 31)) {
        setEditError('请输入有效的还款规则数值')
        return
      }
    }
    // 年费留空表示回退卡产品默认；填了就必须是非负数字（避免写入负数或 NaN）
    const annualFeeTrimmed = annualFeeInput.trim()
    const annualFeeValue = annualFeeTrimmed === '' ? null : parseFloat(annualFeeTrimmed)
    if (annualFeeValue != null && (isNaN(annualFeeValue) || annualFeeValue < 0)) {
      setEditError('请输入有效的年费金额')
      return
    }
    setSaving(true)
    setEditError(null)
    try {
      await updateCard(card.id, {
        holder_id: holderId || undefined,
        // 卡片名称：留空恢复使用卡产品默认
        name_override: nameOverride.trim() || null,
        credit_limit: limitNum,
        // 账单日：以修改后的值为准，清除旧覆盖
        billing_day: day,
        override_billing_day: null,
        // 还款日：选「跟随卡产品」时清除覆盖，否则写入卡级覆盖（优先生效）
        override_due_type: dueType === 'default' ? null : dueType,
        override_due_value: dueType === 'default' ? null : parseInt(dueValue, 10),
        // 年费：留空恢复使用卡产品默认
        annual_fee_override: annualFeeValue,
      })
      setEditOpen(false)
      await load()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-3 text-d-text'>
        <HeaderBack title='卡片详情' onBack={() => router.back()} />
        <div className='wc-skeleton mb-3 h-[180px] w-full rounded-2xl' />
        <div className='wc-skeleton mb-3 h-24 w-full rounded-2xl' />
        <div className='wc-skeleton h-24 w-full rounded-2xl' />
      </div>
    )
  }

  if (error || !card) {
    return (
      <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-3 text-d-text'>
        <HeaderBack title='卡片详情' onBack={() => router.back()} />
        <div className='rounded-2xl bg-d-danger-soft p-4 text-center'>
          <p className='text-[12px] font-semibold text-d-danger-ink'>{error || '卡片不存在'}</p>
          <button
            type='button'
            onClick={load}
            className='mt-2 h-10 rounded-xl bg-d-danger px-4 text-xs font-semibold text-white'
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  const product = card.card_product
  const bankName = product?.bank_name || '银行卡'
  // 修改内容优先：卡级别名称覆盖 > 卡产品默认名称
  const cardName = getEffectiveCardName(card, product)
  const holderName = card.card_holders?.name
  const last4 = formatCardTail(card.card_number_last4)

  // 已用额度：SUM(bill_amount - paid) WHERE status != paid
  const used = bills
    .filter(b => b.computed_status !== 'paid')
    .reduce((s, b) => s + Math.max(0, Number(b.bill_amount) - b.paid_amount), 0)
  const limit = Number(card.credit_limit) || 0
  const available = Math.max(0, limit - used)

  const billingDay = getEffectiveBillingDay(card)
  const dueConfig = getEffectiveDueConfig(card, product)
  const dueDayOfMonth =
    card.loan_due_day ??
    (dueConfig.type !== 'after_billing' ? dueConfig.value : null)
  const grace = billingDay && dueDayOfMonth ? Math.max(0, dueDayOfMonth - billingDay) : null
  // 修改内容优先：卡级别年费覆盖 > 卡产品默认
  const annualFee = getEffectiveAnnualFee(card, product)
  const currency = product?.currency || 'CNY'
  // 是否存在卡级别自定义（展示「已自定义」徽标）
  const isNameOverridden = !!card.name_override
  const isDueOverridden = card.override_due_type != null && card.override_due_value != null
  const isAnnualFeeOverridden = card.annual_fee_override != null

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-3 text-d-text'>
      <HeaderBack title='卡片详情' onBack={() => router.back()} />

      {/* 卡面：深蓝渐变 + 卡种名 + 掩码卡号 + 持卡人 + 金色装饰（品牌元素，暗色下保留） */}
      <div
        className='relative mb-2.5 flex flex-col justify-between overflow-hidden rounded-2xl p-4 text-white'
        style={{
          background: 'linear-gradient(135deg, var(--navy-800), var(--navy-600))',
          boxShadow: '0 12px 40px rgba(0,0,0,0.35)',
          minHeight: 150,
        }}
      >
        <span
          aria-hidden='true'
          className='absolute -right-9 -top-9 h-[140px] w-[140px] rounded-full'
          style={{ background: 'radial-gradient(circle, color-mix(in srgb, var(--color-d-gold) 45%, transparent), transparent)' }}
        />
        <span
          aria-hidden='true'
          className='absolute bottom-[-50px] right-[18px] h-[110px] w-[110px] rounded-full border'
          style={{ borderColor: 'color-mix(in srgb, var(--color-d-gold) 35%, transparent)' }}
        />
        <div className='relative z-10 flex items-start justify-between'>
          <div>
            <p className='text-[12px] leading-4 text-white/75'>{bankName}</p>
            <p className='mt-0.5 flex items-center gap-1.5 text-[15px] font-semibold leading-5 text-white'>
              {cardName}
              {isNameOverridden && (
                <span className='rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-white'>
                  已自定义
                </span>
              )}
            </p>
          </div>
          {card.status !== 'active' && (
            <span className='rounded-full bg-white/15 px-2.5 py-0.5 text-[12px] font-semibold leading-4'>
              {card.status === 'frozen' ? '已冻结' : '已注销'}
            </span>
          )}
        </div>
        <div className='relative z-10'>
          <p className='num-tabular mb-0.5 text-[17px] tracking-widest'>
            ****&nbsp;****&nbsp;****&nbsp;{last4 || '----'}
          </p>
          <p className='text-[12px] leading-4 text-white/80'>
            {holderName || '—'} · {card.card_type === 'loan' ? '贷款类' : '信用卡'}
          </p>
        </div>
      </div>

      {/* 额度三格 */}
      <div className='mb-2.5 grid grid-cols-3 gap-0.5 rounded-2xl border border-d-border bg-d-surface p-2'>
        <Quota label='总额度' value={limit} cls='text-d-text' />
        <Quota label='已用' value={used} cls='text-d-gold' />
        <Quota label='可用' value={available} cls='text-d-success-ink' />
      </div>

      {/* 日期与费用 */}
      <Section
        title='日期与费用'
        action={
          <div className='flex items-center gap-1.5'>
            <button
              type='button'
              onClick={() => { openEdit(); setEditOpen(true) }}
              aria-label='编辑年费'
              className='rounded-lg border border-d-border px-2.5 py-1 text-[12px] font-semibold text-d-muted active:opacity-70'
            >
              年费
            </button>
            <button
              type='button'
              onClick={() => setCardFormOpen(true)}
              aria-label='编辑卡片'
              className='rounded-lg bg-d-accent px-3 py-1 text-[12px] font-semibold text-white active:opacity-80'
            >
              编辑
            </button>
          </div>
        }
      >
        <div className='flex flex-col gap-1.5'>
          <Row label='账单日' value={billingDay ? '每月 ' + billingDay + ' 日' : '—'} />
          <Row
            label='还款日'
            value={
              <span className='inline-flex items-center gap-1.5'>
                {dueDayOfMonth ? '每月 ' + dueDayOfMonth + ' 日' : (card.loan_due_day ? '每月 ' + card.loan_due_day + ' 日' : (dueConfig.type === 'after_billing' ? '账单日后 ' + dueConfig.value + ' 天' : '—'))}
                {isDueOverridden && <CustomizedTag />}
              </span>
            }
          />
          <Row
            label='最长免息'
            value={
              grace != null ? (
                <span className='inline-flex items-center gap-1 font-bold text-d-gold'>
                  <ClockIcon size={12} /> {grace} 天
                </span>
              ) : '—'
            }
          />
          <Row
            label='年费'
            value={
              <span className='inline-flex items-center gap-1.5'>
                {annualFee != null ? '¥' + annualFee.toLocaleString() : '—'}
                {isAnnualFeeOverridden && <CustomizedTag />}
              </span>
            }
          />
          <Row label='币种' value={currency} />
        </div>
      </Section>

      {/* 编辑卡片对话框：保存后卡级别内容优先于卡产品默认 */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        dismissible={!saving}
        title='编辑卡片'
        footer={
          <>
            <button
              type='button'
              onClick={() => setEditOpen(false)}
              disabled={saving}
              className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
            >
              取消
            </button>
            <button
              type='button'
              onClick={handleSave}
              disabled={saving}
              className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-50'
            >
              {saving ? '保存中…' : '保存'}
            </button>
          </>
        }
      >
        {editError && <div className='mb-3'><Alert severity='error'>{editError}</Alert></div>}
        <div className='flex flex-col gap-4'>
          {holders.length > 0 && (
            <SelectField
              label='持卡人'
              value={holderId}
              onChange={e => setHolderId(e.target.value)}
              helperText='邮件自动建卡挂错人时，在这里转移归属'
              options={holders.map(h => ({ value: h.id, label: h.name }))}
            />
          )}
          <TextField
            label='卡片名称'
            placeholder={product?.card_name || '输入卡片名称'}
            value={nameOverride}
            onChange={e => setNameOverride(e.target.value)}
            helperText={product?.card_name ? '留空则使用卡产品默认名称「' + product.card_name + '」' : undefined}
          />
          <TextField
            label='总额度'
            type='number'
            value={limitInput}
            onChange={e => setLimitInput(e.target.value)}
            required
            startAdornment={<span className='text-[14px]'>¥</span>}
          />
          <TextField
            label='账单日'
            type='number'
            value={billingDayInput}
            onChange={e => setBillingDayInput(e.target.value)}
            required
            helperText='每月出账日期（1-31）'
            min={1}
            max={31}
            endAdornment={<span className='text-[14px]'>日</span>}
          />
          <SelectField
            label='还款日规则'
            value={dueType}
            onChange={e => setDueType(e.target.value as typeof dueType)}
            helperText='修改后以此规则优先计算各期账单还款日'
            options={[
              {
                value: 'default',
                label: '跟随卡产品默认' + (product
                  ? ('（' + (product.payment_due_type === 'after_billing' ? '账单日后 ' + product.payment_due_value + ' 天' : '每月 ' + product.payment_due_value + ' 日') + '）')
                  : ''),
                disabled: !product,
              },
              { value: 'after_billing', label: '账单日后 X 天' },
              { value: 'fixed', label: '每月固定还款日' },
              { value: 'fixed_before_billing', label: '每月固定还款日（账单日倒推）' },
            ]}
          />
          {dueType !== 'default' && (
            <TextField
              label={dueType === 'after_billing' ? '账单日后天数' : '每月还款日'}
              type='number'
              value={dueValue}
              onChange={e => setDueValue(e.target.value)}
              required
              min={1}
              max={dueType === 'after_billing' ? undefined : 31}
              endAdornment={<span className='text-[14px]'>{dueType === 'after_billing' ? '天' : '日'}</span>}
            />
          )}
          <TextField
            label='年费'
            type='number'
            value={annualFeeInput}
            onChange={e => setAnnualFeeInput(e.target.value)}
            helperText={product?.annual_fee != null && Number(product.annual_fee) > 0 ? '留空则使用卡产品默认年费 ¥' + Number(product.annual_fee).toLocaleString() : '留空表示无年费'}
            startAdornment={<span className='text-[14px]'>¥</span>}
          />
        </div>
      </Modal>

      {/* 完整卡片编辑：银行/产品/账户模式等基础信息（复用持卡人页的 CardForm） */}
      {card && (
        <CardForm
          open={cardFormOpen}
          onClose={() => setCardFormOpen(false)}
          holderId={card.holder_id}
          initial={card}
          onSubmit={async data => {
            await updateCard(card.id, data)
            await load()
          }}
        />
      )}

      {/* 近 6 期账单趋势：明细列表已外移到账单页，这里只看走势 */}
      <Section title='近 6 期账单趋势'>
        {bills.length === 0 ? (
          <div className='py-4 text-center'>
            <p className='text-[13px] font-semibold text-d-text'>暂无账单</p>
            <p className='mt-1 text-[12px] text-d-muted'>这张卡还没有录入账单</p>
          </div>
        ) : (
          <BillTrendChart bills={bills.slice(0, 6)} />
        )}
      </Section>
      {/* 权益进度（如无数据则省略） */}
      {benefits.length > 0 && (
        <Section title='权益进度'>
          <div className='flex flex-col gap-3'>
            {benefits.map(b => {
              const pct = b.quota > 0 ? Math.min(100, Math.round((b.used / b.quota) * 100)) : 0
              const over = b.used >= b.quota
              return (
                <div key={b.id}>
                  <div className='mb-1 flex items-center justify-between'>
                    <p className='text-[13px] font-semibold leading-4 text-d-text'>{b.name}</p>
                    <p className={'num-tabular text-[12px] font-semibold ' + (over ? 'text-d-danger-ink' : 'text-d-muted')}>
                      {b.used}/{b.quota}
                    </p>
                  </div>
                  <div className='h-1.5 overflow-hidden rounded-full bg-d-border'>
                    {/* 进度填充用 transform 而非 width，避免布局抖动 */}
                    <div
                      className={'h-full w-full origin-left rounded-full transition-transform ' + (over ? 'bg-d-danger' : 'bg-d-gold')}
                      style={{ transform: 'scaleX(' + Math.min(1, pct / 100) + ')' }}
                    />
                  </div>
                  {b.description && (
                    <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>{b.description}</p>
                  )}
                </div>
              )
            })}
          </div>
        </Section>
      )}
    </div>
  )
}

function HeaderBack({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className='mb-2.5 flex items-center gap-2.5'>
      <button
        type='button'
        onClick={onBack}
        aria-label='返回'
        className='flex h-11 w-11 items-center justify-center rounded-xl border border-d-border bg-d-surface text-d-text'
      >
        <ChevronLeftIcon size={20} />
      </button>
      <p className='text-[15px] font-semibold leading-5 text-d-text'>{title}</p>
    </div>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className='mb-2.5'>
      <div className='mb-1.5 flex items-center justify-between'>
        <p className='text-[15px] font-semibold leading-5 text-d-text'>{title}</p>
        {action}
      </div>
      <div className='rounded-2xl border border-d-border bg-d-surface p-3.5'>{children}</div>
    </div>
  )
}

/** 「已自定义」小徽标：标记该字段为卡级别覆盖值 */
function CustomizedTag() {
  return (
    <span className='rounded-full bg-d-subtle px-1.5 py-0.5 text-[10px] font-semibold leading-none text-d-muted'>
      已自定义
    </span>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className='flex items-center justify-between'>
      <span className='text-[12px] leading-4 text-d-muted'>{label}</span>
      <span className='num-tabular text-[12px] font-semibold text-d-text'>{value}</span>
    </div>
  )
}

function Quota({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className='text-center'>
      <p className='mb-0.5 text-[12px] leading-4 text-d-muted'>{label}</p>
      <p className={'num-tabular text-[15px] font-bold ' + cls}>¥{Number(value).toLocaleString()}</p>
    </div>
  )
}
