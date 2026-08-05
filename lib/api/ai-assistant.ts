import { insforge } from '../insforge'
import { getBillDashboardItems } from './bills'

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
  const completion = await insforge.ai.chat.completions.create({
    model: DEFAULT_MODEL,
    messages: [
      {
        role: 'system',
        content: `你是 WorldCredit 的个人信用卡与账单管理助手。请用中文回答用户的自然语言问题。

你可以基于提供的账单上下文做：
- 还款优先级建议；
- 到期/逾期风险提醒；
- 当前负债和现金流摘要；
- 解释账单状态；
- 给出下一步操作建议。

约束：
- 不要编造上下文里没有的卡、账单或支付记录。
- 如果用户问投资、借贷或高风险金融建议，只给保守的信息整理和风险提示，不承诺收益。
- 回答要直接、可执行，优先列出重点。`,
      },
      {
        role: 'user',
        content: `以下是当前 WorldCredit 数据库里的账单上下文：\n\n${context}\n\n用户问题：${trimmed}`,
      },
    ],
    temperature: 0.2,
  })

  const answer = completion?.choices?.[0]?.message?.content
  if (!answer) throw new Error('AI 未返回有效内容')
  return { answer, model: DEFAULT_MODEL }
}
