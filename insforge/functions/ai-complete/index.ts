/**
 * Edge Function: AI 自动补全
 * 
 * 接收银行或卡产品的部分数据，调用 OpenAI 兼容 API 补全缺失字段。
 * AI 配置（baseURL / model / apiKey）从请求头或 system_settings 读取。
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-AI-Base-URL, X-AI-Model, X-AI-API-Key',
  'Access-Control-Max-Age': '86400',
}

// 银行补全的 System Prompt
const BANK_SYSTEM_PROMPT = `你是一个银行信息专家。根据用户提供的银行简称和国家，补全以下字段。
请严格以 JSON 格式返回结果，不要包含任何其他文字。

需要补全的字段：
- full_name: 银行全称（官方注册名称）
- customer_service_phone: 官方客服电话
- website_url: 官方网站地址

示例输入：{ "name": "招商银行", "country": "CN" }
示例输出：{ "full_name": "招商银行股份有限公司", "customer_service_phone": "95555", "website_url": "https://www.cmbchina.com" }

注意事项：
- 如果无法确定某个字段，返回 null
- 确保信息准确，不要编造
- 只返回 JSON，不要有任何多余文字`

// 卡产品补全的 System Prompt
const CARD_SYSTEM_PROMPT = `你是一个信用卡产品专家。根据用户提供的银行名称和卡名，补全以下字段。
请严格以 JSON 格式返回结果，不要包含任何其他文字。

需要补全的字段：
- description_md: Markdown 格式的卡片详细介绍（包含产品特色、适用人群、主要权益等，200-400字）
- apply_url: 在线申请链接（如果知道的话）
- rewards_summary: 积分/返现规则简要说明（50-100字）
- annual_fee: 年费金额（数字，单位为该卡币种）
- annual_fee_waiver: 年费减免政策说明

示例输入：{ "bank_name": "招商银行", "card_name": "经典白金卡", "currency": "CNY" }
示例输出：
{
  "description_md": "## 招商银行经典白金卡\\n\\n经典白金信用卡是招商银行...",
  "apply_url": "https://ccclub.cmbchina.com/",
  "rewards_summary": "消费1元累积1积分，...",
  "annual_fee": 3600,
  "annual_fee_waiver": "年消费满18万元可减免次年年费"
}

注意事项：
- 如果无法确定某个字段，返回 null
- description_md 请使用 Markdown 格式，包含标题和分段
- 确保信息尽量准确，不确定的内容返回 null
- 只返回 JSON，不要有任何多余文字`

export default async function handler(req: Request): Promise<Response> {
  // CORS 统一处理
  if (req.method === 'OPTIONS') {
    return new Response(null, { 
      status: 204, 
      headers: CORS_HEADERS 
    })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }

  try {
    let body: any
    try {
      body = await req.json()
    } catch (e) {
      return new Response(JSON.stringify({ error: '无效的 JSON 请求体' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const { type, data, fields, config } = body

    // AI 配置：优先从请求头获取（SDK 传入），其次从 body 传入（调试），最后使用默认值
    const baseURL = req.headers.get('X-AI-Base-URL') || config?.baseURL || 'https://api.openai.com/v1'
    const model = req.headers.get('X-AI-Model') || config?.model || 'gpt-4o'
    const apiKey = req.headers.get('X-AI-API-Key') || config?.apiKey

    if (!apiKey) {
      return new Response(JSON.stringify({ error: '未配置 AI API Key，请在系统设置中配置' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 选择 Prompt
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
      })
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
      })
    } else {
      return new Response(JSON.stringify({ error: '不支持的类型' }), {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 调用 OpenAI 兼容 API
    const completionURL = `${baseURL.replace(/\/$/, '')}/chat/completions`
    console.log(`[AI-AGENT] Calling ${completionURL} with model ${model}`)
    
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
      console.error(`[AI-AGENT] API Error: ${aiResponse.status} - ${errText}`)
      return new Response(JSON.stringify({ error: `AI API 调用失败: ${aiResponse.status}`, details: errText }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    const aiResult = await aiResponse.json()
    console.log(`[AI-AGENT] Raw Result:`, JSON.stringify(aiResult))
    const content = aiResult.choices?.[0]?.message?.content

    if (!content) {
      return new Response(JSON.stringify({ error: 'AI 未返回有效内容' }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    // 解析 JSON
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(content)
    } catch {
      return new Response(JSON.stringify({ error: 'AI 返回格式错误', raw: content }), {
        status: 502,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ success: true, data: parsed }), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    })
  }
}
