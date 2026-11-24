'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ChevronLeftIcon,
  ChevronDownIcon,
  ClockIcon,
  AlertIcon,
} from '@/components/icons/WcIcon'
import { Button } from '@/components/obsidian/controls'
import { SelectField, TextField } from '@/components/obsidian/fields'
import { Alert, Skeleton } from '@/components/obsidian/feedback'
import { useAuth } from '@/lib/auth'
import { getHolders } from '@/lib/api/holders'
import { useUserPreferences } from '@/lib/hooks/useUserPreferences'
import { resolveDisplayCurrency } from '@/lib/api/preferences.shared'
import { currencySymbol } from '@/lib/fx'
import { formatCardTail, getLocalTodayString } from '@/lib/utils'
import type { CardHolder } from '@/lib/types'
import { getCardRecommendations } from '@/lib/recommendations-ui/rpc'
import { formatCurrencyAmount } from '@/lib/recommendations-ui/helpers'
import {
  OPTIMIZE_FOR_OPTIONS,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_CATEGORY_META,
  type CardRecommendationItem,
  type OptimizeForMode,
  type RecommendationCategory,
  type RecommendationEngineOutput,
} from '@/lib/recommendations-ui/types'

const QUICK_CURRENCIES = ['CNY', 'USD', 'HKD', 'JPY', 'EUR', 'GBP']
const ALL_CURRENCIES = [
  'CNY',
  'USD',
  'HKD',
  'JPY',
  'EUR',
  'GBP',
  'SGD',
  'AUD',
  'CAD',
  'TWD',
  'KRW',
  'THB',
  'MYR',
]

const FACTOR_LABELS: Record<string, string> = {
  reward: '返现/积分',
  ftf: '外币货转费',
  currency_match: '本币匹配',
  grace_period: '免息期',
  task_bonus: '达标/免年费',
  opportunity_bonus: '叠加权益',
}

function RecommendationCard({
  item,
  purchaseCurrency,
  displayCurrency,
  isAdmin,
  defaultExpanded,
}: {
  item: CardRecommendationItem
  purchaseCurrency: string
  displayCurrency: string
  isAdmin: boolean
  defaultExpanded: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const isTop1 = item.rank === 1
  const tail = formatCardTail(item.card_number_last4)

  return (
    <div
      className={
        'rounded-2xl border p-4 transition-colors ' +
        (isTop1
          ? 'border-d-gold bg-d-surface shadow-[0_0_0_1px_rgba(240,199,94,0.2)]'
          : 'border-d-border bg-d-surface')
      }
    >
      {/* 头部：名次 + 卡名 + 净收益 */}
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0 flex-1'>
          <div className='flex flex-wrap items-center gap-1.5'>
            <span
              className={
                'rounded-full px-2 py-0.5 text-[11px] font-bold ' +
                (isTop1
                  ? 'bg-d-gold-soft text-d-gold'
                  : 'bg-d-subtle text-d-muted')
              }
            >
              {isTop1 ? 'Top 1 · 最佳推荐' : `Top ${item.rank}`}
            </span>
            <span className='rounded-full bg-d-subtle px-2 py-0.5 text-[11px] font-semibold text-d-muted'>
              {item.card_currency}
            </span>
            {item.is_shared_quota && (
              <span className='rounded-full bg-d-subtle px-2 py-0.5 text-[11px] text-d-accent-light'>
                共享额度池
              </span>
            )}
            {item.rule_completeness === 'none' && (
              <span className='rounded-full bg-d-subtle px-2 py-0.5 text-[11px] font-semibold text-d-warn-ink'>
                未配置回报规则（按 0% 兜底）
              </span>
            )}
          </div>

          <Link
            href={`/cards/${item.card_id}`}
            className='mt-2 block text-[16px] font-bold leading-5 text-d-text hover:text-d-accent-light'
          >
            {item.bank_name} · {item.card_name}
            {tail ? ` (${tail})` : ''}
          </Link>
          <p className='mt-0.5 text-[12px] text-d-muted'>
            持卡人：{item.holder_name} ·{' '}
            <span className='inline-flex items-center gap-1'>
              <ClockIcon size={12} />
              免息 {item.grace_days} 天（还款日 {item.next_due_date}）
            </span>
          </p>
        </div>

        <div className='shrink-0 text-right'>
          <p className='num-tabular text-[19px] font-bold leading-6 text-d-gold'>
            {formatCurrencyAmount(item.estimated_net_reward_purchase_ccy, purchaseCurrency, true)}
          </p>
          <p className='num-tabular text-[11px] font-semibold text-d-muted'>
            净回报 {item.net_rate_pct.toFixed(2)}% · {item.total_score.toFixed(2)} 分
          </p>
          {item.estimated_net_reward_display_ccy !== null &&
            purchaseCurrency !== displayCurrency && (
              <p className='num-tabular text-[11px] text-d-muted'>
                约 {formatCurrencyAmount(item.estimated_net_reward_display_ccy, displayCurrency, true)}
              </p>
            )}
        </div>
      </div>

      {/* 可用额度 & 警示胶囊 */}
      <div className='mt-3 flex flex-wrap items-center gap-2 text-[12px]'>
        <span className='rounded-lg bg-d-subtle px-2.5 py-1 text-d-muted'>
          可用额度：
          <span className='num-tabular font-semibold text-d-text'>
            {item.available_credit !== null
              ? formatCurrencyAmount(item.available_credit, item.card_currency)
              : '未设置'}
          </span>
        </span>
        <span className='rounded-lg bg-d-subtle px-2.5 py-1 text-d-muted'>
          下期账单日：{item.next_billing_date}
        </span>
      </div>

      {item.warnings.length > 0 && (
        <div className='mt-2.5 flex flex-col gap-1'>
          {item.warnings.map((w, idx) => (
            <p
              key={idx}
              className='flex items-start gap-1.5 rounded-xl bg-d-subtle px-3 py-2 text-[12px] text-d-warn-ink'
            >
              <AlertIcon size={14} className='mt-0.5 shrink-0' />
              <span>{w}</span>
            </p>
          ))}
        </div>
      )}

      {item.skipped_task_hints.length > 0 && (
        <div className='mt-2 flex flex-col gap-1'>
          {item.skipped_task_hints.map((hint, idx) => (
            <p
              key={idx}
              className='rounded-xl border border-d-border bg-d-bg px-3 py-1.5 text-[12px] text-d-muted'
            >
              {hint}
            </p>
          ))}
        </div>
      )}

      {/* 命中权益/优惠 */}
      {item.matched_opportunities.length > 0 && (
        <div className='mt-2.5 flex flex-wrap gap-1.5'>
          {item.matched_opportunities.map((opp) => (
            <Link
              key={opp.id}
              href={opp.target_url}
              className='inline-flex min-h-[36px] items-center gap-1 rounded-full border border-d-accent/40 bg-d-subtle px-3 py-1 text-[12px] font-semibold text-d-accent-light'
            >
              <span>{opp.title}</span>
              <span className='text-[11px] text-d-muted'>· {opp.status_label}</span>
            </Link>
          ))}
        </div>
      )}

      {/* 得分拆解开关 */}
      <div className='mt-3 border-t border-d-border/70 pt-2.5'>
        <button
          type='button'
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className='flex min-h-[44px] w-full items-center justify-between text-left text-[13px] font-semibold text-d-text'
        >
          <span>可解释得分拆解（{item.score_breakdown.length} 项）</span>
          <ChevronDownIcon
            size={16}
            className={'transition-transform ' + (expanded ? 'rotate-180' : '')}
          />
        </button>

        {expanded && (
          <div className='mt-2 flex flex-col gap-2'>
            {item.score_breakdown.map((b, idx) => (
              <div
                key={`${b.factor}-${idx}`}
                className='flex items-start justify-between gap-3 rounded-xl bg-d-subtle px-3 py-2 text-[12px]'
              >
                <div className='min-w-0 flex-1'>
                  <div className='flex items-center gap-1.5'>
                    <span className='rounded bg-d-surface px-1.5 py-0.5 text-[10px] font-semibold text-d-muted'>
                      {FACTOR_LABELS[b.factor] ?? b.factor}
                    </span>
                    <span className='font-medium text-d-text'>{b.label}</span>
                  </div>
                  <p className='mt-0.5 text-[11px] text-d-muted'>来源：{b.rule_source}</p>
                </div>
                <span
                  className={
                    'num-tabular shrink-0 font-bold ' +
                    (b.score > 0
                      ? 'text-d-success-ink'
                      : b.score < 0
                        ? 'text-d-danger-ink'
                        : 'text-d-muted')
                  }
                >
                  {b.score > 0 ? `+${b.score.toFixed(2)}` : b.score.toFixed(2)}
                </span>
              </div>
            ))}

            {item.rule_completeness === 'none' && (
              <div className='rounded-xl border border-dashed border-d-border bg-d-bg p-2.5 text-[12px]'>
                <div className='flex items-center justify-between gap-2'>
                  <button
                    type='button'
                    onClick={() => setFallbackOpen((v) => !v)}
                    className='font-semibold text-d-muted hover:text-d-text'
                  >
                    {fallbackOpen ? '收起旧版回报文本参考' : '查看旧版回报文本参考'}
                  </button>
                  {isAdmin && (
                    <Link
                      href='/admin/card-products'
                      className='font-semibold text-d-accent-light'
                    >
                      去后台补充规则 ›
                    </Link>
                  )}
                </div>
                {fallbackOpen && (
                  <p className='mt-1.5 whitespace-pre-wrap text-[12px] text-d-muted'>
                    {item.rewards_summary_fallback || '该卡产品暂无回报摘要文本'}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export function CardRecommendationAssistant() {
  const { user } = useAuth()
  const router = useRouter()
  const { displayConfig } = useUserPreferences()
  const displayCurrency = resolveDisplayCurrency(displayConfig)
  const isAdmin = user?.role === 'admin'

  const [amountInput, setAmountInput] = useState('500')
  const [currency, setCurrency] = useState(displayCurrency || 'CNY')
  const [currencyTouched, setCurrencyTouched] = useState(false)
  const [category, setCategory] = useState<RecommendationCategory | null>(null)
  const [merchantKeyword, setMerchantKeyword] = useState('')
  const [holderId, setHolderId] = useState<string>('all')
  const [optimizeFor, setOptimizeFor] = useState<OptimizeForMode>('balanced')
  const [purchaseDate, setPurchaseDate] = useState(() => getLocalTodayString())
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const [holders, setHolders] = useState<CardHolder[]>([])
  const [result, setResult] = useState<RecommendationEngineOutput | null>(null)
  const [loading, setLoading] = useState(false)
  const [validationError, setValidationError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [othersExpanded, setOthersExpanded] = useState(false)

  useEffect(() => {
    if (!currencyTouched && displayCurrency) {
      setCurrency(displayCurrency)
    }
  }, [displayCurrency, currencyTouched])

  useEffect(() => {
    if (!user?.id) return
    getHolders(user.id)
      .then((list) => {
        setHolders(list)
        if (user.role !== 'admin' && list.length === 1) {
          setHolderId(list[0].id)
        }
      })
      .catch(() => {
        setHolders([])
      })
  }, [user?.id, user?.role])

  const validateAmount = useCallback((raw: string): number | null => {
    const trimmed = raw.trim()
    if (!trimmed) return null
    const num = Number(trimmed)
    if (!Number.isFinite(num) || num <= 0) return null
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed) && Math.round(num * 100) / 100 !== num) {
      return Math.round(num * 100) / 100
    }
    return num
  }, [])

  const runRecommend = useCallback(
    async (overrides?: {
      amountStr?: string
      currency?: string
      category?: RecommendationCategory | null
      optimizeFor?: OptimizeForMode
    }) => {
      const targetAmountStr = overrides?.amountStr ?? amountInput
      const parsedAmount = validateAmount(targetAmountStr)
      if (parsedAmount === null) {
        setValidationError('请输入大于 0 的消费金额')
        return
      }
      setValidationError(null)
      setSubmitError(null)
      setLoading(true)
      try {
        const effectiveHolderId =
          user?.role === 'admin'
            ? holderId
            : holders.length > 0
              ? holders[0].id
              : null
        const out = await getCardRecommendations({
          amount: parsedAmount,
          currency: overrides?.currency ?? currency,
          category: overrides && 'category' in overrides ? overrides.category : category,
          holder_id: effectiveHolderId,
          merchant_keyword: merchantKeyword.trim() ? merchantKeyword.trim().slice(0, 40) : null,
          purchase_date: purchaseDate || null,
          optimize_for: overrides?.optimizeFor ?? optimizeFor,
          display_currency: displayCurrency,
        })
        setResult(out)
      } catch (err) {
        setSubmitError(err instanceof Error ? err.message : '计算推荐结果失败')
      } finally {
        setLoading(false)
      }
    },
    [
      amountInput,
      category,
      currency,
      displayCurrency,
      holderId,
      holders,
      merchantKeyword,
      optimizeFor,
      purchaseDate,
      user?.role,
      validateAmount,
    ]
  )

  useEffect(() => {
    if (user?.id) {
      void runRecommend()
    }
    // 仅首载按默认参数算一次，避免输入时抖动请求
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id])

  const extraCount = useMemo(() => {
    if (!result) return 0
    return result.other_candidates.length + result.excluded_cards.length
  }, [result])

  const memberNoHolder = user?.role !== 'admin' && holders.length === 0

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-4 pb-24 pt-3 text-d-text sm:px-5'>
      {/* 顶栏 */}
      <div className='mb-3 flex items-center justify-between gap-2'>
        <div className='flex items-center gap-2.5'>
          <button
            type='button'
            onClick={() => router.back()}
            aria-label='返回'
            className='flex h-11 w-11 items-center justify-center rounded-xl border border-d-border bg-d-surface text-d-text'
          >
            <ChevronLeftIcon size={20} />
          </button>
          <div>
            <h1 className='text-[20px] font-bold leading-6 text-d-text'>消费前选卡助手</h1>
            <p className='text-[12px] text-d-muted'>
              按净返现、FTF 货转费、免息期与达标任务可解释推荐
            </p>
          </div>
        </div>
        <Link
          href='/cards/roi'
          className='flex min-h-[44px] items-center rounded-full border border-d-border bg-d-surface px-3 text-[12px] font-semibold text-d-accent-light'
        >
          年费 ROI ›
        </Link>
      </div>

      {/* 输入卡 */}
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void runRecommend()
        }}
        className='mb-4 rounded-2xl border border-d-border bg-d-surface p-4'
      >
        <div className='grid grid-cols-1 gap-3 sm:grid-cols-[1fr_132px]'>
          <TextField
            label='计划消费金额'
            type='number'
            inputMode='decimal'
            step='0.01'
            min='0.01'
            placeholder='例如：500'
            value={amountInput}
            onChange={(e) => {
              setAmountInput(e.target.value)
              if (validationError) setValidationError(null)
            }}
            error={Boolean(validationError)}
            helperText={validationError ?? undefined}
            startAdornment={<span className='font-semibold'>{currencySymbol(currency)}</span>}
          />
          <SelectField
            label='消费币种'
            value={currency}
            onChange={(e) => {
              setCurrencyTouched(true)
              setCurrency(e.target.value)
            }}
            options={ALL_CURRENCIES.map((code) => ({ value: code, label: code }))}
          />
        </div>

        {/* 币种快捷胶囊 */}
        <div className='mt-2.5 flex flex-wrap gap-1.5'>
          {QUICK_CURRENCIES.map((code) => {
            const active = currency === code
            return (
              <button
                key={code}
                type='button'
                onClick={() => {
                  setCurrencyTouched(true)
                  setCurrency(code)
                }}
                className={
                  'min-h-[36px] rounded-full px-3 text-[12px] font-semibold transition-colors ' +
                  (active
                    ? 'bg-d-accent text-white'
                    : 'border border-d-border bg-d-subtle text-d-muted')
                }
              >
                {code}
              </button>
            )
          })}
        </div>

        {/* 消费类目网格 */}
        <div className='mt-4'>
          <p className='mb-2 text-[13px] font-semibold text-d-muted'>消费类目（可选）</p>
          <div className='grid grid-cols-2 gap-1.5 sm:grid-cols-3'>
            <button
              type='button'
              onClick={() => setCategory(null)}
              className={
                'flex min-h-[44px] items-center justify-center rounded-xl border px-2.5 text-[13px] font-semibold transition-colors ' +
                (category === null
                  ? 'border-d-accent bg-d-accent/15 text-d-accent-light'
                  : 'border-d-border bg-d-subtle text-d-muted')
              }
            >
              不限 / 通用
            </button>
            {RECOMMENDATION_CATEGORIES.map((cat) => {
              const active = category === cat
              const meta = RECOMMENDATION_CATEGORY_META[cat]
              return (
                <button
                  key={cat}
                  type='button'
                  onClick={() => setCategory(cat)}
                  className={
                    'flex min-h-[44px] flex-col items-start justify-center rounded-xl border px-2.5 py-1.5 text-left transition-colors ' +
                    (active
                      ? 'border-d-accent bg-d-accent/15 text-d-accent-light'
                      : 'border-d-border bg-d-subtle text-d-text')
                  }
                >
                  <span className='text-[13px] font-semibold leading-4'>{meta.label}</span>
                  <span className='text-[10px] leading-3 text-d-muted'>{meta.hint}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* 高级条件折叠 */}
        <div className='mt-3 border-t border-d-border/60 pt-2.5'>
          <button
            type='button'
            onClick={() => setAdvancedOpen((v) => !v)}
            className='flex min-h-[44px] w-full items-center justify-between text-[13px] font-semibold text-d-muted'
          >
            <span>偏好模式 · 持卡人 · 商户与日期</span>
            <ChevronDownIcon
              size={16}
              className={'transition-transform ' + (advancedOpen ? 'rotate-180' : '')}
            />
          </button>

          {advancedOpen && (
            <div className='mt-2 flex flex-col gap-3'>
              <SelectField
                label='排序偏好'
                value={optimizeFor}
                onChange={(e) => setOptimizeFor(e.target.value as OptimizeForMode)}
                options={OPTIMIZE_FOR_OPTIONS.map((o) => ({
                  value: o.value,
                  label: `${o.label}（${o.desc}）`,
                }))}
              />

              <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
                <TextField
                  label='商户关键词（可选）'
                  maxLength={40}
                  placeholder='如：星巴克 / 万豪 / Amazon'
                  value={merchantKeyword}
                  onChange={(e) => setMerchantKeyword(e.target.value)}
                />
                <TextField
                  label='消费日期'
                  type='date'
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
              </div>

              {isAdmin ? (
                <SelectField
                  label='持卡人范围'
                  value={holderId}
                  onChange={(e) => setHolderId(e.target.value)}
                  options={[
                    { value: 'all', label: '全部家庭成员' },
                    ...holders.map((h) => ({ value: h.id, label: h.name })),
                  ]}
                />
              ) : holders.length > 0 ? (
                <p className='text-[12px] text-d-muted'>
                  当前仅推荐本人持卡人档案：{holders[0].name}
                </p>
              ) : null}
            </div>
          )}
        </div>

        {memberNoHolder && (
          <div className='mt-3'>
            <Alert severity='warning'>当前账号未绑定持卡人档案，请联系管理员绑定后再试。</Alert>
          </div>
        )}

        <Button type='submit' loading={loading} className='mt-3 w-full'>
          计算最优刷卡建议
        </Button>
      </form>

      {/* 错误 & 全局警示 */}
      {submitError && (
        <div className='mb-3'>
          <Alert
            severity='error'
            action={
              <button
                type='button'
                onClick={() => void runRecommend()}
                className='h-9 rounded-full bg-d-danger px-3 text-[12px] font-semibold text-white'
              >
                重试
              </button>
            }
          >
            {submitError}
          </Alert>
        </div>
      )}

      {loading && !result && (
        <div className='flex flex-col gap-3'>
          <Skeleton className='h-36 w-full rounded-2xl' />
          <Skeleton className='h-36 w-full rounded-2xl' />
        </div>
      )}

      {result && (
        <div className='flex flex-col gap-3'>
          {result.all_cards_unconfigured && (
            <Alert severity='info'>
              名下卡片暂未配置结构化返现规则，当前优先按本币、最长免息期与待完成任务推荐。
            </Alert>
          )}

          {!result.fx_available && (
            <Alert severity='warning'>
              部分币种汇率暂不可用，跨币种卡额度校验与折算净收益已暂停，仅按原规则试算。
            </Alert>
          )}

          {result.banner_warnings.map((w, idx) => (
            <Alert key={idx} severity='warning'>
              {w}
            </Alert>
          ))}

          {/* 空态 */}
          {result.top_recommendations.length === 0 && (
            <div className='rounded-2xl border border-dashed border-d-border bg-d-surface p-6 text-center'>
              <p className='text-[15px] font-semibold text-d-text'>
                {result.empty_reason === 'no_credit_cards'
                  ? '当前名下暂无可用信用卡'
                  : result.empty_reason === 'all_frozen_or_cancelled'
                    ? '全部信用卡均已冻结或注销'
                    : `暂无可用额度覆盖 ${formatCurrencyAmount(
                        validateAmount(amountInput) ?? 0,
                        currency
                      )} 的卡片`}
              </p>
              <p className='mt-1 text-[12px] text-d-muted'>
                可展开下方「不可用原因」查看各卡剩余额度与状态，或前往账户页管理卡片。
              </p>
              <Link
                href='/accounts'
                className='mt-3 inline-flex h-11 items-center rounded-xl bg-d-accent px-4 text-[13px] font-semibold text-white'
              >
                前往账户页
              </Link>
            </div>
          )}

          {/* Top 3 推荐卡片 */}
          {result.top_recommendations.map((item) => (
            <RecommendationCard
              key={item.card_id}
              item={item}
              purchaseCurrency={currency}
              displayCurrency={displayCurrency}
              isAdmin={isAdmin}
              defaultExpanded={item.rank === 1}
            />
          ))}

          {/* 其他候选与拦截原因 */}
          {extraCount > 0 && (
            <div className='rounded-2xl border border-d-border bg-d-surface p-3.5'>
              <button
                type='button'
                onClick={() => setOthersExpanded((v) => !v)}
                aria-expanded={othersExpanded}
                className='flex min-h-[44px] w-full items-center justify-between text-[13px] font-semibold text-d-text'
              >
                <span>查看全部候选与不推荐原因（{extraCount} 张）</span>
                <ChevronDownIcon
                  size={16}
                  className={'transition-transform ' + (othersExpanded ? 'rotate-180' : '')}
                />
              </button>

              {othersExpanded && (
                <div className='mt-3 flex flex-col gap-3'>
                  {result.other_candidates.map((item) => (
                    <RecommendationCard
                      key={item.card_id}
                      item={item}
                      purchaseCurrency={currency}
                      displayCurrency={displayCurrency}
                      isAdmin={isAdmin}
                      defaultExpanded={false}
                    />
                  ))}

                  {result.excluded_cards.length > 0 && (
                    <div className='flex flex-col gap-2 border-t border-d-border pt-3'>
                      <p className='text-[12px] font-semibold text-d-muted'>不可用 / 被拦截卡片</p>
                      {result.excluded_cards.map((ex) => (
                        <div
                          key={ex.card_id}
                          className='flex items-start justify-between gap-3 rounded-xl bg-d-subtle px-3 py-2.5 text-[12px]'
                        >
                          <div className='min-w-0 flex-1'>
                            <p className='font-semibold text-d-text'>
                              {ex.bank_name} · {ex.card_name}
                              {formatCardTail(ex.card_number_last4)
                                ? ` (${formatCardTail(ex.card_number_last4)})`
                                : ''}
                            </p>
                            <p className='mt-0.5 text-d-danger-ink'>{ex.reason}</p>
                          </div>
                          <span className='shrink-0 rounded-full bg-d-danger-soft px-2 py-0.5 text-[10px] font-semibold text-d-danger-ink'>
                            {ex.exclude_code === 'card_frozen'
                              ? '已冻结'
                              : ex.exclude_code === 'card_cancelled'
                                ? '已注销'
                                : '额度不足'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
