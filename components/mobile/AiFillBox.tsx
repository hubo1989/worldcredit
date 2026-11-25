'use client'

import { useState } from 'react'
import { TextArea } from '@/components/obsidian/fields'
import { Alert, Spinner } from '@/components/obsidian/feedback'
import { AiSparkleIcon } from '@/components/icons/WcIcon'
import { aiComplete } from '@/lib/api/ai'

/**
 * AI 智能填充盒（§5.3）。
 * 内嵌于表单顶部：虚线金框 + 文本框 + 智能填充按钮。
 * bill 模式优先委托服务端智能解析 RPC（aiComplete -> email-core），
 * 仅在服务端未配置 AI Key 时回退本地正则粗提并展示明确告警。
 *
 * 安全：LLM 调用走服务端 aiComplete（RPC `ai/aiComplete`）。浏览器不持有 AI Key。
 */
interface Props {
  /** 解析成功后回调，父表单预填字段并标记 AI 来源 */
  onFill: (data: Record<string, unknown>) => void
  /** 解析模式：bill 提取账单字段，card 提取卡产品字段 */
  mode: 'bill' | 'card'
}

const PLACEHOLDER: Record<Props['mode'], string> = {
  bill: '粘贴账单邮件 / 短信文本，例如：本期应还 ¥6,480.00，最低还款 ¥650，到期还款日 9 月 10 日',
  card: '粘贴卡面 / 官网信息，例如：招商银行 Young 卡，年费 300 元，账单日每月 15 日，尾号 2201',
}

/** 无 AI Key 离线粗提兜底（强制提示核对） */
function localExtract(text: string, mode: Props['mode']): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  const amounts = [...text.matchAll(/(\d[\d,]*\.?\d*)\s*[元¥]|(?:US\$|HK\$|\$|¥)\s*(\d[\d,]*\.?\d*)/gi)]
    .map(m => (m[1] || m[2]).replace(/,/g, ''))
    .map(Number)
    .filter(n => !isNaN(n) && n > 0)
  if (amounts.length > 0) {
    data.bill_amount = amounts[0]
    if (amounts.length > 1) data.min_payment = amounts[amounts.length - 1]
  }
  if (/HKD|港币|HK\$/i.test(text)) data.currency = 'HKD'
  else if (/USD|美元|US\$/i.test(text)) data.currency = 'USD'

  const dateMatch = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (dateMatch) {
    const now = new Date()
    const month = parseInt(dateMatch[1], 10)
    const day = parseInt(dateMatch[2], 10)
    let year = now.getFullYear()
    if (month < now.getMonth() + 1) year += 1
    const mm = String(month).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    data.due_date = `${year}-${mm}-${dd}`
    data.bill_month = `${year}-${mm}`
    if (mode === 'bill') data.statement_date = `${year}-${mm}-${dd}`
  }
  if (mode === 'card') {
    const last4 = text.match(/[*×\s](\d{4})\b/) || text.match(/\b(\d{4})\b/)
    if (last4) data.card_number_last4 = last4[1]
  }
  return data
}

export function AiFillBox({ onFill, mode }: Props) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fallbackWarning, setFallbackWarning] = useState<string | null>(null)

  const handleFill = async () => {
    if (!text.trim()) {
      setError('请先粘贴需要解析的文本')
      return
    }
    setError(null)
    setFallbackWarning(null)
    setLoading(true)

    const minDelay = new Promise<void>(res => setTimeout(res, 1000))

    let result: Record<string, unknown> | null = null
    let usedFallback = false

    try {
      const parsed = await aiComplete({
        type: mode === 'bill' ? 'bill_text' : 'card_text',
        data: { text },
      })
      if (parsed) result = parsed

      if (!result || Object.keys(result).length === 0) {
        result = localExtract(text, mode)
        usedFallback = true
      }
    } catch {
      result = localExtract(text, mode)
      usedFallback = true
    }

    await minDelay
    setLoading(false)

    const cleaned: Record<string, unknown> = {}
    if (result) {
      for (const [k, v] of Object.entries(result)) {
        if (v !== null && v !== undefined && v !== '') cleaned[k] = v
      }
    }

    if (Object.keys(cleaned).length === 0) {
      setError('未能识别有效字段，请补充更完整的文本或手动填写')
      return
    }
    if (usedFallback) {
      setFallbackWarning('当前为本地规则粗提（未启用服务端 AI 解析），请仔细核对金额、币种和到期日')
    }
    onFill({ ...cleaned, _aiSource: usedFallback ? 'regex' : 'ai' })
  }

  return (
    // AI 区语义：金色虚线框 + 极淡金底
    <div className='rounded-2xl border-[1.5px] border-dashed border-d-gold bg-d-gold/5 p-1.5'>
      <div className='flex flex-col gap-2'>
        <TextArea
          rows={2}
          placeholder={PLACEHOLDER[mode]}
          value={text}
          onChange={e => setText(e.target.value)}
        />

        <div className='flex items-center'>
          <button
            type='button'
            onClick={handleFill}
            disabled={loading || !text.trim()}
            className='inline-flex h-9 items-center gap-1.5 rounded-full border border-d-gold px-3.5 text-[13px] font-semibold text-d-gold transition-colors active:bg-d-gold/10 disabled:pointer-events-none disabled:opacity-50'
          >
            {loading ? <Spinner size={16} className='border-d-gold/40 border-t-d-gold' /> : <AiSparkleIcon size={16} />}
            {loading ? '识别中…' : '智能填充'}
          </button>
        </div>

        {fallbackWarning && <Alert severity='warning'>{fallbackWarning}</Alert>}
        {error && <Alert severity='warning'>{error}</Alert>}
      </div>
    </div>
  )
}
