'use client'

import { useState } from 'react'
import { Box, Button, TextField, CircularProgress, Alert, Stack } from '@mui/material'
import { AiSparkleIcon } from '@/components/icons/WcIcon'
import { getSystemSettings } from '@/lib/api/admin'

/**
 * AI 智能填充盒（§5.3）。
 * 内嵌于表单顶部：虚线金框 + 文本框 + 智能填充按钮。
 * 解析成功 → onFill(data)；失败 → 正则本地兜底；都失败 → 显示错误。
 *
 * 数据策略：AI 仅预填，父表单收到后视为 manual 来源。
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

const BILL_SYSTEM_PROMPT = `你是信用卡账单解析助手。从用户粘贴的账单邮件或短信文本中提取以下字段，严格以 JSON 返回，不要任何多余文字：
{
  "bill_amount": 数字或null,
  "min_payment": 数字或null,
  "due_date": "YYYY-MM-DD"或null,
  "bill_month": "YYYY-MM"或null,
  "statement_date": "YYYY-MM-DD"或null
}
注意：金额可能是"6480"、"6,480.00"、"¥6480元"，统一转为数字。无法确定的字段返回 null。`

const CARD_SYSTEM_PROMPT = `你是信用卡产品信息解析助手。从用户粘贴的卡面或官网文本中提取以下字段，严格以 JSON 返回，不要任何多余文字：
{
  "bank_name": 字符串或null,
  "card_name": 字符串或null,
  "annual_fee": 数字或null,
  "billing_day": 数字或null,
  "card_number_last4": 字符串或null
}
无法确定的字段返回 null。`

/** 本地正则兜底解析（无 AI key 时使用） */
function localExtract(text: string, mode: Props['mode']): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  const amounts = [...text.matchAll(/(\d[\d,]*\.?\d*)\s*[元¥]|¥\s*(\d[\d,]*\.?\d*)/g)]
    .map(m => (m[1] || m[2]).replace(/,/g, ''))
    .map(Number)
    .filter(n => !isNaN(n) && n > 0)
  if (amounts.length > 0) {
    data.bill_amount = amounts[0]
    if (amounts.length > 1) data.min_payment = amounts[amounts.length - 1]
  }
  const dateMatch = text.match(/(\d{1,2})\s*月\s*(\d{1,2})\s*日/)
  if (dateMatch) {
    const now = new Date()
    const month = parseInt(dateMatch[1])
    const day = parseInt(dateMatch[2])
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

function safeJsonParse(content: string): Record<string, unknown> | null {
  try {
    return JSON.parse(content)
  } catch {
    const match = content.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        return JSON.parse(match[0])
      } catch {
        return null
      }
    }
    return null
  }
}

export function AiFillBox({ onFill, mode }: Props) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFill = async () => {
    if (!text.trim()) {
      setError('请先粘贴需要解析的文本')
      return
    }
    setError(null)
    setLoading(true)

    // 规范要求 1s loading 视觉，与 AI 实际耗时取较大者
    const minDelay = new Promise<void>(res => setTimeout(res, 1000))

    let result: Record<string, unknown> | null = null
    let usedFallback = false

    try {
      const settings = await getSystemSettings()
      const apiKey = settings.ai_api_key as string | undefined
      const baseURL = (settings.ai_base_url as string) || 'https://api.openai.com/v1'
      const model = (settings.ai_model as string) || 'gpt-4o'

      if (apiKey) {
        const res = await fetch(`${baseURL.replace(/\/$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: 'system', content: mode === 'bill' ? BILL_SYSTEM_PROMPT : CARD_SYSTEM_PROMPT },
              { role: 'user', content: text },
            ],
            temperature: 0.2,
            response_format: { type: 'json_object' },
          }),
        })
        if (res.ok) {
          const ai = await res.json()
          const content = ai?.choices?.[0]?.message?.content
          if (content) result = safeJsonParse(content)
        }
      }

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
    onFill({ ...cleaned, _aiSource: usedFallback ? 'regex' : 'ai' })
  }

  return (
    <Box
      sx={{
        // AI 区语义：金色虚线框（非分层边框），圆角走令牌
        border: '1.5px dashed var(--gold-500)',
        bgcolor: 'rgba(201,162,39,0.04)',
        borderRadius: 'var(--radius-depth-2)',
        boxShadow: 'var(--shadow-e1)',
        p: 1.5,
      }}
    >
      <Stack spacing={1.25}>
        <TextField
          multiline
          minRows={2}
          maxRows={5}
          fullWidth
          size="small"
          placeholder={PLACEHOLDER[mode]}
          value={text}
          onChange={e => setText(e.target.value)}
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: 'var(--paper)',
              fontSize: 'var(--type-control-size)',
            },
          }}
        />

        <Stack direction="row" spacing={1} alignItems="center">
          <Button
            variant="outlined"
            size="small"
            onClick={handleFill}
            disabled={loading || !text.trim()}
            startIcon={
              loading ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <AiSparkleIcon size={16} />
              )
            }
            sx={{
              borderRadius: 'var(--radius-pill)',
              borderColor: 'var(--gold-500)',
              color: 'var(--gold-700)',
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': {
                borderColor: 'var(--gold-700)',
                bgcolor: 'rgba(201,162,39,0.08)',
              },
            }}
          >
            {loading ? '识别中…' : '智能填充'}
          </Button>
        </Stack>

        {error && (
          <Alert
            severity="warning"
            sx={{
              py: 0.5,
              fontSize: 'var(--type-body-size)',
              letterSpacing: 'var(--type-body-tracking)',
              lineHeight: 'var(--type-body-line)',
              '& .MuiAlert-message': {
                fontSize: 'var(--type-body-size)',
                letterSpacing: 'var(--type-body-tracking)',
                lineHeight: 'var(--type-body-line)',
              },
            }}
          >
            {error}
          </Alert>
        )}
      </Stack>
    </Box>
  )
}
