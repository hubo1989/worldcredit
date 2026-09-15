import { getBillDashboardItems } from './bills.server'
import { getSystemSettings } from './admin.server'

export interface AiAssistantRequest {
  prompt: string
}

export interface AiAssistantResponse {
  answer: string
  model?: string
}

const DEFAULT_MODEL = 'openai/gpt-4o-mini'

function formatMoney(value: number): string {
  return `¥${Number(value || 0).toLocaleString()}`
}

function statusLabel(status: string): string {
  switch (status) {
    case 'paid': return '已结清'
    case 'partial': return '部分还款'
    case 'overdue': return '已逾期'
    case 'unpaid': return '未还款'
    default: return status
  }
}

async function buildFinancialContext(): Promise<string> {
  const bills = await getBillDashboardItems(30)
  const openBills = bills.filter(bill => bill.computed_status !== 'paid')
  const totalRemaining = openBills.reduce((sum, bill) => sum + bill.remaining_amount, 0)
  const overdue = openBills.filter(bill => bill.computed_status === 'overdue')
  const dueSoon = openBills.filter(bill => bill.days_until_due >= 0 && bill.days_until_due <= 7)

  const lines = [
    `当前未结清账单数：${openBills.length}`,
    `当前剩余应还总额：${formatMoney(totalRemaining)}`,
    `已逾期账单数：${overdue.length}`,
    `7天内到期账单数：${dueSoon.length}`,
    '',
    '最近/最紧急账单：',
    ...openBills.slice(0, 12).map((bill, index) => {
      const product = bill.card?.card_product
      const cardName = `${product?.bank_name || '未知银行'} ${product?.card_name || ''}`.trim()
      const tail = bill.card?.card_number_last4 ? `尾号${bill.card.card_number_last4}` : '未记录尾号'
      return `${index + 1}. ${cardName}（${tail}）｜账单月 ${bill.bill_month}｜状态 ${statusLabel(bill.computed_status)}｜账单额 ${formatMoney(Number(bill.bill_amount))}｜已还 ${formatMoney(bill.paid_amount)}｜剩余 ${formatMoney(bill.remaining_amount)}｜到期日 ${bill.due_date}｜剩余天数 ${bill.days_until_due}`
    })
  ]

  if (openBills.length === 0) {
    lines.push('当前没有未结清账单。')
  }

  return lines.join('\n')
}

export async function askAiAssistant({ prompt }: AiAssistantRequest): Promise<AiAssistantResponse> {
  const trimmed = prompt.trim()
  if (!trimmed) throw new Error('请输入问题')

  const context = await buildFinancialContext()
  const settings = await getSystemSettings()
  const baseURL = ((typeof settings.ai_base_url === 'string' && settings.ai_base_url) || 'https://api.openai.com/v1').replace(/\/$/, '')
  const apiKey = typeof settings.ai_api_key === 'string' ? settings.ai_api_key : ''
  if (!apiKey) throw new Error('AI API 密钥未配置')

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      messages: [
        {
          role: 'system',
          content: '你是 WorldCredit 的个人信用卡与账单管理助手。请用中文回答。基于账单上下文做还款建议、风险提醒、负债摘要。不编造数据。不承诺收益。',
        },
        {
          role: 'user',
          content: `以下是当前账单上下文：\n\n${context}\n\n用户问题：${trimmed}`,
        },
      ],
      temperature: 0.2,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`AI API 调用失败 (${response.status}): ${errText.slice(0, 200)}`)
  }

  const completion = await response.json()
  const answer = completion?.choices?.[0]?.message?.content
  if (!answer) throw new Error('AI 未返回有效内容')
  return { answer, model: DEFAULT_MODEL }
}
