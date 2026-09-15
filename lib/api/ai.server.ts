import { getSystemSettingsWithSecrets } from './admin.server'
import { fetchPage, rootDomain } from '../site-fetch'

export interface AiCompleteRequest {
  type: 'bank' | 'card_product' | 'bill_text' | 'card_text'
  data: Record<string, unknown>
  fields?: string[]
}

// ============================================
// 低层 LLM 调用（服务端唯一使用密钥的地方）
// ============================================

interface ChatCompletionParams {
  baseURL: string
  model: string
  /** 只在服务端内存中使用，绝不进入任何返回值或客户端载荷 */
  apiKey: string
  systemPrompt: string
  userPrompt: string
  jsonObject?: boolean
}

/**
 * 调用 OpenAI 兼容的 chat/completions，返回首条消息内容。
 *
 * 密钥由调用方从 getSystemSettingsWithSecrets() 取得；客户端永远拿不到它，
 * 也不再需要在浏览器里拼 Authorization 头。
 */
async function chatCompletion({
  baseURL, model, apiKey, systemPrompt, userPrompt, jsonObject,
}: ChatCompletionParams): Promise<string> {
  const completionURL = `${baseURL.replace(/\/$/, '')}/chat/completions`
  console.log(`[AI] Calling ${completionURL} with model ${model}`)

  const response = await fetch(completionURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      ...(jsonObject ? { response_format: { type: 'json_object' } } : {}),
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    console.error(`[AI] API Error: ${response.status} - ${errText}`)
    throw new Error(`AI API 调用失败 (${response.status}): ${errText.slice(0, 200)}`)
  }

  const result = await response.json()
  const content = result?.choices?.[0]?.message?.content
  if (!content) throw new Error('AI 未返回有效内容')
  return content as string
}

/** 宽松解析 LLM 返回的 JSON 对象（容忍前后缀文字）。 */
function parseJsonObject(content: string): Record<string, unknown> {
  const attempt = (raw: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }

  const direct = attempt(content)
  if (direct) return unwrapAnswer(direct)

  const match = content.match(/\{[\s\S]*\}/)
  if (match) {
    const nested = attempt(match[0])
    if (nested) return unwrapAnswer(nested)
  }
  throw new Error(`AI 返回格式错误: ${content.slice(0, 200)}`)
}

/**
 * 拆掉模型偶尔多包的一层。
 *
 * 实测遇到过返回 `{"answer": "{\"full_name\":...}"}`：目标字段一个都没有，
 * 补全静默失败、界面显示「未识别」，但数据其实是好的。这里把常见的单键包装
 * （answer/result/data/output/content/response）拆开；拆出来不是对象就原样返回。
 */
function unwrapAnswer(obj: Record<string, unknown>): Record<string, unknown> {
  const keys = Object.keys(obj)
  if (keys.length !== 1) return obj
  const only = keys[0].toLowerCase()
  if (!['answer', 'result', 'data', 'output', 'content', 'response'].includes(only)) return obj
  const inner = obj[keys[0]]
  if (typeof inner === 'string') {
    try {
      const v = JSON.parse(inner)
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    } catch {
      return obj
    }
    return obj
  }
  if (inner && typeof inner === 'object' && !Array.isArray(inner)) return inner as Record<string, unknown>
  return obj
}

// 智能填充（AiFillBox）的抽取 prompt。原先放在客户端组件里，现随密钥一起留在服务端。
const BILL_TEXT_SYSTEM_PROMPT = `你是信用卡账单解析助手。从用户粘贴的账单邮件或短信文本中提取以下字段，严格以 JSON 返回，不要任何多余文字：
{
  "bill_amount": 数字或null,
  "min_payment": 数字或null,
  "due_date": "YYYY-MM-DD"或null,
  "bill_month": "YYYY-MM"或null,
  "statement_date": "YYYY-MM-DD"或null
}
注意：金额可能是"6480"、"6,480.00"、"¥6480元"，统一转为数字。无法确定的字段返回 null。`

const CARD_TEXT_SYSTEM_PROMPT = `你是信用卡产品信息解析助手。从用户粘贴的卡面或官网文本中提取以下字段，严格以 JSON 返回，不要任何多余文字：
{
  "bank_name": 字符串或null,
  "card_name": 字符串或null,
  "annual_fee": 数字或null,
  "billing_day": 数字或null,
  "card_number_last4": 字符串或null
}
无法确定的字段返回 null。`

// ============================================
// Wikipedia 搜索增强
// ============================================

/**
 * 搜索 Wikipedia 获取实体信息（支持 CORS，免费，无需 API Key）
 * 优先搜索中文 Wikipedia，回退到英文
 */
async function searchWikipedia(query: string, lang = 'zh'): Promise<string | null> {
  try {
    // Step 1: 搜索匹配的页面
    const searchUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=1&format=json&origin=*`
    const searchRes = await fetch(searchUrl)
    const searchData = await searchRes.json()
    const pageTitle = searchData?.query?.search?.[0]?.title
    if (!pageTitle) return null

    // Step 2: 获取页面摘要（纯文本，前 2000 字符）
    const summaryUrl = `https://${lang}.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(pageTitle)}&prop=extracts&exintro=true&explaintext=true&exchars=2000&format=json&origin=*`
    const summaryRes = await fetch(summaryUrl)
    const summaryData = await summaryRes.json()
    const pages = summaryData?.query?.pages
    if (!pages) return null

    const page = Object.values(pages)[0] as { extract?: string }
    return page?.extract || null
  } catch (err) {
    console.warn(`[Search] Wikipedia ${lang} search failed:`, err)
    return null
  }
}

/**
 * 获取搜索上下文：先搜中文 Wikipedia，若无结果则搜英文
 */
async function getSearchContext(query: string): Promise<string> {
  console.log(`[Search] Searching Wikipedia for: ${query}`)
  let context = await searchWikipedia(query, 'zh')
  if (!context) {
    context = await searchWikipedia(query, 'en')
  }
  if (context) {
    console.log(`[Search] Found context (${context.length} chars)`)
    return `\n\n以下是从 Wikipedia 获取的参考资料，请优先基于这些信息进行补全：\n---\n${context}\n---`
  }
  console.log('[Search] No Wikipedia results found')
  return ''
}

// ============================================
// Prompts
// ============================================

const BANK_SYSTEM_PROMPT = `你是一个银行信息专家。根据用户提供的银行简称和国家，以及参考资料，补全以下字段。
请严格以 JSON 格式返回结果，不要包含任何其他文字。

需要补全的字段：
- full_name: 银行全称（官方注册名称）
- customer_service_phone: 信用卡客服热线电话（优先使用该银行的信用卡中心专线，如没有则用综合客服电话）
- website_url: 官方网站地址

示例输入：{ "name": "招商银行", "country": "CN" }
示例输出：{ "full_name": "招商银行股份有限公司", "customer_service_phone": "4008205555", "website_url": "https://www.cmbchina.com" }

注意事项：
- 优先使用参考资料中的信息，确保准确性
- 如果参考资料和你的知识冲突，以参考资料为准
- 如果无法确定某个字段，返回 null
- 确保信息准确，不要编造
- 只返回 JSON，不要有任何多余文字`

const CARD_SYSTEM_PROMPT = `你是一个信用卡产品专家。根据用户提供的银行名称和卡名，以及参考资料，补全以下字段。
请严格以 JSON 格式返回结果，不要包含任何其他文字。

需要补全的字段：
- description_md: Markdown 格式的卡片详细介绍（包含产品特色、适用人群、主要权益等，200-400字）
- apply_url: 在线申请链接（如果知道的话）
- rewards_summary: 积分/返现规则简要说明（50-100字）
- annual_fee: 年费金额（数字，单位为该卡币种）
- annual_fee_waiver: 年费减免政策说明

注意事项：
- 优先使用参考资料中的信息，确保准确性
- 如果参考资料和你的知识冲突，以参考资料为准
- 如果无法确定某个字段，返回 null
- description_md 请使用 Markdown 格式，包含标题和分段
- 确保信息尽量准确，不确定的内容返回 null
- 只返回 JSON，不要有任何多余文字`

// ============================================
// AI 补全主函数
// ============================================

/**
 * 调用 AI 补全（带 Wikipedia 搜索增强）
 *
 * 流程：
 * 1. 搜索 Wikipedia 获取实时参考资料
 * 2. 将参考资料注入 Prompt
 * 3. 调用 LLM 生成结构化数据
 * 4. 后处理（自动生成 logo_url 等）
 */
export async function aiComplete(params: AiCompleteRequest) {
  // 1. 获取 AI 配置
  const settings = await getSystemSettingsWithSecrets()
  const baseURL = (typeof settings.ai_base_url === 'string' && settings.ai_base_url) || 'https://api.openai.com/v1'
  const model = settings.ai_model || 'gpt-4o'
  const apiKey = settings.ai_api_key

  if (!apiKey) {
    throw new Error('未配置 AI API Key，请在系统设置中配置')
  }

  // 智能填充：从粘贴的账单/卡面文本里抽字段。密钥留在服务端，前端只发文本。
  if (params.type === 'bill_text' || params.type === 'card_text') {
    const text = typeof params.data.text === 'string' ? params.data.text : ''
    if (!text.trim()) throw new Error('请先粘贴需要解析的文本')
    const content = await chatCompletion({
      baseURL,
      model: model as string,
      apiKey: apiKey as string,
      systemPrompt: params.type === 'bill_text' ? BILL_TEXT_SYSTEM_PROMPT : CARD_TEXT_SYSTEM_PROMPT,
      userPrompt: text,
      jsonObject: true,
    })
    return parseJsonObject(content)
  }

  // 2. 搜索 Wikipedia 获取参考资料
  const { type, data, fields } = params
  let searchQuery: string
  if (type === 'bank') {
    searchQuery = `${data.name} 银行`
  } else {
    searchQuery = `${data.bank_name} ${data.card_name} 信用卡`
  }
  const searchContext = await getSearchContext(searchQuery)

  // 3. 构建 Prompt
  let systemPrompt: string
  let userPrompt: string

  if (type === 'bank') {
    systemPrompt = BANK_SYSTEM_PROMPT
    if (fields && fields.length > 0) {
      systemPrompt += `\n\n注意：用户只需要补全以下字段：${fields.join(', ')}。只返回这些字段的值。`
    }
    userPrompt = JSON.stringify({
      name: data.name,
      country: data.country,
    }) + searchContext
  } else if (type === 'card_product') {
    systemPrompt = CARD_SYSTEM_PROMPT
    if (fields && fields.length > 0) {
      systemPrompt += `\n\n注意：用户只需要补全以下字段：${fields.join(', ')}。只返回这些字段的值。`
    }
    userPrompt = JSON.stringify({
      bank_name: data.bank_name,
      card_name: data.card_name,
      currency: data.currency || 'CNY',
      country: data.country || 'CN',
    }) + searchContext
  } else {
    throw new Error('不支持的补全类型')
  }

  // 4. 调用 LLM
  const content = await chatCompletion({
    baseURL,
    model: model as string,
    apiKey: apiKey as string,
    systemPrompt,
    userPrompt,
    jsonObject: true,
  })

  // 5. 解析 JSON 结果
  try {
    const parsed = JSON.parse(content)

    // 6. 后处理：根据 website_url 自动生成可靠的 logo_url
    if (type === 'bank') {
      const websiteUrl = parsed.website_url || (data.website_url as string)
      if (websiteUrl) {
        try {
          const domain = new URL(websiteUrl).hostname
          parsed.logo_url = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`
        } catch {
          // URL 解析失败，忽略
        }
      }
    }

    return parsed
  } catch {
    throw new Error(`AI 返回格式错误: ${content.slice(0, 200)}`)
  }
}

// ============================================
// 以官网真实内容为准的银行补全
// ============================================

/**
 * 为什么不能让模型直接给答案：模型给得出「招商银行 → 4008205555」，也给出过
 * 一个已经停用的号码，两者在界面上长得一样。电话打错、官网指向别家，在财务
 * 应用里是能造成实际损失的。所以这里的模型只负责一件事——**提名官网域名**；
 * 电话与全称一律以真的抓回来的官网页面为证，抓不到就留空并标注，不猜。
 */

export interface BankEnrichment {
  id: string
  name: string
  full_name: string | null
  customer_service_phone: string | null
  website_url: string | null
  /** 实际抓过的 URL，按顺序。用于向用户交代依据。 */
  fetched: string[]
  /** 抓取失败/无内容的地址及原因。 */
  fetchErrors: string[]
  /**
   * 字段来源：`site` = 在该行官网页面上直接读到；
   * `model` = 模型凭记忆给出的、未能在官网页面上佐证的候选，需人工确认。
   */
  provenance: Record<'full_name' | 'customer_service_phone' | 'website_url', 'site' | 'model' | 'none'>
  /** 官方域名是否与站点自身内容对得上（防止跳转到导流/聚合站）。 */
  domainConsistent: boolean
}

/** 常见「联系/关于」子页；客服电话多数不在首页。 */
const CONTACT_PATHS = ['', '/contact', '/contactus', '/contact-us', '/gywm', '/lianxiwomen', '/about/contact']

/** 国内银行客服短号：95xxx / 96xxx。短号是**最稳定**的客服标识。 */
const SHORT_PHONE_RE = /^(?:95\d{3}|96\d{3})$/
/** 400/800 热线。 */
const HOTLINE_RE = /^(?:400|800)-?\d{3}-?\d{4}$/
/** 任意「像客服电话」的形态，用于判断页面上有没有可用号码。 */
const SERVICE_PHONE_RE = /^(?:95\d{3}|96\d{3}|(?:400|800)-?\d{3}-?\d{4})/

export function pickServicePhone(phones: string[]): string | null {
  // 比较时去掉空白与连字符（页面里 400-820-5555 / 400 820 5555 混着写），
  // 但返回原样字符串——不要把用户看得懂的写法改掉。
  const candidates = phones.map(original => ({ original, normalized: original.replace(/[\s-]/g, '') }))
  // 短号优先于 400 热线：同一家银行两者都会出现在页脚，短号更稳定、不会被营销
  // 号码污染（实测招商银行首页同时含 4006095555 与 95555，直觉实现会先命中前者）。
  const pick =
    candidates.find(c => SHORT_PHONE_RE.test(c.normalized)) ??
    candidates.find(c => HOTLINE_RE.test(c.normalized)) ??
    candidates[0]
  return pick?.original ?? null
}

/** 让模型提名官网域名（只提名，不采信它给的电话）。 */
async function nominateWebsite(
  cfg: { baseURL: string; model: string; apiKey: string },
  name: string,
  country: string
): Promise<string | null> {
  const content = await chatCompletion({
    baseURL: cfg.baseURL,
    model: cfg.model,
    apiKey: cfg.apiKey,
    systemPrompt:
      '你只做一件事：给出该银行（或发卡机构）的官方网站域名。' +
      '返回 JSON：{"website_url":"https://..."}。' +
      '必须是该机构自己的域名，不要给维基百科、新闻站、聚合导航站或任何第三方页面。不确定就返回 {"website_url":null}。',
    userPrompt: JSON.stringify({ name, country }),
    jsonObject: true,
  })
  const parsed = parseJsonObject(content)
  const url = parsed.website_url
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/** 抓官网（含常见联系页），返回可用证据。限制抓取次数，避免批量时过慢。 */
async function gatherSiteEvidence(origin: string): Promise<{
  fetched: string[]
  errors: string[]
  text: string
  phones: string[]
  domains: string[]
  titleLike: string
  /** 最终落地的域名是否仍属于提名的那家（重定向到别家要能被发现）。 */
  stayedOnOrigin: boolean
}> {
  const fetched: string[] = []
  const errors: string[] = []
  let text = ''
  const phones: string[] = []
  const domains: string[] = []
  const wantedRoot = rootDomain(origin)
  let stayedOnOrigin = true

  for (const path of CONTACT_PATHS) {
    const url = origin + path
    try {
      const page = await fetchPage(url, { timeoutMs: 10000, maxChars: 20000 })
      if (page.status >= 400) {
        errors.push(`${url} → HTTP ${page.status}`)
        continue
      }
      fetched.push(page.finalUrl)
      if (rootDomain(page.finalUrl) !== wantedRoot) stayedOnOrigin = false
      text += '\n' + page.text
      phones.push(...page.phones)
      domains.push(...page.domains)
      // 首页通常已含页脚客服信息；拿到号码就不必把全部子页都抓一遍
      if (phones.some(p => SERVICE_PHONE_RE.test(p.replace(/\s/g, '')))) break
    } catch (err) {
      errors.push(`${url} → ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const snippet = text.slice(0, 3000)
  return {
    fetched,
    errors,
    text: text.slice(0, 12000),
    phones: [...new Set(phones)],
    domains: [...new Set(domains.map(d => d.toLowerCase()))],
    titleLike: snippet,
    stayedOnOrigin,
  }
}

/** 用抓到的官网正文补官方全称（从正文里找「XX银行股份有限公司」这类表述）。 */
export function fullNameFromSite(text: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`${escaped}(?:股份)?有限公司`),
    new RegExp(`${escaped}股份有限公司`),
    new RegExp(`(${escaped}[\\u4e00-\\u9fa5]{0,12}?有限公司)`),
  ]
  for (const re of patterns) {
    const hit = text.match(re)
    if (hit) return hit[0].replace(/\s/g, '').slice(0, 40)
  }
  return null
}

/**
 * 补全单家银行：先提名官网，再以官网内容为证。
 * 不写库——返回值交给调用方审核后再落库，避免把未经确认的内容直接写进目录。
 */
export async function enrichBankFromWeb(bank: {
  id: string
  name: string
  country?: string | null
  website_url?: string | null
}): Promise<BankEnrichment> {
  const settings = await getSystemSettingsWithSecrets()
  const baseURL = (typeof settings.ai_base_url === 'string' && settings.ai_base_url) || 'https://api.openai.com/v1'
  const model = settings.ai_model || 'gpt-4o'
  const apiKey = settings.ai_api_key
  if (!apiKey) throw new Error('未配置 AI API Key，请在系统设置中配置')
  const cfg = { baseURL, model: model as string, apiKey: apiKey as string }

  const result: BankEnrichment = {
    id: bank.id,
    name: bank.name,
    full_name: null,
    customer_service_phone: null,
    website_url: null,
    fetched: [],
    fetchErrors: [],
    provenance: { full_name: 'none', customer_service_phone: 'none', website_url: 'none' },
    domainConsistent: false,
  }

  // 1) 已填官网就先用它；否则让模型提名一个候选
  let origin: string | null = null
  const existing = typeof bank.website_url === 'string' ? bank.website_url : ''
  if (existing) {
    try { origin = new URL(existing).origin } catch { origin = null }
  }
  if (!origin) {
    origin = await nominateWebsite(cfg, bank.name, bank.country || 'CN')
    if (origin) result.provenance.website_url = 'model'
  } else {
    result.website_url = origin
    result.provenance.website_url = 'site'
  }

  if (!origin) {
    // 连候选域名都给不出来：如实返回空，交给人工
    return result
  }

  // 2) 抓官网真实内容
  const evidence = await gatherSiteEvidence(origin)
  result.fetched = evidence.fetched
  result.fetchErrors = evidence.errors

  if (!evidence.fetched.length) {
    // 提名了域名但抓不到：保留域名候选，但标注为未验证
    result.website_url = origin
    return result
  }

  result.website_url = origin
  result.provenance.website_url = 'site'

  // 3) 域名一致性：以「重定向后的最终域名是否仍是提名的那家」为准。
  //    之前写成「页面里出现过该域名」，那条件恒真——页面自己就含自己的域名，
  //    等于没检查。真正要防的是模型提名了一个导流站/聚合站，或站点把请求跳到别处。
  const root = rootDomain(origin)
  result.domainConsistent =
    evidence.stayedOnOrigin && evidence.fetched.some(u => rootDomain(u) === root)

  // 4) 电话以官网页面为准
  const sitePhone = pickServicePhone(evidence.phones)
  if (sitePhone) {
    result.customer_service_phone = sitePhone
    result.provenance.customer_service_phone = 'site'
  } else {
    // 官网没写号码：退回模型候选，但标为未验证，由界面提示人工确认
    const spoken = await nominateWebsitePhone(cfg, bank.name)
    if (spoken) {
      result.customer_service_phone = spoken
      result.provenance.customer_service_phone = 'model'
    }
  }

  // 5) 全称以官网正文为准；取不到就留空（不猜）
  const siteFull = fullNameFromSite(evidence.text, bank.name)
  if (siteFull) {
    result.full_name = siteFull
    result.provenance.full_name = 'site'
  }

  return result
}

/** 仅取模型对客服电话的记忆作为「未验证候选」，供官网页面没写号码时兜底。 */
async function nominateWebsitePhone(
  cfg: { baseURL: string; model: string; apiKey: string },
  name: string
): Promise<string | null> {
  try {
    const content = await chatCompletion({
      baseURL: cfg.baseURL,
      model: cfg.model,
      apiKey: cfg.apiKey,
      systemPrompt:
        '给出该银行**信用卡**客服热线。只返回 JSON：{"customer_service_phone":"95555"}。' +
        '不确定就返回 null，不要编造。不要返回 400 营销电话。',
      userPrompt: JSON.stringify({ name }),
      jsonObject: true,
    })
    const parsed = parseJsonObject(content)
    const phone = parsed.customer_service_phone
    return typeof phone === 'string' && /[0-9]{4,}/.test(phone) ? phone.trim() : null
  } catch {
    return null
  }
}

const BENEFIT_SYSTEM_PROMPT = `你是一个信用卡权益专家。根据提供的银行名称和信用卡产品名称，结合参考资料，列出该信用卡的核心专属权益。
请严格以 JSON 格式返回结果，格式为一个 JSON 数组：
[
  {
    "name": "权益名称（如：每年免费机场接送）",
    "description": "权益描述（如：境内指定机场接送机服务，每年2次）",
    "quota": 2,
    "period": "yearly",
    "reset_month": 1
  }
]
- quota 为数字（至少 1）
- period 只能为 'yearly' | 'monthly' | 'one_time' 中的一个
- reset_month 只能为 1-12 的数字或 null
只返回 JSON 数组，不要任何其他文字。`

/**
 * 利用 LLM + 搜索自动搜集并解析信用卡的专属权益
 */
export async function aiCollectCardBenefits(bankName: string, cardName: string) {
  const settings = await getSystemSettingsWithSecrets()
  const baseURL = (typeof settings.ai_base_url === 'string' && settings.ai_base_url) || 'https://api.openai.com/v1'
  const model = settings.ai_model || 'gpt-4o'
  const apiKey = settings.ai_api_key

  if (!apiKey) {
    throw new Error('未配置 AI API Key，请在系统设置中配置')
  }

  const searchQuery = `${bankName} ${cardName} 信用卡 核心权益 优惠`
  const searchContext = await getSearchContext(searchQuery)

  const content = await chatCompletion({
    baseURL,
    model: model as string,
    apiKey: apiKey as string,
    systemPrompt: BENEFIT_SYSTEM_PROMPT,
    userPrompt: `银行：${bankName}，卡片：${cardName}${searchContext}`,
  })

  try {
    const jsonMatch = content.match(/\[[\s\S]*\]/)
    const rawJson = jsonMatch ? jsonMatch[0] : content
    return JSON.parse(rawJson) as Array<{
      name: string
      description?: string
      quota: number
      period: 'yearly' | 'monthly' | 'one_time'
      reset_month?: number
    }>
  } catch {
    throw new Error(`AI 返回格式错误: ${content.slice(0, 200)}`)
  }
}
