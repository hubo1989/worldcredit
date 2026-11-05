'use client'

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField, TextArea, SelectField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import {
  createRecurringPayable,
  updateRecurringPayable,
  getPayableCustomCategories,
  CUSTOM_CATEGORY_SENTINEL,
  MAX_CUSTOM_CATEGORY_LENGTH,
  MIN_PAYABLE_CYCLE_MONTHS,
  MAX_PAYABLE_CYCLE_MONTHS,
  PAYABLE_CATEGORIES,
  PAYABLE_CYCLE_OPTIONS,
  PAYABLE_CURRENCIES,
  PAYABLE_CURRENCY_LABELS,
  dedupeCustomCategories,
  isValidEveryNMonths,
  isValidPayablePeriod,
  normalizeCustomCategoryName,
  normalizePayableCurrency,
  resolvePresetPayableCategory,
  type PayableCategory,
  type PayableCycleType,
  type PayableWithStatus,
} from '@/lib/api/payables'
import { getHolders } from '@/lib/api/holders'
import { getBankNames } from '@/lib/api/banks'
import { currencySymbol } from '@/lib/fx'
import { payablePeriodOf } from '@/lib/utils'
import type { CardHolder } from '@/lib/types'
import { useAuth } from '@/lib/auth'

// 银行目录变化频率低：进程内缓存，避免每次打开弹窗重复拉取
let bankCatalogCache: string[] | null = null
async function loadBankNames(): Promise<string[]> {
  if (bankCatalogCache) return bankCatalogCache
  const list = await getBankNames()
  bankCatalogCache = list.map(b => b.name)
  return bankCatalogCache
}

/** Select 里代表「保留历史未知币种」的哨兵值。 */
const LEGACY_CURRENCY = '__legacy__'

/** Select 里已持久化的自定义分类 option value 前缀，避免与预设值/哨兵值碰撞。 */
const SAVED_CUSTOM_PREFIX = 'custom:'

export interface ResolvedPayableCategorySelection {
  category: PayableCategory
  customCategory: string | null
}

/**
 * 将自定义分类名称解析为「预设分类」或「归一化的自定义分类」。
 *
 * 若输入同义于预设分类（如「房租」），自动收拢为预设枚举，避免产生重复的自定义分类；
 * 若为有效的新自定义分类，归一化后保留为 customCategory；
 * 若输入为空或全空白，返回 null。
 */
export function resolvePayableCategorySelection(
  rawCustom: unknown,
  fallbackCategory: PayableCategory = 'other'
): ResolvedPayableCategorySelection | null {
  const normalized = normalizeCustomCategoryName(rawCustom)
  if (!normalized) return null
  const matchedPreset = resolvePresetPayableCategory(normalized)
  if (matchedPreset) {
    return { category: matchedPreset, customCategory: null }
  }
  return { category: fallbackCategory, customCategory: normalized }
}

/** 周期类型对应的金额输入标签文案映射表（规避嵌套三元）。 */
const CYCLE_AMOUNT_LABELS: Record<PayableCycleType, string> = {
  monthly: '每月金额',
  every_n_months: '每期金额',
  yearly: '每年金额',
}

interface Props {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  /** 传入则为编辑模式 */
  existing?: PayableWithStatus | null
}

/**
 * 新增/编辑周期性固定支出（支持每月 / 每 X 月 / 每年，以及自定义分类）。
 *
 * 有意不复用 BillForm：账单的 card_id 是必填外键，房租没有卡。塞进信用卡账单
 * 会污染卡数、额度与免息期口径（见 migrations/d1/0009）。
 */
export function PayableForm({ open, onClose, onSuccess, existing }: Props) {
  const { user } = useAuth()
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [name, setName] = useState('')
  const [categorySelection, setCategorySelection] = useState<string>('rent')
  const [customCategoryInput, setCustomCategoryInput] = useState('')
  const [customCategories, setCustomCategories] = useState<string[]>([])
  const [cycleType, setCycleType] = useState<PayableCycleType>('monthly')
  const [cycleMonths, setCycleMonths] = useState('')
  const [dueMonth, setDueMonth] = useState(() => String(new Date().getMonth() + 1))
  const [anchorPeriod, setAnchorPeriod] = useState(() => payablePeriodOf())
  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('CNY')
  const [dueDay, setDueDay] = useState('')
  const [holderId, setHolderId] = useState('')
  const [note, setNote] = useState('')
  const [bankName, setBankName] = useState('')
  const [bankOptions, setBankOptions] = useState<string[]>([])
  const [bankAccount, setBankAccount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // 历史未知币种（如 EUR）：只用于显式展示与「保留」选项
  const legacyCurrency =
    existing && normalizePayableCurrency(existing.currency) === null ? existing.currency : null
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    // 关闭后到达的旧响应直接丢弃，避免快速开关时覆盖新状态
    let cancelled = false
    getHolders()
      .then(list => { if (!cancelled) setHolders(list) })
      .catch(() => { if (!cancelled) setHolders([]) })
    loadBankNames()
      .then(list => { if (!cancelled) setBankOptions(list) })
      .catch(() => { if (!cancelled) setBankOptions([]) })
    getPayableCustomCategories(user?.id)
      .then(list => {
        if (!cancelled && Array.isArray(list)) {
          setCustomCategories(prev => dedupeCustomCategories([...list, ...prev]))
        }
      })
      .catch(() => {
        // 离线或未模拟该 RPC 时保留当前会话内已缓存的自定义分类
      })
    return () => { cancelled = true }
  }, [open, user?.id])

  useEffect(() => {
    if (!open) return
    setError(null)
    const defaultPeriod = payablePeriodOf()
    const defaultMonth = String(new Date().getMonth() + 1)

    if (existing) {
      setName(existing.name)
      const resolvedCustom = resolvePayableCategorySelection(existing.custom_category)
      if (resolvedCustom?.customCategory) {
        setCategorySelection(`${SAVED_CUSTOM_PREFIX}${resolvedCustom.customCategory}`)
      } else {
        setCategorySelection(resolvedCustom?.category ?? existing.category)
      }
      setCustomCategoryInput('')
      const existingCycle = existing.cycle_type ?? 'monthly'
      setCycleType(existingCycle)
      setCycleMonths(
        existingCycle === 'every_n_months' && existing.cycle_months
          ? String(existing.cycle_months)
          : ''
      )
      const fallbackYearlyMonth =
        existing.anchor_period && isValidPayablePeriod(existing.anchor_period)
          ? String(Number(existing.anchor_period.slice(5, 7)))
          : defaultMonth
      setDueMonth(existing.due_month ? String(existing.due_month) : fallbackYearlyMonth)
      setAnchorPeriod(existing.anchor_period || defaultPeriod)
      setAmount(String(existing.amount))
      setCurrency(normalizePayableCurrency(existing.currency) ?? LEGACY_CURRENCY)
      setDueDay(String(existing.due_day))
      setHolderId(existing.holder_id || '')
      setNote(existing.note || '')
      setBankName(existing.bank_name || '')
      setBankAccount(existing.bank_account || '')
    } else {
      setName('')
      setCategorySelection('rent')
      setCustomCategoryInput('')
      setCycleType('monthly')
      setCycleMonths('')
      setDueMonth(defaultMonth)
      setAnchorPeriod(defaultPeriod)
      setAmount('')
      setCurrency('CNY')
      setDueDay('')
      setHolderId('')
      setNote('')
      setBankName('')
      setBankAccount('')
    }
  }, [open, existing])

  const mergedCustomCategories = useMemo(
    () => dedupeCustomCategories([...customCategories, existing?.custom_category]),
    [customCategories, existing?.custom_category]
  )

  const categoryOptions = useMemo(
    () => [
      ...PAYABLE_CATEGORIES.map(c => ({ value: c.value, label: c.label })),
      ...mergedCustomCategories.map(item => ({
        value: `${SAVED_CUSTOM_PREFIX}${item}`,
        label: item,
      })),
      { value: CUSTOM_CATEGORY_SENTINEL, label: '自定义' },
    ],
    [mergedCustomCategories]
  )

  const handleSubmit = async () => {
    setError(null)
    const parsedAmount = parseFloat(amount)
    const rawDay = dueDay.trim()
    const parsedDay = rawDay === '' ? NaN : Number(rawDay)

    if (!name.trim()) return setError('请填写名称')
    if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
      return setError('金额必须是不小于 0 的数字')
    }
    if (!Number.isInteger(parsedDay) || parsedDay < 1 || parsedDay > 31) {
      return setError(
        cycleType === 'monthly' ? '每月应付日必须在 1–31 之间' : '应付日必须在 1–31 之间'
      )
    }

    // 1. 解析并校验分类（预设 / 已保存自定义 / 新输入自定义）
    let resolvedCategory: PayableCategory
    let resolvedCustomCategory: string | null = null
    if (categorySelection === CUSTOM_CATEGORY_SENTINEL) {
      const resolved = resolvePayableCategorySelection(customCategoryInput)
      if (!resolved) {
        return setError('请填写自定义分类名称')
      }
      if (resolved.customCategory && resolved.customCategory.length > MAX_CUSTOM_CATEGORY_LENGTH) {
        return setError(`自定义分类名称不能超过 ${MAX_CUSTOM_CATEGORY_LENGTH} 个字符`)
      }
      resolvedCategory = resolved.category
      resolvedCustomCategory = resolved.customCategory
    } else if (categorySelection.startsWith(SAVED_CUSTOM_PREFIX)) {
      const savedName = categorySelection.slice(SAVED_CUSTOM_PREFIX.length)
      const resolved = resolvePayableCategorySelection(savedName)
      if (!resolved || !resolved.customCategory) {
        return setError('请选择合法的支出分类')
      }
      resolvedCategory = resolved.category
      resolvedCustomCategory = resolved.customCategory
    } else {
      resolvedCategory = categorySelection as PayableCategory
      resolvedCustomCategory = null
    }

    // 2. 解析并校验周期参数
    let resolvedCycleMonths = 1
    let resolvedDueMonth: number | null = null
    let resolvedAnchorPeriod: string | null = null

    if (cycleType === 'every_n_months') {
      const rawMonths = cycleMonths.trim()
      const parsedMonths = rawMonths === '' ? NaN : Number(rawMonths)
      if (!isValidEveryNMonths(parsedMonths)) {
        return setError(
          `间隔月数必须是 ${MIN_PAYABLE_CYCLE_MONTHS}–${MAX_PAYABLE_CYCLE_MONTHS} 之间的整数`
        )
      }
      resolvedCycleMonths = parsedMonths
      const trimmedAnchor = anchorPeriod.trim()
      if (trimmedAnchor && !isValidPayablePeriod(trimmedAnchor)) {
        return setError('起算月份格式必须为 YYYY-MM')
      }
      resolvedAnchorPeriod = trimmedAnchor || payablePeriodOf()
    } else if (cycleType === 'yearly') {
      const parsedMonth = Number(dueMonth)
      if (!Number.isInteger(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
        return setError('每年应付月份必须是 1–12 之间的整数')
      }
      resolvedCycleMonths = 12
      resolvedDueMonth = parsedMonth
    }

    const normalizedCurrency = normalizePayableCurrency(currency)
    const keepLegacyCurrency = currency === LEGACY_CURRENCY && legacyCurrency !== null
    if (!normalizedCurrency && !keepLegacyCurrency) {
      return setError('币种必须是 CNY / USD / HKD 之一')
    }

    setSubmitting(true)
    try {
      const payload = {
        name: name.trim(),
        category: resolvedCategory,
        custom_category: resolvedCustomCategory,
        amount: parsedAmount,
        cycle_type: cycleType,
        cycle_months: resolvedCycleMonths,
        due_month: resolvedDueMonth,
        due_day: parsedDay,
        ...(cycleType === 'every_n_months' ? { anchor_period: resolvedAnchorPeriod } : {}),
        holder_id: holderId || null,
        note: note.trim() || null,
        bank_name: bankName.trim() || null,
        bank_account: bankAccount.trim() || null,
      }
      if (existing) {
        // 历史未知币种不回传，避免只改名称/备注时触发币种变更或丢失原币种。
        await updateRecurringPayable(existing.id, {
          ...payload,
          ...(normalizedCurrency ? { currency: normalizedCurrency } : {}),
        })
      } else {
        // 显式兜底而不是非空断言：校验遗漏时也要给出可读错误
        if (!normalizedCurrency) {
          setError('币种必须是 CNY / USD / HKD 之一')
          return
        }
        await createRecurringPayable({
          ...payload,
          currency: normalizedCurrency,
          created_by: user?.id ?? '',
        })
      }
      if (resolvedCustomCategory) {
        setCustomCategories(prev => dedupeCustomCategories([...prev, resolvedCustomCategory]))
      }
      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const amountLabel = CYCLE_AMOUNT_LABELS[cycleType] ?? '每月金额'

  return (
    <Modal
      open={open}
      onClose={() => !submitting && onClose()}
      dismissible={!submitting}
      title={existing ? '编辑固定支出' : '添加固定支出'}
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={submitting}>取消</Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {submitting ? '保存中...' : '保存'}
          </Button>
        </>
      }
    >
      <div className='flex flex-col gap-4'>
        <TextField
          autoFocus
          label="名称"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="如：房租、房贷"
        />
        <SelectField
          label="类型"
          value={categorySelection}
          onChange={e => setCategorySelection(e.target.value)}
          options={categoryOptions}
        />
        {categorySelection === CUSTOM_CATEGORY_SENTINEL && (
          <TextField
            label="自定义分类"
            value={customCategoryInput}
            onChange={e => setCustomCategoryInput(e.target.value)}
            placeholder="输入新分类名称，如：宽带、车位费"
            maxLength={MAX_CUSTOM_CATEGORY_LENGTH}
            helperText="保存后自动去重记住，下次添加可直接选用"
          />
        )}
        <SelectField
          label="周期"
          value={cycleType}
          onChange={e => setCycleType(e.target.value as PayableCycleType)}
          options={PAYABLE_CYCLE_OPTIONS}
        />
        {cycleType === 'every_n_months' && (
          <div className='flex items-start gap-3'>
            <div className='min-w-0 flex-1'>
              <TextField
                type="number"
                label="间隔月数"
                value={cycleMonths}
                onChange={e => setCycleMonths(e.target.value)}
                placeholder={`${MIN_PAYABLE_CYCLE_MONTHS}–${MAX_PAYABLE_CYCLE_MONTHS}`}
                helperText="填写整数，如 3 表示每 3 个月"
                inputMode='numeric'
                min={MIN_PAYABLE_CYCLE_MONTHS}
                max={MAX_PAYABLE_CYCLE_MONTHS}
              />
            </div>
            <div className='w-40 shrink-0'>
              <TextField
                type="month"
                label="起算月份"
                value={anchorPeriod}
                onChange={e => setAnchorPeriod(e.target.value)}
                helperText="首个应付账期"
              />
            </div>
          </div>
        )}
        <div className='flex items-start gap-3'>
          <div className='min-w-0 flex-1'>
            <TextField
              type="number"
              label={amountLabel}
              value={amount}
              onChange={e => setAmount(e.target.value)}
              startAdornment={
                <span>
                  {legacyCurrency ?? currencySymbol(normalizePayableCurrency(currency) ?? 'CNY')}
                </span>
              }
              inputMode='decimal' min={0} step='0.01'
            />
          </div>
          <div className='w-32 shrink-0'>
            <SelectField
              label="币种"
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              options={[
                ...(legacyCurrency !== null
                  ? [{ value: LEGACY_CURRENCY, label: `保留 ${legacyCurrency || '空币种'}（历史值）` }]
                  : []),
                ...PAYABLE_CURRENCIES.map(c => ({ value: c, label: PAYABLE_CURRENCY_LABELS[c] })),
              ]}
              helperText={
                legacyCurrency !== null
                  ? '可保留历史币种；如需更改，请选择 CNY / USD / HKD，并核对金额。'
                  : undefined
              }
            />
          </div>
        </div>
        {cycleType === 'yearly' ? (
          <div className='flex items-start gap-3'>
            <div className='w-32 shrink-0'>
              <SelectField
                label="应付月份"
                value={dueMonth}
                onChange={e => setDueMonth(e.target.value)}
                options={Array.from({ length: 12 }, (_, idx) => ({
                  value: String(idx + 1),
                  label: `${idx + 1} 月`,
                }))}
              />
            </div>
            <div className='min-w-0 flex-1'>
              <TextField
                type="number"
                label="应付日"
                value={dueDay}
                onChange={e => setDueDay(e.target.value)}
                placeholder="1–31"
                helperText="每年按同月同日推导下一次（超过当月天数按月末算）"
                inputMode='numeric' min={1} max={31}
              />
            </div>
          </div>
        ) : (
          <TextField
            type="number"
            label={cycleType === 'monthly' ? '每月应付日' : '应付日'}
            value={dueDay}
            onChange={e => setDueDay(e.target.value)}
            placeholder="1–31"
            helperText="超过当月天数时按月最后一天计算"
            inputMode='numeric' min={1} max={31}
          />
        )}
        {holders.length > 0 && (
          <SelectField
            label="归属（可选）"
            value={holderId}
            onChange={e => setHolderId(e.target.value)}
            options={[
              { value: '', label: '不指定' },
              ...holders.map(h => ({ value: h.id, label: h.name })),
            ]}
          />
        )}
        <SelectField
          label="银行（可选）"
          value={bankName}
          onChange={e => setBankName(e.target.value)}
          options={[
            { value: '', label: '非银行 / 不指定' },
            ...Array.from(new Set([
              ...bankOptions,
              ...(existing?.bank_name ? [existing.bank_name] : []),
            ])).map(name => ({ value: name, label: name })),
          ]}
          helperText="用于账单页按银行筛选固定支出"
        />
        <TextField
          label="银行账号（可选）"
          value={bankAccount}
          onChange={e => setBankAccount(e.target.value)}
          placeholder="还款/转账的收款账号"
          helperText="保存后显示在固定支出卡片上，点击可复制"
        />
        <TextArea
          label="备注（可选）"
          value={note}
          onChange={e => setNote(e.target.value)}
          rows={2}
        />
        {/* 与卡账分开是刻意的，说清楚避免用户以为「没进账单就是没生效」 */}
        <p className='text-[13px] leading-5 text-d-muted'>
          固定支出不占用信用卡额度，单独计入当期应付；与卡账分开统计。
        </p>
        {error && <Alert severity="error">{error}</Alert>}
      </div>
    </Modal>
  )
}
