import {
  describeAnnualFeeWaiverGap,
  resolveAnnualFeeCycleState,
  type AnnualFeeCard,
  type AnnualFeeCycleState,
  type AnnualFeeProduct,
} from './annual-fee-cycle'
import { fetchRates, normalizeCurrencyOrDefault, sumByCurrency } from './fx'
import type { DailyNotificationCandidate } from './notifications-engine.server'
import { formatMoneySingle, type NotificationMetadata } from './notifications.shared'
import { addDays, isValidCivilDate } from './opportunities/dates'
import { getEffectiveCardName } from './utils'

interface FeeCardRow extends AnnualFeeCard {
  id: string
  holder_id: string
  bank_name: string
  card_name: string
  name_override: string | null
  card_number_last4: string | null
  currency: string
  annual_fee: number | null
  product_cycle_type: AnnualFeeProduct['annual_fee_cycle_type']
  annual_fee_waiver_rules_json: string | null
  waiver_progress_json: string | null
  actual_fee_paid: number | null
  manual_reward_value: number | null
}

interface DueCard {
  card: FeeCardRow
  cycle: AnnualFeeCycleState & { nextDueDate: string; cycleStartOn: string }
  days: number
  currency: string
}

interface BenefitValue {
  card_id: string
  amount: number
  currency: string
  unvalued: number
}

const readyDatabases = new WeakSet<D1Database>()
const REMINDER_DAYS = [30, 7, 1, 0]
const BATCH_SIZE = 80

async function loadDueCards(db: D1Database, userId: string, today: string): Promise<DueCard[]> {
  // Allow old databases to keep serving their existing daily notifications during rollout.
  if (!readyDatabases.has(db)) {
    const column = await db.prepare(
      "SELECT name FROM pragma_table_info('credit_cards') WHERE name = 'next_annual_fee_date'"
    ).first()
    if (!column) return []
    readyDatabases.add(db)
  }

  const user = await db.prepare('SELECT role FROM users WHERE id = ?').bind(userId).first<{ role: string }>()
  if (user?.role !== 'admin' && user?.role !== 'member') return []
  const scope = user.role === 'admin'
    ? '(ch.created_by = ?1 OR ch.managed_by = ?1)'
    : 'ch.auth_user_id = ?1'
  const { results } = await db.prepare(
    `SELECT cc.id, cc.holder_id, cc.name_override, cc.card_number_last4,
            cc.annual_fee_cycle_type, cc.annual_fee_status, cc.next_annual_fee_date,
            cc.annual_fee_override, cc.issued_on, cc.activated_on, cc.waiver_progress_json,
            cc.actual_fee_paid, cc.manual_reward_value, cp.bank_name, cp.card_name, cp.currency,
            cp.annual_fee, cp.annual_fee_cycle_type AS product_cycle_type,
            cp.annual_fee_waiver_rules_json
     FROM card_holders ch
     JOIN credit_cards cc ON cc.holder_id = ch.id
     JOIN card_products cp ON cp.id = cc.card_product_id
     WHERE ${scope}
       AND cc.status = 'active' AND COALESCE(cc.card_type, 'credit') = 'credit'
       AND COALESCE(cc.annual_fee_override, cp.annual_fee, 0) > 0
       AND COALESCE(cc.annual_fee_status, 'in_progress') NOT IN ('waived', 'paid', 'not_applicable')
       AND (cc.next_annual_fee_date IS NOT NULL OR cc.issued_on IS NOT NULL OR cc.activated_on IS NOT NULL)
     ORDER BY cc.id`
  ).bind(userId).all<FeeCardRow>()

  const reminderDates = new Map(REMINDER_DAYS.map(days => [addDays(today, days), days]))
  const due: DueCard[] = []
  for (const card of results) {
    const cycle = resolveAnnualFeeCycleState(card, {
      annual_fee: card.annual_fee,
      annual_fee_cycle_type: card.product_cycle_type,
    }, today)
    if (!cycle?.nextDueDate || !cycle.cycleStartOn || !Number.isFinite(cycle.nominalFee)) continue
    const days = reminderDates.get(cycle.nextDueDate)
    if (days !== undefined) {
      due.push({
        card,
        cycle: { ...cycle, nextDueDate: cycle.nextDueDate, cycleStartOn: cycle.cycleStartOn },
        days,
        currency: normalizeCurrencyOrDefault(card.currency, 'CNY'),
      })
    }
  }
  return due
}

// Each scoped card keeps its own cycle bounds. Aggregate by original currency in
// SQL so the worker does not transfer a year of individual usage records.
const ROI_VALUES_SQL = `
  WITH windows AS (
    SELECT json_extract(value, '$.id') AS card_id,
           json_extract(value, '$.holder') AS holder_id,
           json_extract(value, '$.start') AS start_on,
           json_extract(value, '$.end') AS end_before,
           json_extract(value, '$.currency') AS currency
    FROM json_each(?)
  ), amounts AS (
    SELECT w.card_id,
           CASE
             WHEN u.amount_minor > 0 THEN u.amount_minor
             ELSE u.quantity * COALESCE(a.estimated_unit_value_minor, d.estimated_unit_value_minor, 0)
           END / 100.0 AS amount,
           COALESCE(CASE
             WHEN u.amount_minor > 0 THEN cy.currency
             WHEN a.estimated_unit_value_minor IS NOT NULL THEN a.estimated_value_currency
             ELSE d.estimated_value_currency
           END, w.currency) AS currency,
           CASE WHEN d.kind = 'benefit' AND u.amount_minor = 0
                     AND COALESCE(a.estimated_unit_value_minor, d.estimated_unit_value_minor, 0) = 0
                THEN u.quantity ELSE 0 END AS unvalued
    FROM windows w
    JOIN opportunity_usages u ON u.card_id = w.card_id
      AND u.status = 'active' AND u.used_on >= w.start_on AND u.used_on < w.end_before
    JOIN opportunity_cycles cy ON cy.id = u.cycle_id
    JOIN opportunity_accounts a ON a.id = u.account_id AND a.holder_id = w.holder_id
    JOIN opportunity_definitions d ON d.id = a.definition_id
    WHERE d.kind IN ('benefit', 'promo', 'private_reward')

    UNION ALL

    SELECT w.card_id, p.cashback_amount, COALESCE(p.cashback_currency, w.currency), 0
    FROM windows w
    JOIN promo_usages p ON p.card_id = w.card_id
      AND p.used_at >= w.start_on AND p.used_at < w.end_before
    WHERE p.cashback_amount > 0 AND NOT EXISTS (
      SELECT 1 FROM opportunity_legacy_links ll
      WHERE ll.source_table = 'promo_usages' AND ll.source_id = p.id
    )

    UNION ALL

    SELECT w.card_id,
           COALESCE(NULLIF(f.amount_minor, 0),
                    json_extract(tc.reward_snapshot_json, '$.reward.amount_minor'),
                    json_extract(tc.reward_snapshot_json, '$.amount_minor'), 0) / 100.0,
           COALESCE(json_extract(tc.reward_snapshot_json, '$.reward.currency'),
                    json_extract(tc.reward_snapshot_json, '$.currency'),
                    json_extract(tc.rules_snapshot_json, '$.currency'), w.currency), 0
    FROM windows w
    JOIN opportunity_fulfillments f ON f.holder_id = w.holder_id
      AND f.kind = 'task_result' AND f.status != 'cancelled'
      AND f.recorded_on >= w.start_on AND f.recorded_on < w.end_before
    JOIN opportunity_task_cycles tc ON tc.id = f.task_cycle_id
    JOIN opportunity_tasks t ON t.id = tc.task_id
    WHERE f.card_id = w.card_id OR (
      f.card_id IS NULL AND json_array_length(t.card_ids_json) = 1
      AND json_extract(t.card_ids_json, '$[0]') = w.card_id
    )
  )
  SELECT card_id, SUM(amount) AS amount, currency, SUM(unvalued) AS unvalued
  FROM amounts GROUP BY card_id, currency`

async function loadBenefitValues(db: D1Database, due: DueCard[], today: string) {
  const tomorrow = addDays(today, 1)
  const windows = due.map(({ card, cycle, currency }) => ({
    id: card.id,
    holder: card.holder_id,
    start: cycle.cycleStartOn,
    end: cycle.nextDueDate < tomorrow ? cycle.nextDueDate : tomorrow,
    currency,
  }))
  const statements: D1PreparedStatement[] = []
  for (let i = 0; i < windows.length; i += BATCH_SIZE) {
    statements.push(db.prepare(ROI_VALUES_SQL).bind(JSON.stringify(windows.slice(i, i + BATCH_SIZE))))
  }

  const valuesByCard = new Map<string, BenefitValue[]>()
  for (const result of await db.batch<BenefitValue>(statements)) {
    for (const value of result.results) {
      const values = valuesByCard.get(value.card_id)
      if (values) values.push(value)
      else valuesByCard.set(value.card_id, [value])
    }
  }
  return valuesByCard
}

export async function buildAnnualFeeDecisionCandidates(
  db: D1Database,
  userId: string,
  effectiveToday: string,
): Promise<DailyNotificationCandidate[]> {
  if (!isValidCivilDate(effectiveToday)) return []
  const hits = await loadDueCards(db, userId, effectiveToday)
  if (!hits.length) return []
  const valuesByCard = await loadBenefitValues(db, hits, effectiveToday)
  const needsRates = hits.some(({ card, currency }) => valuesByCard.get(card.id)?.some(
    value => value.amount > 0 && normalizeCurrencyOrDefault(value.currency, currency) !== currency
  ))
  const rates = needsRates ? await fetchRates() : null

  return hits.map(({ card, cycle, days, currency }) => {
    const { nextDueDate, nominalFee } = cycle
    const gap = describeAnnualFeeWaiverGap(
      card.annual_fee_waiver_rules_json, card.waiver_progress_json, cycle, currency, effectiveToday
    )
    const label = [card.bank_name, getEffectiveCardName(card, card), card.card_number_last4].filter(Boolean).join(' ')
    const values = valuesByCard.get(card.id) ?? []
    const converted = sumByCurrency(values, value => value, currency, rates)
    const recordedValue = converted.total + (card.manual_reward_value ?? 0)
    const unvalued = values.reduce((total, value) => total + value.unvalued, 0)
    const cost = card.actual_fee_paid ?? nominalFee
    const money = (amount: number) => formatMoneySingle(amount, currency)

    let detail = '点击核对本周期权益与返现，评估是否续卡。'
    let roiNetValue: number | undefined
    if (converted.unconverted_currencies.length) {
      detail = `已折算权益与返现 ${money(recordedValue)}，${converted.unconverted_currencies.join('、')} 暂无汇率。${detail}`
    } else if (unvalued > 0) {
      detail = `已估值权益与返现 ${money(recordedValue)}，另有 ${unvalued} 次权益待估值。${detail}`
    } else if (recordedValue > 0) {
      roiNetValue = Math.round((recordedValue - cost) * 100) / 100
      const net = `${roiNetValue >= 0 ? '+' : '-'}${money(Math.abs(roiNetValue))}`
      const percent = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 1, signDisplay: 'exceptZero' })
      const roi = cost > 0 ? `，ROI ${percent.format((roiNetValue / cost) * 100)}%` : ''
      const decision = roiNetValue >= 0 ? '可核对免年费进度后考虑续卡。' : '可在扣费前咨询免除年费、降级或销卡。'
      detail = `本周期已记录权益与返现 ${money(recordedValue)}（净收益 ${net}${roi}）。${decision}`
    }

    const metadata: NotificationMetadata = {
      kind: 'annual_fee_decision',
      card_id: card.id,
      due_date: nextDueDate,
      days_until_due: days,
      currency,
      annual_fee: nominalFee,
      annual_fee_status: cycle.status,
      roi_net_value: roiNetValue,
      waiver_gap_text: gap,
    }
    return {
      notification_key: `annual_fee_decision:${card.id}:${nextDueDate}:${days}`,
      category: 'annual_fee_decision',
      title: `年费提醒（${days === 0 ? '今日扣费' : `剩 ${days} 天`}）：${label}`,
      body: `预计于 ${nextDueDate} 收取年费 ${money(nominalFee)}${gap ? `（${gap}）` : ''}。${detail}`,
      target_url: `/cards/${encodeURIComponent(card.id)}?section=roi`,
      metadata_json: JSON.stringify(metadata),
    }
  })
}
