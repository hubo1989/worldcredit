'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Modal, ConfirmDialog } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { SelectField, TextField } from '@/components/obsidian/fields'
import { Alert, ProgressBar } from '@/components/obsidian/feedback'
import { PlusIcon, TrashIcon } from '@/components/icons/WcIcon'
import { currencySymbol } from '@/lib/fx'
import { getLocalTodayString } from '@/lib/utils'
import {
  generateInstallmentSchedule,
  INSTALLMENT_FEE_MODE_LABELS,
  round2,
} from '@/lib/direction3/pure'
import {
  advanceInstallmentPeriod,
  createInstallmentPlan,
  deleteInstallmentPlan,
  getInstallmentPlans,
  settleInstallmentEarly,
  updateInstallmentPlan,
} from '@/lib/direction3/rpc'
import type {
  InstallmentBillingMode,
  InstallmentFeeChargeMode,
  InstallmentFeeMode,
  InstallmentPlanType,
  InstallmentPlanWithSummary,
} from '@/lib/direction3/types'

interface Props {
  cardId: string
  currency: string
  defaultDueDay?: number
  defaultStartMonth?: string
}

const PLAN_TYPE_LABELS: Record<InstallmentPlanType, string> = {
  purchase: '消费分期',
  bill: '账单分期',
  cash: '现金分期',
}

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  active: { label: '进行中', cls: 'bg-d-subtle text-d-accent-light' },
  completed: { label: '已结清', cls: 'bg-d-success-soft text-d-success-ink' },
  early_settled: { label: '已提前结清', cls: 'bg-d-success-soft text-d-success-ink' },
  cancelled: { label: '已取消', cls: 'bg-d-subtle text-d-muted' },
}

export function InstallmentPlansSection({
  cardId,
  currency,
  defaultDueDay = 15,
  defaultStartMonth,
}: Props) {
  const [plans, setPlans] = useState<InstallmentPlanWithSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const [formOpen, setFormOpen] = useState(false)
  const [editingPlan, setEditingPlan] = useState<InstallmentPlanWithSummary | null>(null)
  const [settleTarget, setSettleTarget] = useState<InstallmentPlanWithSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<InstallmentPlanWithSummary | null>(null)

  const today = getLocalTodayString('Asia/Shanghai')
  const [title, setTitle] = useState('')
  const [planType, setPlanType] = useState<InstallmentPlanType>('purchase')
  const [principalText, setPrincipalText] = useState('')
  const [totalPeriodsText, setTotalPeriodsText] = useState('12')
  const [paidPeriodsText, setPaidPeriodsText] = useState('0')
  const [feeMode, setFeeMode] = useState<InstallmentFeeMode>('equal_principal_fee')
  const [feeChargeMode, setFeeChargeMode] = useState<InstallmentFeeChargeMode>('per_period')
  const [feeRatePctText, setFeeRatePctText] = useState('0.6')
  const [customFeeText, setCustomFeeText] = useState('')
  const [aprPctText, setAprPctText] = useState('12')
  const [startMonth, setStartMonth] = useState(defaultStartMonth || today.slice(0, 7))
  const [dueDayText, setDueDayText] = useState(String(defaultDueDay))
  const [dueMonthOffset, setDueMonthOffset] = useState<'0' | '1'>('0')
  const [billingMode, setBillingMode] = useState<InstallmentBillingMode>('included_in_statement')
  const [note, setNote] = useState('')

  const [settleDate, setSettleDate] = useState(today)
  const [settleAmountText, setSettleAmountText] = useState('')

  const sym = currencySymbol(currency)

  const loadPlans = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await getInstallmentPlans({ card_id: cardId })
      setPlans(Array.isArray(data) ? data : [])
    } catch {
      // 后端尚未上线时静默回落空态，不阻断卡片详情渲染
      setPlans([])
    } finally {
      setLoading(false)
    }
  }, [cardId])

  useEffect(() => {
    void loadPlans()
  }, [loadPlans])

  const openCreate = () => {
    setEditingPlan(null)
    setTitle('')
    setPlanType('purchase')
    setPrincipalText('')
    setTotalPeriodsText('12')
    setPaidPeriodsText('0')
    setFeeMode('equal_principal_fee')
    setFeeChargeMode('per_period')
    setFeeRatePctText('0.6')
    setCustomFeeText('')
    setAprPctText('12')
    setStartMonth(defaultStartMonth || today.slice(0, 7))
    setDueDayText(String(defaultDueDay))
    setDueMonthOffset('0')
    setBillingMode('included_in_statement')
    setNote('')
    setError(null)
    setFormOpen(true)
  }

  const openEdit = (plan: InstallmentPlanWithSummary) => {
    setEditingPlan(plan)
    setTitle(plan.title)
    setPaidPeriodsText(String(plan.paid_periods))
    setDueDayText(String(plan.due_day))
    setDueMonthOffset(String(plan.due_month_offset) as '0' | '1')
    setBillingMode(plan.billing_mode)
    setNote(plan.note ?? '')
    setError(null)
    setFormOpen(true)
  }

  const previewSchedule = useMemo(() => {
    const P = Number(principalText)
    const N = Number(totalPeriodsText)
    if (!Number.isFinite(P) || P <= 0 || !Number.isInteger(N) || N < 2 || N > 60) return []
    const feeRate = Number(feeRatePctText)
    const customFee = Number(customFeeText)
    const aprPct = Number(aprPctText)
    return generateInstallmentSchedule({
      principal_amount: P,
      total_periods: N,
      paid_periods: Math.max(0, Math.min(N, Number(paidPeriodsText) || 0)),
      fee_mode: feeMode,
      fee_charge_mode: feeChargeMode,
      fee_rate_per_period:
        feeMode === 'equal_principal_fee' && !customFeeText.trim() && Number.isFinite(feeRate)
          ? feeRate / 100
          : null,
      custom_period_fee:
        feeMode === 'equal_principal_fee' && customFeeText.trim() && Number.isFinite(customFee)
          ? customFee
          : null,
      apr:
        feeMode === 'equal_installment_apr' && Number.isFinite(aprPct) ? aprPct / 100 : null,
      start_month: startMonth || today.slice(0, 7),
      due_day: Math.max(1, Math.min(31, Number(dueDayText) || 15)),
      due_month_offset: dueMonthOffset === '1' ? 1 : 0,
    })
  }, [
    principalText,
    totalPeriodsText,
    paidPeriodsText,
    feeMode,
    feeChargeMode,
    feeRatePctText,
    customFeeText,
    aprPctText,
    startMonth,
    dueDayText,
    dueMonthOffset,
    today,
  ])

  const handleSave = async () => {
    setError(null)
    if (!title.trim()) {
      setError('请填写分期名称')
      return
    }
    const dueDay = Number(dueDayText)
    if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
      setError('还款日必须是 1–31 的整数')
      return
    }

    setSubmitting(true)
    try {
      if (editingPlan) {
        const paid = Number(paidPeriodsText)
        if (!Number.isInteger(paid) || paid < 0 || paid > editingPlan.total_periods) {
          setError(`已还期数必须在 0–${editingPlan.total_periods} 之间`)
          setSubmitting(false)
          return
        }
        await updateInstallmentPlan(editingPlan.id, {
          title: title.trim(),
          paid_periods: paid,
          due_day: dueDay,
          due_month_offset: dueMonthOffset === '1' ? 1 : 0,
          billing_mode: billingMode,
          note: note.trim() || null,
        })
      } else {
        const principal = Number(principalText)
        const totalPeriods = Number(totalPeriodsText)
        const paidPeriods = Number(paidPeriodsText) || 0
        if (!Number.isFinite(principal) || principal <= 0) {
          setError('分期本金必须大于 0')
          setSubmitting(false)
          return
        }
        if (!Number.isInteger(totalPeriods) || totalPeriods < 2 || totalPeriods > 60) {
          setError('总期数必须是 2–60 的整数')
          setSubmitting(false)
          return
        }
        if (!Number.isInteger(paidPeriods) || paidPeriods < 0 || paidPeriods > totalPeriods) {
          setError(`已还期数必须在 0–${totalPeriods} 之间`)
          setSubmitting(false)
          return
        }
        if (!/^\d{4}-\d{2}$/.test(startMonth)) {
          setError('起始账期格式必须为 YYYY-MM')
          setSubmitting(false)
          return
        }
        const feeRate = Number(feeRatePctText)
        const customFee = Number(customFeeText)
        const aprPct = Number(aprPctText)
        if (feeMode === 'equal_principal_fee' && !customFeeText.trim() && (!Number.isFinite(feeRate) || feeRate < 0)) {
          setError('每期费率必须为不小于 0 的数字')
          setSubmitting(false)
          return
        }
        if (feeMode === 'equal_principal_fee' && customFeeText.trim() && (!Number.isFinite(customFee) || customFee < 0)) {
          setError('固定手续费必须为不小于 0 的数字')
          setSubmitting(false)
          return
        }
        if (feeMode === 'equal_installment_apr' && (!Number.isFinite(aprPct) || aprPct < 0)) {
          setError('年化利率必须为不小于 0 的数字')
          setSubmitting(false)
          return
        }
        await createInstallmentPlan({
          card_id: cardId,
          title: title.trim(),
          plan_type: planType,
          currency,
          principal_amount: round2(principal),
          total_periods: totalPeriods,
          paid_periods: paidPeriods,
          fee_mode: feeMode,
          fee_charge_mode: feeChargeMode,
          fee_rate_per_period:
            feeMode === 'equal_principal_fee' && !customFeeText.trim() ? feeRate / 100 : null,
          custom_period_fee:
            feeMode === 'equal_principal_fee' && customFeeText.trim() ? customFee : null,
          apr: feeMode === 'equal_installment_apr' ? aprPct / 100 : null,
          start_month: startMonth,
          due_day: dueDay,
          due_month_offset: dueMonthOffset === '1' ? 1 : 0,
          billing_mode: billingMode,
          note: note.trim() || null,
        })
      }
      setFormOpen(false)
      await loadPlans()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存分期失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleAdvance = async (planId: string, delta: 1 | -1) => {
    setError(null)
    setSubmitting(true)
    try {
      await advanceInstallmentPeriod(planId, delta)
      await loadPlans()
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新期数失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleSettleEarly = async () => {
    if (!settleTarget) return
    const amt = Number(settleAmountText)
    if (!Number.isFinite(amt) || amt < 0) {
      setError('请输入有效的提前结清金额')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await settleInstallmentEarly(settleTarget.id, {
        settled_at: settleDate,
        settled_amount: round2(amt),
      })
      setSettleTarget(null)
      await loadPlans()
    } catch (err) {
      setError(err instanceof Error ? err.message : '提前结清失败')
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setSubmitting(true)
    setError(null)
    try {
      await deleteInstallmentPlan(deleteTarget.id)
      setDeleteTarget(null)
      await loadPlans()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除分期失败')
      setDeleteTarget(null)
    } finally {
      setSubmitting(false)
    }
  }

  const schedulesById = useMemo(
    () => new Map(plans.map((p) => [p.id, p.schedule ?? generateInstallmentSchedule(p)])),
    [plans],
  )

  return (
    <div className='mb-2.5'>
      <div className='mb-1.5 flex items-center justify-between'>
        <p className='text-[15px] font-semibold leading-5 text-d-text'>
          分期计划（{plans.filter((p) => p.status === 'active').length} 项进行中）
        </p>
        <button
          type='button'
          onClick={openCreate}
          className='inline-flex min-h-[44px] items-center gap-1 px-2 text-[13px] font-semibold text-d-accent-light'
        >
          <PlusIcon size={14} />
          新建分期
        </button>
      </div>

      <div className='rounded-2xl border border-d-border bg-d-surface p-3.5'>
        {error && (
          <div className='mb-2.5'>
            <Alert severity='error'>{error}</Alert>
          </div>
        )}

        {loading ? (
          <p className='py-4 text-center text-[13px] text-d-muted'>正在加载分期计划…</p>
        ) : plans.length === 0 ? (
          <div className='py-3 text-center'>
            <p className='text-[13px] font-semibold text-d-text'>暂无分期计划</p>
            <p className='mt-1 text-[12px] text-d-muted'>
              登记消费分期、账单分期或现金分期后，首页总欠款与未来现金流将自动计入未出本金
            </p>
          </div>
        ) : (
          <div className='flex flex-col gap-3'>
            {plans.map((plan) => {
              const schedule = schedulesById.get(plan.id) ?? []
              const nextPeriod = schedule.find((s) => !s.is_paid)
              const unbilledPrincipal =
                plan.unbilled_principal ??
                round2(
                  schedule
                    .filter((s) => !s.is_paid && !s.covered_by_statement)
                    .reduce((sum, s) => sum + s.principal, 0),
                )
              const pct =
                plan.total_periods > 0
                  ? Math.round((plan.paid_periods / plan.total_periods) * 100)
                  : 0
              const st = STATUS_LABELS[plan.status] ?? STATUS_LABELS.active
              const planSym = currencySymbol(plan.currency || currency)

              return (
                <div
                  key={plan.id}
                  className='rounded-xl border border-d-border bg-d-subtle p-3'
                >
                  <div className='flex items-start justify-between gap-2'>
                    <div className='min-w-0'>
                      <p className='truncate text-[14px] font-semibold text-d-text'>
                        {plan.title}
                      </p>
                      <p className='mt-0.5 text-[11px] text-d-muted'>
                        {PLAN_TYPE_LABELS[plan.plan_type]} · {INSTALLMENT_FEE_MODE_LABELS[plan.fee_mode]} ·{' '}
                        {plan.billing_mode === 'included_in_statement' ? '已并入账单' : '独立跟踪'}
                      </p>
                    </div>
                    <span className={'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ' + st.cls}>
                      {st.label}
                    </span>
                  </div>

                  <div className='mt-2.5'>
                    <div className='mb-1 flex items-center justify-between text-[12px]'>
                      <span className='text-d-muted'>
                        已还 {plan.paid_periods} / {plan.total_periods} 期
                      </span>
                      <span className='num-tabular font-semibold text-d-text'>
                        剩余未出本金 {planSym}
                        {unbilledPrincipal.toLocaleString()}
                      </span>
                    </div>
                    <ProgressBar value={pct} />
                  </div>

                  {plan.status === 'active' && nextPeriod && (
                    <p className='mt-2 text-[12px] text-d-muted'>
                      下期（第 {nextPeriod.period_index} 期 · {nextPeriod.due_date}）：应还{' '}
                      <span className='num-tabular font-semibold text-d-gold'>
                        {planSym}
                        {nextPeriod.total.toFixed(2)}
                      </span>
                      （本金 {planSym}
                      {nextPeriod.principal.toFixed(2)}
                      {nextPeriod.fee > 0 ? ` + 手续费 ${planSym}${nextPeriod.fee.toFixed(2)}` : ''}）
                    </p>
                  )}

                  <div className='mt-2.5 flex flex-wrap items-center gap-2'>
                    {plan.status === 'active' && (
                      <>
                        <Button
                          size='sm'
                          className='h-11'
                          disabled={submitting || plan.paid_periods >= plan.total_periods}
                          onClick={() => handleAdvance(plan.id, 1)}
                        >
                          标记本期已还
                        </Button>
                        {plan.paid_periods > 0 && (
                          <Button
                            size='sm'
                            variant='secondary'
                            className='h-11'
                            disabled={submitting}
                            onClick={() => handleAdvance(plan.id, -1)}
                          >
                            撤销一期
                          </Button>
                        )}
                        <Button
                          size='sm'
                          variant='secondary'
                          className='h-11'
                          disabled={submitting}
                          onClick={() => {
                            setSettleTarget(plan)
                            setSettleDate(today)
                            setSettleAmountText(String(unbilledPrincipal))
                            setError(null)
                          }}
                        >
                          提前结清
                        </Button>
                      </>
                    )}
                    <button
                      type='button'
                      onClick={() => openEdit(plan)}
                      className='min-h-[44px] px-2 text-[12px] font-semibold text-d-accent-light'
                    >
                      编辑
                    </button>
                    <button
                      type='button'
                      aria-label='删除分期'
                      onClick={() => setDeleteTarget(plan)}
                      className='flex min-h-[44px] min-w-[36px] items-center justify-center text-d-danger-ink'
                    >
                      <TrashIcon size={15} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 新建 / 编辑分期弹窗 */}
      <Modal
        open={formOpen}
        onClose={() => !submitting && setFormOpen(false)}
        dismissible={!submitting}
        maxWidth='md'
        title={editingPlan ? '编辑分期计划' : '新建分期计划'}
        footer={
          <>
            <Button variant='ghost' onClick={() => setFormOpen(false)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleSave} loading={submitting}>
              保存
            </Button>
          </>
        }
      >
        <div className='flex flex-col gap-3'>
          {error && <Alert severity='error'>{error}</Alert>}
          <TextField
            label='分期名称'
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder='如：iPhone 17 Pro 12期免息'
          />

          {!editingPlan && (
            <>
              <div className='grid grid-cols-2 gap-2.5'>
                <SelectField
                  label='分期类型'
                  value={planType}
                  onChange={(e) => setPlanType(e.target.value as InstallmentPlanType)}
                  options={[
                    { value: 'purchase', label: '消费分期' },
                    { value: 'bill', label: '账单分期' },
                    { value: 'cash', label: '现金分期' },
                  ]}
                />
                <TextField
                  label={`分期本金 (${currency})`}
                  type='number'
                  inputMode='decimal'
                  step='0.01'
                  required
                  value={principalText}
                  onChange={(e) => setPrincipalText(e.target.value)}
                  startAdornment={<span>{sym}</span>}
                />
              </div>

              <div className='grid grid-cols-3 gap-2'>
                <TextField
                  label='总期数 (2-60)'
                  type='number'
                  value={totalPeriodsText}
                  onChange={(e) => setTotalPeriodsText(e.target.value)}
                />
                <TextField
                  label='已还期数'
                  type='number'
                  value={paidPeriodsText}
                  onChange={(e) => setPaidPeriodsText(e.target.value)}
                />
                <TextField
                  label='首期账月'
                  type='month'
                  value={startMonth}
                  onChange={(e) => setStartMonth(e.target.value)}
                />
              </div>

              <SelectField
                label='计息模式'
                value={feeMode}
                onChange={(e) => setFeeMode(e.target.value as InstallmentFeeMode)}
                options={[
                  { value: 'equal_principal_fee', label: '等额本金 + 每期固定费率/手续费' },
                  { value: 'interest_free', label: '免息分期 (0手续费)' },
                  { value: 'equal_installment_apr', label: '等额本息 (年化 APR)' },
                ]}
              />

              {feeMode === 'equal_principal_fee' && (
                <div className='grid grid-cols-3 gap-2'>
                  <SelectField
                    label='收费方式'
                    value={feeChargeMode}
                    onChange={(e) => setFeeChargeMode(e.target.value as InstallmentFeeChargeMode)}
                    options={[
                      { value: 'per_period', label: '分期收取' },
                      { value: 'upfront', label: '首期一次性' },
                    ]}
                  />
                  <TextField
                    label='每期费率 (%)'
                    type='number'
                    inputMode='decimal'
                    step='0.01'
                    value={feeRatePctText}
                    onChange={(e) => setFeeRatePctText(e.target.value)}
                    disabled={Boolean(customFeeText.trim())}
                  />
                  <TextField
                    label='或固定手续费'
                    type='number'
                    inputMode='decimal'
                    step='0.01'
                    value={customFeeText}
                    onChange={(e) => setCustomFeeText(e.target.value)}
                    placeholder='选填'
                  />
                </div>
              )}

              {feeMode === 'equal_installment_apr' && (
                <TextField
                  label='年化利率 APR (%)'
                  type='number'
                  inputMode='decimal'
                  step='0.1'
                  value={aprPctText}
                  onChange={(e) => setAprPctText(e.target.value)}
                />
              )}
            </>
          )}

          {editingPlan && (
            <TextField
              label={`已还期数 (0-${editingPlan.total_periods})`}
              type='number'
              value={paidPeriodsText}
              onChange={(e) => setPaidPeriodsText(e.target.value)}
            />
          )}

          <div className='grid grid-cols-2 gap-2.5'>
            <TextField
              label='每月还款日 (1-31)'
              type='number'
              value={dueDayText}
              onChange={(e) => setDueDayText(e.target.value)}
            />
            <SelectField
              label='还款月偏移'
              value={dueMonthOffset}
              onChange={(e) => setDueMonthOffset(e.target.value as '0' | '1')}
              options={[
                { value: '0', label: '账单当月到期' },
                { value: '1', label: '账单次月到期（跨月还款）' },
              ]}
            />
          </div>

          <SelectField
            label='入账与防重统计模式'
            value={billingMode}
            onChange={(e) => setBillingMode(e.target.value as InstallmentBillingMode)}
            options={[
              { value: 'included_in_statement', label: '已并入每月银行账单（防重推荐）' },
              { value: 'independent', label: '独立跟踪（未并入月账单）' },
            ]}
          />

          <TextField
            label='备注（可选）'
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          {!editingPlan && previewSchedule.length > 0 && (
            <div className='rounded-xl border border-d-border bg-d-subtle p-3'>
              <p className='text-[12px] font-semibold text-d-text'>分期摊销预览（前 3 期 + 末期）</p>
              <div className='mt-1.5 space-y-1 text-[11px] text-d-muted'>
                {[...previewSchedule.slice(0, 3), ...(previewSchedule.length > 3 ? [previewSchedule[previewSchedule.length - 1]] : [])].map((p) => (
                  <div key={p.period_index} className='flex justify-between'>
                    <span>
                      第 {p.period_index} 期 ({p.due_date})
                    </span>
                    <span className='num-tabular font-semibold text-d-text'>
                      {sym}
                      {p.total.toFixed(2)}（本 {sym}
                      {p.principal.toFixed(2)}
                      {p.fee > 0 ? ` + 费 ${sym}${p.fee.toFixed(2)}` : ''}）
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* 提前结清弹窗 */}
      <Modal
        open={settleTarget !== null}
        onClose={() => !submitting && setSettleTarget(null)}
        dismissible={!submitting}
        title={`提前结清 · ${settleTarget?.title ?? ''}`}
        footer={
          <>
            <Button variant='ghost' onClick={() => setSettleTarget(null)} disabled={submitting}>
              取消
            </Button>
            <Button onClick={handleSettleEarly} loading={submitting}>
              确认结清
            </Button>
          </>
        }
      >
        <div className='flex flex-col gap-3'>
          {error && <Alert severity='error'>{error}</Alert>}
          <TextField
            label='结清日期'
            type='date'
            value={settleDate}
            onChange={(e) => setSettleDate(e.target.value)}
          />
          <TextField
            label={`实付结清金额 (${currency})`}
            type='number'
            inputMode='decimal'
            step='0.01'
            value={settleAmountText}
            onChange={(e) => setSettleAmountText(e.target.value)}
            startAdornment={<span>{sym}</span>}
          />
        </div>
      </Modal>

      {/* 删除确认（禁用原生 window.confirm） */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title='确认删除该分期计划？'
        onClose={() => !submitting && setDeleteTarget(null)}
        actions={
          <>
            <Button variant='ghost' onClick={() => setDeleteTarget(null)} disabled={submitting}>
              取消
            </Button>
            <Button variant='danger' onClick={handleDelete} loading={submitting}>
              确认删除
            </Button>
          </>
        }
      >
        <p className='text-[13px] text-d-muted'>
          将删除分期「{deleteTarget?.title}」，关联的历史账单不会被删除。
        </p>
      </ConfirmDialog>
    </div>
  )
}
