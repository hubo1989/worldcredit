import type { AnalyticsFilters } from '@/lib/api/analytics.server'
import { RpcError } from '@/lib/api/rpc-client'
import type {
  BillItem,
  BillItemInput,
  BillItemType,
  CashflowForecastResult,
  CashflowHorizonDays,
  CategoryBreakdownItem,
  CategoryBreakdownNormalized,
  CategoryDrilldownItem,
  CreateInstallmentInput,
  FamilyExportRequest,
  FamilyStatementReport,
  InstallmentPlanWithSummary,
  MerchantCategoryRule,
  PaymentFxLockFields,
  SpendCategory,
  StatementReportRequest,
  UpdateInstallmentPatch,
} from './types'
import type { CsvRow } from '@/lib/export'

async function postRpc<T>(module: string, fn: string, ...args: unknown[]): Promise<T> {
  const res = await fetch(`/api/rpc/${module}/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args }),
    credentials: 'same-origin',
  })
  const payload = (await res.json().catch(() => null)) as {
    data?: unknown
    error?: string
    code?: string
    details?: unknown
    request_id?: string
  } | null

  if (!res.ok || !payload || payload.error) {
    const message = payload?.error || `RPC ${module}.${fn} failed (${res.status})`
    if (payload?.code || payload?.details || payload?.request_id) {
      throw new RpcError(message, payload?.code, payload?.details, payload?.request_id)
    }
    throw new Error(message)
  }
  return payload.data as T
}

export async function getBillItems(billId: string): Promise<BillItem[]> {
  return postRpc<BillItem[]>('billItems', 'getBillItems', billId)
}

export async function createBillItem(
  input: BillItemInput & { bill_id: string; remember_merchant?: boolean },
): Promise<BillItem> {
  return postRpc<BillItem>('billItems', 'createBillItem', input)
}

export async function updateBillItem(
  itemId: string,
  patch: Partial<{
    transaction_date: string | null
    post_date: string | null
    description: string
    merchant_name: string | null
    category: SpendCategory | null
    amount: number
    currency: string
    item_type: BillItemType
    card_id: string | null
    card_tail: string | null
    remember_merchant: boolean
  }>,
): Promise<BillItem> {
  return postRpc<BillItem>('billItems', 'updateBillItem', itemId, patch)
}

export async function deleteBillItem(itemId: string): Promise<{ ok: true }> {
  return postRpc<{ ok: true }>('billItems', 'deleteBillItem', itemId)
}

export async function batchImportBillItems(input: {
  bill_id: string
  items: BillItemInput[]
}): Promise<{ inserted: number; items: BillItem[] }> {
  return postRpc<{ inserted: number; items: BillItem[] }>(
    'billItems',
    'batchImportBillItems',
    input,
  )
}

export async function clearBillItems(billId: string): Promise<{ deleted: number }> {
  return postRpc<{ deleted: number }>('billItems', 'clearBillItems', billId)
}

export async function getMerchantCategoryRules(): Promise<MerchantCategoryRule[]> {
  return postRpc<MerchantCategoryRule[]>('billItems', 'getMerchantCategoryRules')
}

export async function getInstallmentPlans(filters: {
  holder_id?: string
  card_id?: string
  status?: string
}): Promise<InstallmentPlanWithSummary[]> {
  return postRpc<InstallmentPlanWithSummary[]>('installments', 'getInstallmentPlans', filters)
}

export async function createInstallmentPlan(
  input: CreateInstallmentInput,
): Promise<InstallmentPlanWithSummary> {
  return postRpc<InstallmentPlanWithSummary>('installments', 'createInstallmentPlan', input)
}

export async function updateInstallmentPlan(
  planId: string,
  patch: UpdateInstallmentPatch,
): Promise<InstallmentPlanWithSummary> {
  return postRpc<InstallmentPlanWithSummary>('installments', 'updateInstallmentPlan', planId, patch)
}

export async function advanceInstallmentPeriod(
  planId: string,
  delta: 1 | -1,
): Promise<InstallmentPlanWithSummary> {
  return postRpc<InstallmentPlanWithSummary>(
    'installments',
    'advanceInstallmentPeriod',
    planId,
    delta,
  )
}

export async function settleInstallmentEarly(
  planId: string,
  input: { settled_at: string; settled_amount: number },
): Promise<InstallmentPlanWithSummary> {
  return postRpc<InstallmentPlanWithSummary>(
    'installments',
    'settleInstallmentEarly',
    planId,
    input,
  )
}

export async function deleteInstallmentPlan(planId: string): Promise<{ ok: true }> {
  return postRpc<{ ok: true }>('installments', 'deleteInstallmentPlan', planId)
}

export function normalizeCategoryBreakdownResponse(
  raw: CategoryBreakdownItem[] | Partial<CategoryBreakdownNormalized> | null | undefined,
): CategoryBreakdownNormalized {
  if (!raw) {
    return {
      items: [],
      covered_bills: 0,
      total_bills: 0,
      fx_converted: true,
      fx_unconverted_currencies: [],
      unallocated_refunds_by_currency: {},
    }
  }
  if (Array.isArray(raw)) {
    const first = raw[0]
    const unconverted = Array.from(
      new Set(raw.flatMap((it) => it.fx_unconverted_currencies ?? [])),
    ).sort()
    return {
      items: raw,
      covered_bills: first?.meta_covered_bills ?? 0,
      total_bills: first?.meta_total_bills ?? 0,
      fx_converted: raw.every((it) => it.fx_converted !== false) && unconverted.length === 0,
      fx_unconverted_currencies: unconverted,
      unallocated_refunds_by_currency: first?.meta_unallocated_refunds ?? {},
    }
  }
  return {
    items: raw.items ?? [],
    covered_bills: raw.covered_bills ?? 0,
    total_bills: raw.total_bills ?? 0,
    fx_converted: raw.fx_converted !== false,
    fx_unconverted_currencies: raw.fx_unconverted_currencies ?? [],
    unallocated_refunds_by_currency: raw.unallocated_refunds_by_currency ?? {},
  }
}

export async function getCategoryBreakdownExtended(
  filters: AnalyticsFilters & { include_fees?: boolean },
): Promise<CategoryBreakdownNormalized> {
  const raw = await postRpc<CategoryBreakdownItem[] | Partial<CategoryBreakdownNormalized>>(
    'analytics',
    'getCategoryBreakdownReport',
    filters,
  )
  return normalizeCategoryBreakdownResponse(raw)
}

export async function getCategoryDrilldownItems(
  filters: AnalyticsFilters & { category: string | null; include_fees?: boolean },
): Promise<CategoryDrilldownItem[]> {
  return postRpc<CategoryDrilldownItem[]>('analytics', 'getCategoryDrilldownItems', filters)
}

function normalizeCashflowEvent(
  ev: CashflowForecastResult['timeline'][number],
): CashflowForecastResult['timeline'][number] {
  const source = ev.source ?? ev.source_type ?? 'bill'
  const refId = ev.ref_id ?? ev.source_id ?? ev.id ?? ''
  return {
    ...ev,
    source,
    ref_id: refId,
  }
}

export async function getCashflowForecast(filters: {
  holder_id?: string
  card_id?: string
  horizon_days: CashflowHorizonDays
  display_currency?: string
}): Promise<CashflowForecastResult> {
  const raw = await postRpc<
    CashflowForecastResult & { as_of_date?: string }
  >('analytics', 'getCashflowForecast', filters)
  return {
    ...raw,
    base_date: raw.base_date ?? raw.as_of_date ?? '',
    timeline: Array.isArray(raw.timeline) ? raw.timeline.map(normalizeCashflowEvent) : [],
    overdue_alert: {
      ...(raw.overdue_alert ?? {
        count: 0,
        by_currency: {},
        total_converted: 0,
        fx_converted: true,
        items: [],
      }),
      items: Array.isArray(raw.overdue_alert?.items)
        ? raw.overdue_alert.items.map(normalizeCashflowEvent)
        : [],
    },
  }
}

export async function exportFamilyCsvRows(
  req: FamilyExportRequest,
): Promise<{ headers: string[]; rows: CsvRow[]; filename: string }> {
  return postRpc<{ headers: string[]; rows: CsvRow[]; filename: string }>(
    'exports',
    'exportFamilyCsvRows',
    req,
  )
}

export async function getStatementReport(
  req: StatementReportRequest,
): Promise<FamilyStatementReport> {
  return postRpc<FamilyStatementReport>('exports', 'getStatementReport', req)
}

export async function createPaymentWithFx(
  payment: {
    bill_id: string
    amount: number
    paid_at: string
    channel?: string
    note?: string
  } & PaymentFxLockFields,
) {
  return postRpc('bills', 'createPayment', payment)
}

export async function updatePaymentWithFx(
  paymentId: string,
  patch: {
    amount?: number
    paid_at?: string
    channel?: string | null
    note?: string | null
  } & PaymentFxLockFields,
) {
  return postRpc('payments', 'updatePayment', paymentId, patch)
}
