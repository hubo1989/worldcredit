'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, MenuItem, Stack, Typography,
  InputAdornment, Box, ToggleButton, ToggleButtonGroup,
  FormControlLabel, Switch, Divider
} from '@mui/material'
import type { CreditCard, CardProduct } from '@/lib/types'
import { getCardProducts } from '@/lib/api/cards'
import { AiFillBox } from '@/components/mobile/AiFillBox'

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: Omit<CreditCard, 'id' | 'created_at'>) => Promise<void>
  holderId: string
  initial?: CreditCard
}

type DueType = 'after_billing' | 'fixed' | 'fixed_before_billing'

const DUE_TYPE_LABELS: Record<DueType, string> = {
  after_billing: '账单日后 X 天',
  fixed: '每月固定还款日',
  fixed_before_billing: '每月固定还款日（账单日倒推）',
}

// MUI Typography 自带样式注入在 globals.css 之后，同特异性下角色 class 会被覆盖，
// 因此排版令牌直接写进 sx。
const BODY = {
  fontSize: 'var(--type-body-size)',
  lineHeight: 'var(--type-body-line)',
  fontWeight: 'var(--type-body-weight)',
  letterSpacing: 'var(--type-body-tracking)',
}

export function CardForm({ open, onClose, onSubmit, holderId, initial }: Props) {
  const [products, setProducts] = useState<CardProduct[]>([])
  const [selectedBank, setSelectedBank] = useState('')
  const [productId, setProductId] = useState(initial?.card_product_id ?? '')
  const [last4, setLast4] = useState(initial?.card_number_last4 ?? '')
  const [limit, setLimit] = useState(initial?.credit_limit.toString() ?? '')
  const [billingDay, setBillingDay] = useState(initial?.billing_day.toString() ?? '')
  const [submitting, setSubmitting] = useState(false)

  // 卡类型
  const [cardType, setCardType] = useState<'credit' | 'loan'>(initial?.card_type ?? 'credit')

  // 贷款类
  const [loanDueDay, setLoanDueDay] = useState(initial?.loan_due_day?.toString() ?? '')

  // 还款规则覆盖
  const [overrideEnabled, setOverrideEnabled] = useState(
    !!(initial?.override_due_type || initial?.override_billing_day)
  )
  const [overrideBillingDay, setOverrideBillingDay] = useState(
    initial?.override_billing_day?.toString() ?? ''
  )
  const [overrideDueType, setOverrideDueType] = useState<DueType>(
    (initial?.override_due_type as DueType) ?? 'after_billing'
  )
  const [overrideDueValue, setOverrideDueValue] = useState(
    initial?.override_due_value?.toString() ?? ''
  )

  useEffect(() => {
    getCardProducts().then(setProducts)
  }, [])

  // 提取所有的银行选项
  const bankOptions = Array.from(new Set(products.map(p => p.bank_name))).filter(Boolean)

  // 当前银行下的卡产品列表
  const availableProducts = selectedBank 
    ? products.filter(p => p.bank_name === selectedBank)
    : products

  useEffect(() => {
    if (initial && products.length > 0) {
      const match = products.find(p => p.id === initial.card_product_id)
      if (match) {
        setSelectedBank(match.bank_name)
      }
      setProductId(initial.card_product_id)
      setLast4(initial.card_number_last4 ?? '')
      setLimit(initial.credit_limit.toString())
      setBillingDay(initial.billing_day.toString())
      setCardType(initial.card_type ?? 'credit')
      setLoanDueDay(initial.loan_due_day?.toString() ?? '')
      setOverrideEnabled(!!(initial.override_due_type || initial.override_billing_day))
      setOverrideBillingDay(initial.override_billing_day?.toString() ?? '')
      setOverrideDueType((initial.override_due_type as DueType) ?? 'after_billing')
      setOverrideDueValue(initial.override_due_value?.toString() ?? '')
    } else if (!initial) {
      setSelectedBank('')
      setProductId('')
      setLast4('')
      setLimit('')
      setBillingDay('')
      setCardType('credit')
      setLoanDueDay('')
      setOverrideEnabled(false)
      setOverrideBillingDay('')
      setOverrideDueType('after_billing')
      setOverrideDueValue('')
    }
  }, [initial, open, products])

  const handleBankChange = (bank: string) => {
    setSelectedBank(bank)
    const filtered = products.filter(p => p.bank_name === bank)
    if (filtered.length > 0) {
      setProductId(filtered[0].id)
    } else {
      setProductId('')
    }
  }

  const isCredit = cardType === 'credit'
  const isLoan = cardType === 'loan'

  // 信用卡模式校验
  const creditValid = !!selectedBank && !!productId && !!limit && !!billingDay
  // 贷款类模式校验（产品和还款日必填，额度选填）
  const loanValid = !!selectedBank && !!productId && !!loanDueDay

  const canSubmit = isCredit ? creditValid : loanValid

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const base: Omit<CreditCard, 'id' | 'created_at'> = {
        holder_id: holderId,
        card_product_id: productId,
        card_number_last4: last4 || undefined,
        credit_limit: limit ? parseFloat(limit) : 0,
        billing_day: billingDay ? parseInt(billingDay) : 1,
        status: 'active',
        card_type: cardType,
        loan_due_day: isLoan && loanDueDay ? parseInt(loanDueDay) : undefined,
        override_billing_day: overrideEnabled && overrideBillingDay ? parseInt(overrideBillingDay) : undefined,
        override_due_type: overrideEnabled ? overrideDueType : null,
        override_due_value: overrideEnabled && overrideDueValue ? parseInt(overrideDueValue) : undefined,
      }

      await onSubmit(base)
      onClose()
    } catch (err: unknown) {
      console.error(err)
      const message = err instanceof Error ? err.message : JSON.stringify(err)
      alert('保存卡片失败: ' + message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      // 弹窗浮层：18px 圆角 + float 阴影 + 无边框
      slotProps={{
        paper: {
          sx: {
            border: 0,
            borderRadius: 'var(--radius-depth-3)',
            boxShadow: 'var(--shadow-float)',
          },
        },
      }}
    >
      {/* 弹窗标题：22/28 · 600 · -0.7px */}
      <DialogTitle
        sx={{
          fontSize: 'var(--type-title-size)',
          lineHeight: 'var(--type-title-line)',
          fontWeight: 'var(--type-title-weight)',
          letterSpacing: 'var(--type-title-tracking)',
          color: 'var(--text)',
        }}
      >
        {initial ? '编辑卡片' : '添加卡片'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <AiFillBox mode="card" onFill={(data) => {
            if (data.bank_name) setSelectedBank(String(data.bank_name))
            if (data.card_number_last4) setLast4(String(data.card_number_last4))
            if (data.billing_day) {
              const d = String(data.billing_day).replace(/\D/g, '')
              if (d) setBillingDay(d)
            }
            if (data.card_name) {
              const match = products.find(p => p.card_name === data.card_name || p.card_name.includes(String(data.card_name)))
              if (match) {
                setSelectedBank(match.bank_name)
                setProductId(match.id)
              }
            }
          }} />

          {/* 卡类型选择 */}
          <Box>
            {/* 分组小标题：19/24 · 600 · -0.6px，次要色 */}
            <Typography
              sx={{
                fontSize: 'var(--type-section-size)',
                lineHeight: 'var(--type-section-line)',
                fontWeight: 'var(--type-section-weight)',
                letterSpacing: 'var(--type-section-tracking)',
                color: 'var(--muted)',
                mb: 0.5,
                display: 'block',
              }}
            >
              卡类型
            </Typography>
            <ToggleButtonGroup
              value={cardType}
              exclusive
              onChange={(_, val) => { if (val) setCardType(val) }}
              size="small"
              fullWidth
            >
              <ToggleButton value="credit">信用卡</ToggleButton>
              <ToggleButton value="loan">贷款类</ToggleButton>
            </ToggleButtonGroup>
          </Box>

          {/* 发卡银行选择 */}
          <TextField
            select
            fullWidth
            label="发卡银行 *"
            value={selectedBank}
            onChange={e => handleBankChange(e.target.value)}
            required
          >
            {bankOptions.map(bank => (
              <MenuItem key={bank} value={bank}>
                {bank}
              </MenuItem>
            ))}
          </TextField>

          {/* 卡片名称选择 */}
          <TextField
            select
            fullWidth
            label="卡片名称 *"
            value={productId}
            onChange={e => setProductId(e.target.value)}
            disabled={!selectedBank}
            required
            helperText={!selectedBank ? '请先选择发卡银行' : undefined}
          >
            {availableProducts.map(p => (
              <MenuItem key={p.id} value={p.id}>
                {p.card_name}
              </MenuItem>
            ))}
          </TextField>

          {/* ---- 信用卡模式 ---- */}
          {isCredit && (
            <>
              <TextField
                fullWidth
                label="额度"
                type="number"
                placeholder="例如：50000"
                value={limit}
                onChange={e => setLimit(e.target.value)}
                required
                InputProps={{
                  startAdornment: <InputAdornment position="start">¥</InputAdornment>,
                }}
              />

              <TextField
                fullWidth
                label="账单日"
                type="number"
                placeholder="1-31 之间的数字"
                value={billingDay}
                onChange={e => setBillingDay(e.target.value)}
                required
                helperText="每个月生成账单的日期"
                InputProps={{
                  endAdornment: <InputAdornment position="end">日</InputAdornment>,
                }}
              />

              {/* 还款规则覆盖 */}
              <Box>
                <FormControlLabel
                  control={
                    <Switch
                      checked={overrideEnabled}
                      onChange={e => setOverrideEnabled(e.target.checked)}
                      size="small"
                    />
                  }
                  label={
                    <Typography sx={{ ...BODY, color: 'var(--text)' }}>
                      覆盖卡产品默认还款规则
                    </Typography>
                  }
                />
              </Box>

              {overrideEnabled && (
                // 分组缩进线：1px var(--track)
                <Stack spacing={2} className="track-left" sx={{ pl: 1 }}>
                  <TextField
                    fullWidth
                    label="账单日（覆盖）"
                    type="number"
                    placeholder="留空则使用上方账单日"
                    value={overrideBillingDay}
                    onChange={e => setOverrideBillingDay(e.target.value)}
                    helperText="可选，覆盖卡产品的默认账单日"
                    InputProps={{
                      endAdornment: <InputAdornment position="end">日</InputAdornment>,
                    }}
                  />

                  <TextField
                    select
                    fullWidth
                    label="还款规则"
                    value={overrideDueType}
                    onChange={e => setOverrideDueType(e.target.value as DueType)}
                  >
                    {(Object.keys(DUE_TYPE_LABELS) as DueType[]).map(t => (
                      <MenuItem key={t} value={t}>{DUE_TYPE_LABELS[t]}</MenuItem>
                    ))}
                  </TextField>

                  <TextField
                    fullWidth
                    label={overrideDueType === 'after_billing' ? '天数' : '还款日'}
                    type="number"
                    placeholder={overrideDueType === 'after_billing' ? '例如：20' : '1-31'}
                    value={overrideDueValue}
                    onChange={e => setOverrideDueValue(e.target.value)}
                    InputProps={{
                      endAdornment: (
                        <InputAdornment position="end">
                          {overrideDueType === 'after_billing' ? '天' : '日'}
                        </InputAdornment>
                      ),
                    }}
                  />
                </Stack>
              )}
            </>
          )}

          {/* ---- 贷款类模式 ---- */}
          {isLoan && (
            <>
              <TextField
                fullWidth
                label="每月还款日"
                type="number"
                placeholder="1-31 之间的数字"
                value={loanDueDay}
                onChange={e => setLoanDueDay(e.target.value)}
                required
                helperText="每个月固定还款日期"
                InputProps={{
                  endAdornment: <InputAdornment position="end">日</InputAdornment>,
                }}
              />

              <TextField
                fullWidth
                label="贷款金额"
                type="number"
                placeholder="选填"
                value={limit}
                onChange={e => setLimit(e.target.value)}
                InputProps={{
                  startAdornment: <InputAdornment position="start">¥</InputAdornment>,
                }}
                helperText="选填，贷款总金额"
              />
            </>
          )}

          {/* 分隔线：1px var(--track) */}
          <Divider sx={{ borderColor: 'var(--track)' }} />

          {/* 卡号末4位（通用） */}
          <TextField
            fullWidth
            label="卡号末4位"
            placeholder="选填"
            value={last4}
            onChange={e => setLast4(e.target.value)}
            inputProps={{ maxLength: 6 }}
          />

        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2, pt: 0 }}>
        <Button onClick={onClose} color="inherit" sx={{ borderRadius: 'var(--radius-pill)' }}>取消</Button>
        <Button
          variant="contained"
          onClick={handleSubmit}
          disabled={submitting || !canSubmit}
          sx={{ borderRadius: 'var(--radius-pill)' }}
        >
          {submitting ? '保存中...' : '保存'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
