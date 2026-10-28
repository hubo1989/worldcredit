/**
 * OpenAI 账单解析器（email-worker 与 Gmail 拉取同步共用）。
 *
 * loadAiConfig 从 system_settings 读三个独立 key（ai_api_key / ai_base_url /
 * ai_model），与主工程 AI 功能读的形状一致。更老的构建读单个 'ai_config'
 * blob，但从来没有东西写过它，账单解析因此一直无法鉴权；这里先读产品
 * key，'ai_config' 保留为兼容兜底。
 */

import type { AiConfig, BillParseResult } from './types'

export async function loadAiConfig(db: D1Database): Promise<AiConfig> {
  const rows = await db.prepare(
    "SELECT key, value FROM system_settings WHERE key IN ('ai_api_key', 'ai_base_url', 'ai_model', 'ai_config')"
  ).all<{ key: string; value: string }>()

  const settings = new Map<string, unknown>()
  for (const row of rows.results || []) {
    try {
      settings.set(row.key, JSON.parse(row.value))
    } catch {
      settings.set(row.key, row.value)
    }
  }

  const legacy = settings.get('ai_config')
  const legacyConfig =
    legacy && typeof legacy === 'object' ? (legacy as Partial<AiConfig>) : undefined

  const pick = (key: string, legacyValue?: string): string => {
    const value = settings.get(key)
    return (typeof value === 'string' && value) || legacyValue || ''
  }

  return {
    apiKey: pick('ai_api_key', legacyConfig?.apiKey),
    baseURL: pick('ai_base_url', legacyConfig?.baseURL) || 'https://api.openai.com/v1',
    model: pick('ai_model', legacyConfig?.model) || 'gpt-4o',
  }
}

// ─── OpenAI bill parser ───────────────────────────────────────────────────────

const SYSTEM_PROMPT = `你是银行账单解析助手。从邮件内容中提取信用卡账单信息，以 JSON 格式返回：
{"is_bill":true,"email_kind":"statement","bank_name":"","card_last4":"","bill_amount":0,"min_payment":null,"due_date":"YYYY-MM-DD","bill_month":"YYYY-MM","statement_date":null,"statement_day":null,"currency":"CNY","confidence":0.9}
字段 card_last4 请填邮件中出现的"卡号/账户结尾"完整数字，不要截断：
- 大陆/香港卡通常是末 4 位，如 "1234"
- American Express 的账户结尾是 5 位，如 "93001"，请原样填 5 位
- 如邮件明确给出更长结尾（如 6 位 "671006"），也请原样填写
不要把它补零或改写。若邮件中没有出现任何卡号/账户结尾，填 null。
email_kind 是邮件类型，按实际内容选：
- "statement"：本期账单/电子对账单（含本期应还金额和还款日）
- "autopay_scheduled"：自动还款/扣款计划通知（如 "automatic payment scheduled"）
- "payment_reminder"：还款提醒/催缴通知
- "other"：营销或其他
只有 email_kind 是 "statement" 时 is_bill 才为 true；自动扣款通知、还款提醒即使提到金额和还款日，也不是新一期账单，is_bill 必须为 false（它们对应的那期账单已由真正的账单邮件建过，再解析会造出重复账单）。
statement_date 只在邮件明确给出本期出账日/Statement Date（完整日期）时填写。注意：自动扣款通知里的 "Statement balance as of Oct 16" 不是出账日，不要填进 statement_date。
statement_day 只在邮件正文明确写出「账单日」及其数值（如「账单日 09」「账单日：每月21日」「Statement day: 22」）时填 1-31 的整数。不要从账期起止日期、还款日或 statement_date 推算；没有就填 null。
如果不是账单邮件，返回 {"is_bill": false}
只返回 JSON。`

export async function parseBillWithAI(config: AiConfig, emailBody: string): Promise<BillParseResult> {
  const endpoint = config.baseURL.replace(/\/$/, '') + '/chat/completions'
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model, temperature: 0,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: emailBody }],
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenAI API error (${res.status}): ${text.slice(0, 500)}`)
  }
  const json = await res.json() as { choices: Array<{ message: { content: string } }> }
  return JSON.parse(json.choices?.[0]?.message?.content ?? '{}') as BillParseResult
}
