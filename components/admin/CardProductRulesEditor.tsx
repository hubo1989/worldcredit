'use client'

import { useMemo, useState } from 'react'
import { AiSparkleIcon, PlusIcon, TrashIcon } from '@/components/icons/WcIcon'
import { Button, CheckRow } from '@/components/obsidian/controls'
import { SelectField, TextField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import {
  parseAnnualFeeWaiverRules,
  parseFxFreeCurrencies,
  parseRewardRules,
} from '@/lib/recommendations-ui/helpers'
import { previewCardProductRules } from '@/lib/recommendations-ui/rpc'
import {
  ANNUAL_FEE_CYCLE_LABELS,
  ANNUAL_FEE_WAIVER_TYPE_LABELS,
  RECOMMENDATION_CATEGORIES,
  RECOMMENDATION_CATEGORY_META,
  type AnnualFeeCycleType,
  type AnnualFeeWaiverRuleV1,
  type AnnualFeeWaiverType,
  type CardProductStructuredRulesDraft,
  type CategoryRewardRuleV1,
  type ExtendedCardProductPatch,
  type RecommendationCategory,
  type RewardRulesV1,
} from '@/lib/recommendations-ui/types'

const COMMON_FX_CURRENCIES = ['USD', 'HKD', 'CNY', 'JPY', 'EUR', 'GBP']

interface Props {
  product: ExtendedCardProductPatch
  onChange: (next: ExtendedCardProductPatch) => void
}

export function CardProductRulesEditor({ product, onChange }: Props) {
  const currency = product.currency || 'CNY'
  const ftfValue =
    product.ftf_rate !== null && product.ftf_rate !== undefined ? String(product.ftf_rate) : ''
  const fxFreeCurrencies = useMemo(
    () => parseFxFreeCurrencies(product.fx_free_currencies_json),
    [product.fx_free_currencies_json]
  )
  const parsedRewardRules = useMemo(
    () => parseRewardRules(product.reward_rules_json),
    [product.reward_rules_json]
  )
  const rewardRules: RewardRulesV1 = parsedRewardRules ?? {
    schema_version: 1,
    reward_kind: 'cashback',
    point_unit_name: null,
    point_value_per_unit: null,
    base_rate_pct: 0,
    base_raw_label: null,
    category_rules: [],
    notes: null,
  }
  const hasRewardRules = parsedRewardRules !== null
  const parsedWaiverRules = useMemo(
    () => parseAnnualFeeWaiverRules(product.annual_fee_waiver_rules_json),
    [product.annual_fee_waiver_rules_json]
  )
  const waiverRules: AnnualFeeWaiverRuleV1 = parsedWaiverRules ?? {
    schema_version: 1,
    waiver_type: 'none',
    first_year_free: false,
    target_amount: null,
    target_currency: currency,
    target_count: null,
    per_txn_min_amount: null,
    points_cost: null,
    notes: null,
  }
  const hasWaiverRules = parsedWaiverRules !== null

  const [customFxInput, setCustomFxInput] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiDraft, setAiDraft] = useState<CardProductStructuredRulesDraft | null>(null)

  const patchRewardRules = (updater: (prev: RewardRulesV1) => RewardRulesV1) => {
    const next = updater(rewardRules)
    onChange({
      ...product,
      reward_rules_json: JSON.stringify(next),
    })
  }

  const patchWaiverRules = (updater: (prev: AnnualFeeWaiverRuleV1) => AnnualFeeWaiverRuleV1) => {
    const next = updater(waiverRules)
    onChange({
      ...product,
      annual_fee_waiver_rules_json: JSON.stringify(next),
    })
  }

  const toggleFxFreeCurrency = (code: string) => {
    const upper = code.trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(upper)) return
    const exists = fxFreeCurrencies.includes(upper)
    const next = exists
      ? fxFreeCurrencies.filter((c) => c !== upper)
      : [...fxFreeCurrencies, upper]
    onChange({
      ...product,
      fx_free_currencies_json: next.length > 0 ? JSON.stringify(next) : null,
    })
  }

  const handlePreviewAiDraft = async () => {
    if (!product.bank_name || !product.card_name) {
      setAiError('请先填写银行名称与卡片全称，再生成规则草稿')
      return
    }
    setAiLoading(true)
    setAiError(null)
    try {
      const draft = await previewCardProductRules({
        bank_name: product.bank_name,
        card_name: product.card_name,
        country: product.country,
        currency: product.currency,
        rewards_summary: product.rewards_summary,
        annual_fee_waiver: product.annual_fee_waiver,
      })
      setAiDraft(draft)
    } catch (err) {
      setAiError(err instanceof Error ? err.message : '生成结构化规则草稿失败')
    } finally {
      setAiLoading(false)
    }
  }

  const applyAiDraft = () => {
    if (!aiDraft) return
    onChange({
      ...product,
      ftf_rate: aiDraft.ftf_rate ?? product.ftf_rate,
      fx_free_currencies_json:
        aiDraft.fx_free_currencies.length > 0
          ? JSON.stringify(aiDraft.fx_free_currencies)
          : product.fx_free_currencies_json,
      reward_rules_json: aiDraft.reward_rules
        ? JSON.stringify(aiDraft.reward_rules)
        : product.reward_rules_json,
      annual_fee_cycle_type: aiDraft.annual_fee_cycle_type ?? product.annual_fee_cycle_type,
      annual_fee_waiver_rules_json: aiDraft.annual_fee_waiver_rules
        ? JSON.stringify(aiDraft.annual_fee_waiver_rules)
        : product.annual_fee_waiver_rules_json,
    })
    setAiDraft(null)
  }

  const addCategoryRule = () => {
    const newRule: CategoryRewardRuleV1 = {
      category: 'dining',
      rate_pct: 3,
      raw_label: '',
      currency_scope: 'all',
    }
    patchRewardRules((prev) => ({
      ...prev,
      category_rules: [...prev.category_rules, newRule],
    }))
  }

  const updateCategoryRule = (idx: number, patch: Partial<CategoryRewardRuleV1>) => {
    patchRewardRules((prev) => ({
      ...prev,
      category_rules: prev.category_rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)),
    }))
  }

  const removeCategoryRule = (idx: number) => {
    patchRewardRules((prev) => ({
      ...prev,
      category_rules: prev.category_rules.filter((_, i) => i !== idx),
    }))
  }

  return (
    <div className='flex flex-col gap-4 rounded-2xl border border-d-border bg-d-subtle/40 p-4'>
      <div className='flex flex-wrap items-center justify-between gap-2'>
        <div>
          <p className='text-[14px] font-bold text-d-text'>结构化选卡与年费规则</p>
          <p className='text-[12px] text-d-muted'>
            供消费前推荐引擎与年费提醒读取；保存后立即生效并保留人工编辑优先级
          </p>
        </div>
        <Button
          type='button'
          size='sm'
          variant='secondary'
          loading={aiLoading}
          onClick={handlePreviewAiDraft}
        >
          <AiSparkleIcon size={14} />
          AI 生成规则草稿
        </Button>
      </div>

      {aiError && <Alert severity='error'>{aiError}</Alert>}

      {aiDraft && (
        <div className='rounded-xl border border-d-gold/50 bg-d-surface p-3'>
          <div className='flex items-center justify-between gap-2'>
            <p className='text-[13px] font-bold text-d-gold'>AI 规则预览草稿（尚未写库）</p>
            <div className='flex gap-2'>
              <Button type='button' size='sm' variant='ghost' onClick={() => setAiDraft(null)}>
                放弃
              </Button>
              <Button type='button' size='sm' onClick={applyAiDraft}>
                应用到表单
              </Button>
            </div>
          </div>
          <div className='mt-2 space-y-1 text-[12px] text-d-muted'>
            <p>
              FTF：{aiDraft.ftf_rate !== null ? `${aiDraft.ftf_rate}%` : '未指定'} · 免货转币种：
              {aiDraft.fx_free_currencies.join('、') || '无'}
            </p>
            <p>
              基础返现：
              {aiDraft.reward_rules ? `${aiDraft.reward_rules.base_rate_pct}%` : '无'} ·
              专享类目：{aiDraft.reward_rules?.category_rules.length ?? 0} 条
            </p>
            <p>
              年费周期：
              {aiDraft.annual_fee_cycle_type
                ? ANNUAL_FEE_CYCLE_LABELS[aiDraft.annual_fee_cycle_type]
                : '未指定'}
            </p>
            {(aiDraft.notes || aiDraft.confidence_note) && (
              <p className='text-d-warn-ink'>
                {aiDraft.provenance === 'official'
                  ? '官网依据：'
                  : aiDraft.provenance === 'model'
                    ? '模型参考：'
                    : '说明：'}
                {aiDraft.notes || aiDraft.confidence_note}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 1. FTF 与免货转币种 */}
      <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
        <TextField
          label='外币交易手续费 FTF (%)'
          type='number'
          inputMode='decimal'
          min='0'
          max='10'
          step='0.01'
          placeholder='例如：0 或 1.5（留空表示未配置）'
          value={ftfValue}
          onChange={(e) => {
            const raw = e.target.value.trim()
            onChange({
              ...product,
              ftf_rate: raw === '' ? null : Number(raw),
            })
          }}
          endAdornment={<span>%</span>}
        />

        <div>
          <p className='mb-1.5 text-[13px] font-semibold text-d-muted'>免货转币种（可选）</p>
          <div className='flex flex-wrap gap-1.5'>
            {COMMON_FX_CURRENCIES.map((code) => {
              const active = fxFreeCurrencies.includes(code)
              return (
                <button
                  key={code}
                  type='button'
                  onClick={() => toggleFxFreeCurrency(code)}
                  className={
                    'min-h-[36px] rounded-full px-2.5 text-[12px] font-semibold ' +
                    (active
                      ? 'bg-d-accent text-white'
                      : 'border border-d-border bg-d-surface text-d-muted')
                  }
                >
                  {code}
                </button>
              )
            })}
          </div>
          <div className='mt-2 flex gap-2'>
            <TextField
              placeholder='自定义 3 位币种如 SGD'
              value={customFxInput}
              onChange={(e) => setCustomFxInput(e.target.value.toUpperCase())}
              maxLength={3}
            />
            <Button
              type='button'
              variant='secondary'
              onClick={() => {
                if (/^[A-Z]{3}$/.test(customFxInput.trim())) {
                  if (!fxFreeCurrencies.includes(customFxInput.trim())) {
                    toggleFxFreeCurrency(customFxInput.trim())
                  }
                  setCustomFxInput('')
                }
              }}
            >
              添加
            </Button>
          </div>
        </div>
      </div>

      {/* 2. 结构化回报规则 */}
      <div className='rounded-xl border border-d-border bg-d-surface p-3'>
        <div className='mb-3 flex items-center justify-between gap-2'>
          <div>
            <p className='text-[13px] font-semibold text-d-text'>
              分类返现 / 积分倍率 {hasRewardRules ? '' : '（未配置）'}
            </p>
          </div>
          {hasRewardRules && (
            <button
              type='button'
              onClick={() => onChange({ ...product, reward_rules_json: null })}
              className='text-[12px] font-semibold text-d-danger-ink'
            >
              清空结构化回报
            </button>
          )}
        </div>

        <div className='grid grid-cols-1 gap-3 sm:grid-cols-3'>
          <SelectField
            label='回报类型'
            value={rewardRules.reward_kind}
            onChange={(e) =>
              patchRewardRules((prev) => ({
                ...prev,
                reward_kind: e.target.value as RewardRulesV1['reward_kind'],
              }))
            }
            options={[
              { value: 'cashback', label: '直接返现 (Cashback)' },
              { value: 'points', label: '积分折算 (Points)' },
              { value: 'miles', label: '航空里程 (Miles)' },
            ]}
          />

          <TextField
            label='基础等效返现率 (%)'
            type='number'
            inputMode='decimal'
            min='0'
            step='0.01'
            value={String(rewardRules.base_rate_pct)}
            onChange={(e) =>
              patchRewardRules((prev) => ({
                ...prev,
                base_rate_pct: Math.max(0, Number(e.target.value || 0)),
              }))
            }
            endAdornment={<span>%</span>}
          />

          <TextField
            label='积分/里程名称（选填）'
            placeholder='如：UR 积分 / 招行积分'
            value={rewardRules.point_unit_name ?? ''}
            onChange={(e) =>
              patchRewardRules((prev) => ({
                ...prev,
                point_unit_name: e.target.value || null,
              }))
            }
          />
        </div>

        <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <TextField
            label={`单分/里程估值（${currency}，选填）`}
            type='number'
            inputMode='decimal'
            min='0'
            step='0.001'
            placeholder='如：0.015'
            value={
              rewardRules.point_value_per_unit != null
                ? String(rewardRules.point_value_per_unit)
                : ''
            }
            onChange={(e) =>
              patchRewardRules((prev) => ({
                ...prev,
                point_value_per_unit: e.target.value === '' ? null : Number(e.target.value),
              }))
            }
          />
          <TextField
            label='基础回报说明（选填）'
            placeholder='如：日常消费 1.5% 无上限返现'
            value={rewardRules.base_raw_label ?? ''}
            onChange={(e) =>
              patchRewardRules((prev) => ({
                ...prev,
                base_raw_label: e.target.value || null,
              }))
            }
          />
        </div>

        {/* 动态分类倍率行 */}
        <div className='mt-3 border-t border-d-border/60 pt-3'>
          <div className='mb-2 flex items-center justify-between'>
            <p className='text-[12px] font-semibold text-d-muted'>
              专享消费类目倍率（{rewardRules.category_rules.length} 条）
            </p>
            <Button type='button' size='sm' variant='secondary' onClick={addCategoryRule}>
              <PlusIcon size={14} />
              添加类目规则
            </Button>
          </div>

          <div className='flex flex-col gap-2'>
            {rewardRules.category_rules.map((rule, idx) => (
              <div
                key={idx}
                className='rounded-xl border border-d-border bg-d-subtle/60 p-2.5'
              >
                <div className='grid grid-cols-1 gap-2 sm:grid-cols-4'>
                  <SelectField
                    label='消费类目'
                    value={rule.category}
                    onChange={(e) =>
                      updateCategoryRule(idx, {
                        category: e.target.value as RecommendationCategory,
                      })
                    }
                    options={RECOMMENDATION_CATEGORIES.map((c) => ({
                      value: c,
                      label: RECOMMENDATION_CATEGORY_META[c].label,
                    }))}
                  />
                  <TextField
                    label='等效返现率 (%)'
                    type='number'
                    inputMode='decimal'
                    min='0'
                    step='0.01'
                    value={String(rule.rate_pct)}
                    onChange={(e) =>
                      updateCategoryRule(idx, { rate_pct: Math.max(0, Number(e.target.value || 0)) })
                    }
                    endAdornment={<span>%</span>}
                  />
                  <SelectField
                    label='币种适用范围'
                    value={
                      typeof rule.currency_scope === 'string' ? rule.currency_scope : 'all'
                    }
                    onChange={(e) =>
                      updateCategoryRule(idx, {
                        currency_scope: e.target.value as 'all' | 'domestic' | 'foreign',
                      })
                    }
                    options={[
                      { value: 'all', label: '全部币种' },
                      { value: 'domestic', label: '仅本币消费' },
                      { value: 'foreign', label: '仅外币/境外' },
                    ]}
                  />
                  <div className='flex items-end gap-2'>
                    <TextField
                      label={`月上限 (${currency})`}
                      type='number'
                      inputMode='decimal'
                      min='0'
                      placeholder='不限'
                      value={rule.monthly_cap_amount != null ? String(rule.monthly_cap_amount) : ''}
                      onChange={(e) =>
                        updateCategoryRule(idx, {
                          monthly_cap_amount: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                    <button
                      type='button'
                      aria-label='删除规则'
                      onClick={() => removeCategoryRule(idx)}
                      className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-d-border bg-d-surface text-d-danger-ink'
                    >
                      <TrashIcon size={16} />
                    </button>
                  </div>
                </div>
                <div className='mt-2'>
                  <TextField
                    label='规则说明'
                    placeholder='如：餐饮 3X UR 积分（约 4.5%）'
                    value={rule.raw_label ?? ''}
                    onChange={(e) =>
                      updateCategoryRule(idx, { raw_label: e.target.value || null })
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 3. 年费周期与免年费门槛模板 */}
      <div className='rounded-xl border border-d-border bg-d-surface p-3'>
        <div className='mb-3 flex items-center justify-between gap-2'>
          <p className='text-[13px] font-semibold text-d-text'>
            年费周期与免年费模板 {hasWaiverRules ? '' : '（未配置）'}
          </p>
          {hasWaiverRules && (
            <button
              type='button'
              onClick={() => onChange({ ...product, annual_fee_waiver_rules_json: null })}
              className='text-[12px] font-semibold text-d-danger-ink'
            >
              清空免年费模板
            </button>
          )}
        </div>

        <div className='grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <SelectField
            label='默认年费周期类型'
            value={product.annual_fee_cycle_type ?? ''}
            onChange={(e) =>
              onChange({
                ...product,
                annual_fee_cycle_type: (e.target.value || null) as AnnualFeeCycleType | null,
              })
            }
            options={[
              { value: '', label: '未指定' },
              ...(Object.keys(ANNUAL_FEE_CYCLE_LABELS) as AnnualFeeCycleType[]).map((k) => ({
                value: k,
                label: ANNUAL_FEE_CYCLE_LABELS[k],
              })),
            ]}
          />
          <SelectField
            label='免年费条件类型'
            value={waiverRules.waiver_type}
            onChange={(e) =>
              patchWaiverRules((prev) => ({
                ...prev,
                waiver_type: e.target.value as AnnualFeeWaiverType,
              }))
            }
            options={(Object.keys(ANNUAL_FEE_WAIVER_TYPE_LABELS) as AnnualFeeWaiverType[]).map(
              (k) => ({
                value: k,
                label: ANNUAL_FEE_WAIVER_TYPE_LABELS[k],
              })
            )}
          />
        </div>

        <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3'>
          <TextField
            label={`达标消费金额（${currency}）`}
            type='number'
            inputMode='decimal'
            min='0'
            placeholder='选填'
            value={waiverRules.target_amount != null ? String(waiverRules.target_amount) : ''}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                patchWaiverRules((prev) => ({
                  ...prev,
                  target_amount: null,
                  target_currency: currency,
                }))
                return
              }
              const parsed = Number(raw)
              if (!Number.isFinite(parsed) || parsed < 0) return
              patchWaiverRules((prev) => ({
                ...prev,
                target_amount: parsed,
                target_currency: currency,
              }))
            }}
          />
          <TextField
            label='达标消费笔数'
            type='number'
            inputMode='numeric'
            min='0'
            placeholder='选填'
            value={waiverRules.target_count != null ? String(waiverRules.target_count) : ''}
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                patchWaiverRules((prev) => ({ ...prev, target_count: null }))
                return
              }
              const parsed = Number(raw)
              if (!Number.isFinite(parsed) || parsed < 0) return
              patchWaiverRules((prev) => ({ ...prev, target_count: Math.trunc(parsed) }))
            }}
          />
          <TextField
            label={`单笔最低门槛（${currency}）`}
            type='number'
            inputMode='decimal'
            min='0'
            placeholder='选填'
            value={
              waiverRules.per_txn_min_amount != null ? String(waiverRules.per_txn_min_amount) : ''
            }
            onChange={(e) => {
              const raw = e.target.value
              if (raw === '') {
                patchWaiverRules((prev) => ({ ...prev, per_txn_min_amount: null }))
                return
              }
              const parsed = Number(raw)
              if (!Number.isFinite(parsed) || parsed < 0) return
              patchWaiverRules((prev) => ({ ...prev, per_txn_min_amount: parsed }))
            }}
          />
        </div>

        <div className='mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2'>
          <CheckRow
            checked={Boolean(waiverRules.first_year_free)}
            onChange={(checked) =>
              patchWaiverRules((prev) => ({ ...prev, first_year_free: checked }))
            }
          >
            首年免年费
          </CheckRow>
          <TextField
            label='抵扣所需积分（选填）'
            type='number'
            inputMode='numeric'
            min='0'
            placeholder='如：10000'
            value={waiverRules.points_cost != null ? String(waiverRules.points_cost) : ''}
            onChange={(e) =>
              patchWaiverRules((prev) => ({
                ...prev,
                points_cost: e.target.value === '' ? null : Math.trunc(Number(e.target.value)),
              }))
            }
          />
        </div>
      </div>
    </div>
  )
}
