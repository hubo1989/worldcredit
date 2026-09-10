import { getSystemSettings } from './admin'

export interface AiCompleteRequest {
  type: 'bank' | 'card_product'
  data: Record<string, unknown>
  fields?: string[]
}

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
  const settings = await getSystemSettings()
  const baseURL = (typeof settings.ai_base_url === 'string' && settings.ai_base_url) || 'https://api.openai.com/v1'
  const model = settings.ai_model || 'gpt-4o'
  const apiKey = settings.ai_api_key

  if (!apiKey) {
    throw new Error('未配置 AI API Key，请在系统设置中配置')
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
  const completionURL = `${baseURL.replace(/\/$/, '')}/chat/completions`
  console.log(`[AI] Calling ${completionURL} with model ${model}`)

  const aiResponse = await fetch(completionURL, {
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
      response_format: { type: 'json_object' },
    }),
  })

  if (!aiResponse.ok) {
    const errText = await aiResponse.text()
    console.error(`[AI] API Error: ${aiResponse.status} - ${errText}`)
    throw new Error(`AI API 调用失败 (${aiResponse.status}): ${errText.slice(0, 200)}`)
  }

  const aiResult = await aiResponse.json()
  const content = aiResult.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('AI 未返回有效内容')
  }

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
  const settings = await getSystemSettings()
  const baseURL = (typeof settings.ai_base_url === 'string' && settings.ai_base_url) || 'https://api.openai.com/v1'
  const model = settings.ai_model || 'gpt-4o'
  const apiKey = settings.ai_api_key

  if (!apiKey) {
    throw new Error('未配置 AI API Key，请在系统设置中配置')
  }

  const searchQuery = `${bankName} ${cardName} 信用卡 核心权益 优惠`
  const searchContext = await getSearchContext(searchQuery)

  const completionURL = `${baseURL.replace(/\/$/, '')}/chat/completions`

  const aiResponse = await fetch(completionURL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: BENEFIT_SYSTEM_PROMPT },
        { role: 'user', content: `银行：${bankName}，卡片：${cardName}${searchContext}` },
      ],
      temperature: 0.3,
    }),
  })

  if (!aiResponse.ok) {
    const errText = await aiResponse.text()
    throw new Error(`AI API 调用失败 (${aiResponse.status}): ${errText.slice(0, 200)}`)
  }

  const aiResult = await aiResponse.json()
  const content = aiResult.choices?.[0]?.message?.content

  if (!content) {
    throw new Error('AI 未返回有效内容')
  }

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

