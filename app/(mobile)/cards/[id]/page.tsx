'use client'

import { useEffect, useState, useCallback, use } from 'react'
import { useRouter } from 'next/navigation'
import { Container, Box, Typography, Stack, IconButton, Paper, Dialog, DialogTitle, DialogContent, DialogActions, Button, TextField, MenuItem, InputAdornment, Alert } from '@mui/material'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import EditIcon from '@mui/icons-material/Edit'
import { format } from 'date-fns'
import { getCardDetail, updateCard } from '@/lib/api/cards'
import { StatusBadge } from '@/components/mobile/WcBadge'
import { WcSkeleton, WcEmptyState, WcErrorState } from '@/components/mobile/WcStates'
import { ChevronRightIcon, ClockIcon } from '@/components/icons/WcIcon'
import { getEffectiveBillingDay, getEffectiveDueConfig, formatCardTail, getEffectiveCardName, getEffectiveAnnualFee } from '@/lib/utils'
import type { CreditCard, CardProduct, CardHolder, Bill, Benefit } from '@/lib/types'

type CardDetail = CreditCard & {
  card_product: CardProduct
  card_holders?: CardHolder
}

type BillWithPaid = Bill & { paid_amount: number; computed_status: Bill['status'] }

export default function CardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()

  const [card, setCard] = useState<CardDetail | null>(null)
  const [bills, setBills] = useState<BillWithPaid[]>([])
  const [benefits, setBenefits] = useState<Array<Benefit & { used: number }>>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 编辑表单状态
  const [editOpen, setEditOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const [nameOverride, setNameOverride] = useState('')
  const [limitInput, setLimitInput] = useState('')
  const [billingDayInput, setBillingDayInput] = useState('')
  const [dueType, setDueType] = useState<'default' | 'after_billing' | 'fixed' | 'fixed_before_billing'>('default')
  const [dueValue, setDueValue] = useState('')
  const [annualFeeInput, setAnnualFeeInput] = useState('')

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // 卡 + 卡产品 + 持卡人 + 最近账单（含已还聚合）+ 权益使用进度，一次 RPC 返回
      const detail = await getCardDetail(id)
      setCard({
        ...detail.card,
        card_holders: detail.card.card_holder,
      } as unknown as CardDetail)
      setBills(detail.bills as unknown as BillWithPaid[])
      setBenefits(detail.benefits)
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载卡片失败')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const openEdit = () => {
    if (!card) return
    const product = card.card_product
    const due = getEffectiveDueConfig(card, product)
    setNameOverride(card.name_override || '')
    setLimitInput(String(Number(card.credit_limit) || 0))
    setBillingDayInput(String(getEffectiveBillingDay(card)))
    // 回填当前生效的还款规则（修改过后即是卡级覆盖，否则是产品默认）
    setDueType(card.override_due_type && card.override_due_value != null
      ? card.override_due_type
      : 'default')
    setDueValue(card.override_due_value != null
      ? String(card.override_due_value)
      : (card.override_due_type ? '' : String(due.value)))
    setAnnualFeeInput(card.annual_fee_override != null ? String(Number(card.annual_fee_override)) : '')
    setEditError(null)
    setEditOpen(true)
  }

  const handleSave = async () => {
    if (!card) return
    const day = parseInt(billingDayInput, 10)
    const limitNum = parseFloat(limitInput)
    if (isNaN(limitNum) || limitNum < 0) {
      setEditError('请输入有效的总额度')
      return
    }
    if (isNaN(day) || day < 1 || day > 31) {
      setEditError('账单日必须是 1-31 之间的数字')
      return
    }
    if (dueType !== 'default') {
      const val = parseInt(dueValue, 10)
      if (isNaN(val) || val < 1 || (dueType !== 'after_billing' && val > 31)) {
        setEditError('请输入有效的还款规则数值')
        return
      }
    }
    setSaving(true)
    setEditError(null)
    try {
      await updateCard(card.id, {
        // 卡片名称：留空恢复使用卡产品默认
        name_override: nameOverride.trim() || null,
        credit_limit: limitNum,
        // 账单日：以修改后的值为准，清除旧覆盖
        billing_day: day,
        override_billing_day: null,
        // 还款日：选「跟随卡产品」时清除覆盖，否则写入卡级覆盖（优先生效）
        override_due_type: dueType === 'default' ? null : dueType,
        override_due_value: dueType === 'default' ? null : parseInt(dueValue, 10),
        // 年费：留空恢复使用卡产品默认
        annual_fee_override: annualFeeInput.trim() === '' ? null : parseFloat(annualFeeInput),
      })
      setEditOpen(false)
      await load()
    } catch (err) {
      setEditError(err instanceof Error ? err.message : '保存失败')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ py: 2 }}>
        <HeaderBack title="卡片详情" onBack={() => router.back()} />
        <WcSkeleton height={180} count={1} />
        <WcSkeleton height={96} count={2} />
      </Container>
    )
  }

  if (error || !card) {
    return (
      <Container maxWidth="sm" sx={{ py: 2 }}>
        <HeaderBack title="卡片详情" onBack={() => router.back()} />
        <WcErrorState message={error || '卡片不存在'} onRetry={load} />
      </Container>
    )
  }

  const product = card.card_product
  const bankName = product?.bank_name || '银行卡'
  // 修改内容优先：卡级别名称覆盖 > 卡产品默认名称
  const cardName = getEffectiveCardName(card, product)
  const holderName = card.card_holders?.name
  const last4 = formatCardTail(card.card_number_last4)

  // 已用额度：SUM(bill_amount - paid) WHERE status != paid
  const used = bills
    .filter(b => b.computed_status !== 'paid')
    .reduce((s, b) => s + Math.max(0, Number(b.bill_amount) - b.paid_amount), 0)
  const limit = Number(card.credit_limit) || 0
  const available = Math.max(0, limit - used)

  const billingDay = getEffectiveBillingDay(card)
  const dueConfig = getEffectiveDueConfig(card, product)
  const dueDayOfMonth =
    card.loan_due_day ??
    (dueConfig.type !== 'after_billing' ? dueConfig.value : null)
  const grace = billingDay && dueDayOfMonth ? Math.max(0, dueDayOfMonth - billingDay) : null
  // 修改内容优先：卡级别年费覆盖 > 卡产品默认
  const annualFee = getEffectiveAnnualFee(card, product)
  const currency = product?.currency || 'CNY'
  // 是否存在卡级别自定义（展示「已自定义」徽标）
  const isNameOverridden = !!card.name_override
  const isDueOverridden = card.override_due_type != null && card.override_due_value != null
  const isAnnualFeeOverridden = card.annual_fee_override != null

  return (
    <Container maxWidth="sm" sx={{ py: 2, pb: 10 }}>
      <HeaderBack title="卡片详情" onBack={() => router.back()} />

      {/* 卡面：深蓝渐变 + 卡种名 + 掩码卡号 + 持卡人 + 金色装饰 */}
      <Box
        sx={{
          position: 'relative',
          background: 'linear-gradient(135deg, var(--navy-800), var(--navy-600))',
          borderRadius: 'var(--radius-depth-3)',
          p: 2.25,
          mb: 1.5,
          color: 'var(--text-on-dark)',
          overflow: 'hidden',
          minHeight: 150,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          // 深蓝渐变主卡：品牌暗影，不走中性分层
          boxShadow: 'var(--shadow-dark)',
        }}
      >
        {/* 金色半透明圆形装饰 */}
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute', right: -36, top: -36,
            width: 140, height: 140, borderRadius: '50%',
            // 品牌金装饰：用 color-mix 从 --gold-500 派生透明度，不散落字面色值
            background: 'radial-gradient(circle, color-mix(in srgb, var(--gold-500) 45%, transparent), transparent)',
          }}
        />
        <Box
          aria-hidden="true"
          sx={{
            position: 'absolute', right: 18, bottom: -50,
            width: 110, height: 110, borderRadius: '50%',
            border: '1px solid color-mix(in srgb, var(--gold-500) 35%, transparent)',
          }}
        />
        <Stack direction="row" justifyContent="space-between" alignItems="flex-start" sx={{ position: 'relative', zIndex: 1 }}>
          <Box>
            <Typography
              sx={{
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                color: 'rgba(255,255,255,0.78)',
              }}
            >
              {bankName}
            </Typography>
            <Typography
              sx={{
                fontSize: 'var(--type-section-size)',
                lineHeight: 'var(--type-section-line)',
                fontWeight: 'var(--type-section-weight)',
                letterSpacing: 'var(--type-section-tracking)',
                color: 'var(--text-on-dark)',
                mt: 0.25,
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
              }}
            >
              {cardName}
              {isNameOverridden && (
                <Box
                  component="span"
                  sx={{
                    fontSize: 10,
                    lineHeight: 1,
                    px: 0.5,
                    py: 0.25,
                    borderRadius: 'var(--radius-pill)',
                    bgcolor: 'rgba(255,255,255,0.18)',
                    color: 'var(--text-on-dark)',
                    fontWeight: 600,
                  }}
                >
                  已自定义
                </Box>
              )}
            </Typography>
          </Box>
          {card.status !== 'active' && (
            <Box
              sx={{
                bgcolor: 'rgba(255,255,255,0.16)',
                px: 1,
                py: 0.25,
                borderRadius: 'var(--radius-pill)',
                fontSize: 'var(--type-body-size)',
                lineHeight: 'var(--type-body-line)',
                letterSpacing: 'var(--type-body-tracking)',
                fontWeight: 600,
              }}
            >
              {card.status === 'frozen' ? '已冻结' : '已注销'}
            </Box>
          )}
        </Stack>
        <Box sx={{ position: 'relative', zIndex: 1 }}>
          <Typography className="num-tabular" sx={{ fontSize: 17, letterSpacing: '0.08em', mb: 0.5 }}>
            ****&nbsp;****&nbsp;****&nbsp;{last4 || '----'}
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'rgba(255,255,255,0.82)',
            }}
          >
            {holderName || '—'} · {card.card_type === 'loan' ? '贷款类' : '信用卡'}
          </Typography>
        </Box>
      </Box>

      {/* 额度三格 */}
      <Box
        sx={{
          display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 0.5,
          // 无边框：分层阴影表达层级
          bgcolor: 'var(--paper)', border: 0, borderRadius: 'var(--radius-depth-2)',
          boxShadow: 'var(--shadow-e1)',
          p: 1.5, mb: 1.5,
        }}
      >
        <Quota label="总额度" value={limit} color="var(--strong)" />
        <Quota label="已用" value={used} color="var(--gold-700)" />
        <Quota label="可用" value={available} color="var(--success)" />
      </Box>

      {/* 日期与费用 */}
      <Section
        title="日期与费用"
        action={
          <IconButton
            onClick={openEdit}
            aria-label="编辑卡片"
            size="small"
            sx={{ color: 'var(--muted)', p: 0.5 }}
          >
            <EditIcon sx={{ fontSize: 16 }} />
          </IconButton>
        }
      >
        <Stack spacing={0.75}>
          <Row label="账单日" value={billingDay ? `每月 ${billingDay} 日` : '—'} />
          <Row
            label="还款日"
            value={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                {dueDayOfMonth ? `每月 ${dueDayOfMonth} 日` : (card.loan_due_day ? `每月 ${card.loan_due_day} 日` : (dueConfig.type === 'after_billing' ? `账单日后 ${dueConfig.value} 天` : '—'))}
                {isDueOverridden && <CustomizedTag />}
              </Box>
            }
          />
          <Row
            label="最长免息"
            value={
              grace != null ? (
                <Box component="span" sx={{ color: 'var(--gold-700)', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 0.25 }}>
                  <ClockIcon size={12} /> {grace} 天
                </Box>
              ) : '—'
            }
          />
          <Row
            label="年费"
            value={
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                {annualFee != null ? `¥${annualFee.toLocaleString()}` : '—'}
                {isAnnualFeeOverridden && <CustomizedTag />}
              </Box>
            }
          />
          <Row label="币种" value={currency} />
        </Stack>
      </Section>

      {/* 编辑卡片对话框：保存后卡级别内容优先于卡产品默认 */}
      <Dialog open={editOpen} onClose={() => !saving && setEditOpen(false)} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: 'var(--radius-depth-2)' } }}>
        <DialogTitle sx={{ fontWeight: 700, fontSize: 'var(--type-section-size)' }}>编辑卡片</DialogTitle>
        <DialogContent>
          {editError && <Alert severity="error" sx={{ mb: 2 }}>{editError}</Alert>}
          <Stack spacing={2} sx={{ mt: 0.5 }}>
            <TextField
              label="卡片名称"
              placeholder={product?.card_name || '输入卡片名称'}
              value={nameOverride}
              onChange={e => setNameOverride(e.target.value)}
              helperText={product?.card_name ? `留空则使用卡产品默认名称「${product.card_name}」` : ' '}
              fullWidth
            />
            <TextField
              label="总额度"
              type="number"
              value={limitInput}
              onChange={e => setLimitInput(e.target.value)}
              required
              fullWidth
              InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
            />
            <TextField
              label="账单日"
              type="number"
              value={billingDayInput}
              onChange={e => setBillingDayInput(e.target.value)}
              required
              helperText="每月出账日期（1-31）"
              fullWidth
              inputProps={{ min: 1, max: 31 }}
              InputProps={{ endAdornment: <InputAdornment position="end">日</InputAdornment> }}
            />
            <TextField
              select
              label="还款日规则"
              value={dueType}
              onChange={e => setDueType(e.target.value as typeof dueType)}
              helperText="修改后以此规则优先计算各期账单还款日"
              fullWidth
            >
              <MenuItem value="default" disabled={!product}>
                跟随卡产品默认
                {product ? `（${product.payment_due_type === 'after_billing' ? `账单日后 ${product.payment_due_value} 天` : `每月 ${product.payment_due_value} 日`}）` : ''}
              </MenuItem>
              <MenuItem value="after_billing">账单日后 X 天</MenuItem>
              <MenuItem value="fixed">每月固定还款日</MenuItem>
              <MenuItem value="fixed_before_billing">每月固定还款日（账单日倒推）</MenuItem>
            </TextField>
            {dueType !== 'default' && (
              <TextField
                label={dueType === 'after_billing' ? '账单日后天数' : '每月还款日'}
                type="number"
                value={dueValue}
                onChange={e => setDueValue(e.target.value)}
                required
                fullWidth
                inputProps={dueType === 'after_billing' ? { min: 1 } : { min: 1, max: 31 }}
                InputProps={{ endAdornment: <InputAdornment position="end">{dueType === 'after_billing' ? '天' : '日'}</InputAdornment> }}
              />
            )}
            <TextField
              label="年费"
              type="number"
              value={annualFeeInput}
              onChange={e => setAnnualFeeInput(e.target.value)}
              helperText={product?.annual_fee != null && Number(product.annual_fee) > 0 ? `留空则使用卡产品默认年费 ¥${Number(product.annual_fee).toLocaleString()}` : '留空表示无年费'}
              fullWidth
              InputProps={{ startAdornment: <InputAdornment position="start">¥</InputAdornment> }}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 0 }}>
          <Button onClick={() => setEditOpen(false)} disabled={saving} sx={{ color: 'var(--muted)' }}>取消</Button>
          <Button onClick={handleSave} disabled={saving} variant="contained">{saving ? '保存中…' : '保存'}</Button>
        </DialogActions>
      </Dialog>

      {/* 最近账单 */}
      <Section title="最近账单">
        {bills.length === 0 ? (
          <WcEmptyState title="暂无账单" description="这张卡还没有录入账单" />
        ) : (
          <Stack spacing={1}>
            {bills.map(b => (
              <Box
                key={b.id}
                component="button"
                onClick={() => router.push(`/bills/${b.id}`)}
                sx={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', border: 0, bgcolor: 'var(--paper)',
                  cursor: 'pointer', p: 1.25, borderRadius: 'var(--radius-depth-1)', textAlign: 'left',
                  boxShadow: 'var(--shadow-e1)',
                  transition: 'box-shadow var(--dur-fast) ease',
                  '&:hover': { boxShadow: 'var(--shadow-e2)' },
                  '&:focus-visible': { outline: '2px solid var(--navy-600)', outlineOffset: -2 },
                }}
              >
                <Box>
                  <Typography
                    sx={{
                      fontSize: 'var(--type-body-size)',
                      lineHeight: 'var(--type-body-line)',
                      letterSpacing: 'var(--type-body-tracking)',
                      color: 'var(--muted)',
                    }}
                  >
                    {b.bill_month} 账单
                  </Typography>
                  <Typography className="num-tabular" sx={{ fontSize: 16, fontWeight: 700, color: 'var(--strong)', mt: 0.25 }}>
                    ¥{Number(b.bill_amount).toLocaleString()}
                  </Typography>
                  <Typography
                    sx={{
                      fontSize: 'var(--type-body-size)',
                      lineHeight: 'var(--type-body-line)',
                      letterSpacing: 'var(--type-body-tracking)',
                      color: 'var(--muted)',
                      mt: 0.25,
                    }}
                  >
                    到期 {format(new Date(b.due_date), 'yyyy-MM-dd')}
                  </Typography>
                </Box>
                <Stack direction="row" alignItems="center" spacing={1}>
                  <StatusBadge status={b.computed_status} />
                  <ChevronRightIcon size={16} />
                </Stack>
              </Box>
            ))}
          </Stack>
        )}
      </Section>

      {/* 权益进度（如无数据则省略） */}
      {benefits.length > 0 && (
        <Section title="权益进度">
          <Stack spacing={1.25}>
            {benefits.map(b => {
              const pct = b.quota > 0 ? Math.min(100, Math.round((b.used / b.quota) * 100)) : 0
              const over = b.used >= b.quota
              return (
                <Box key={b.id}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography
                      sx={{
                        fontSize: 'var(--type-body-size)',
                        lineHeight: 'var(--type-body-line)',
                        letterSpacing: 'var(--type-body-tracking)',
                        fontWeight: 600,
                        color: 'var(--text)',
                      }}
                    >
                      {b.name}
                    </Typography>
                    <Typography className="num-tabular" sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', color: over ? 'var(--danger)' : 'var(--muted)', fontWeight: 600 }}>
                      {b.used}/{b.quota}
                    </Typography>
                  </Stack>
                  <Box sx={{ height: 6, borderRadius: 'var(--radius-pill)', bgcolor: 'rgba(10,31,68,0.08)', overflow: 'hidden' }}>
                    {/* 进度填充用 transform 而非 width，避免布局抖动 */}
                    <Box
                      sx={{
                        height: '100%',
                        width: '100%',
                        transform: `scaleX(${Math.min(1, pct / 100)})`,
                        transformOrigin: 'left center',
                        bgcolor: over ? 'var(--danger)' : 'var(--gold-500)',
                        borderRadius: 'var(--radius-pill)',
                        transition: 'transform var(--dur-fast) ease',
                      }}
                    />
                  </Box>
                  {b.description && (
                    <Typography
                      sx={{
                        fontSize: 'var(--type-body-size)',
                        lineHeight: 'var(--type-body-line)',
                        letterSpacing: 'var(--type-body-tracking)',
                        color: 'var(--muted)',
                        mt: 0.25,
                      }}
                    >
                      {b.description}
                    </Typography>
                  )}
                </Box>
              )
            })}
          </Stack>
        </Section>
      )}
    </Container>
  )
}

function HeaderBack({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1.5 }}>
      <IconButton
        onClick={onBack}
        aria-label="返回"
        sx={{
          width: 'var(--button-size)',
          height: 'var(--button-size)',
          background: 'var(--button-face)',
          color: 'var(--text-on-dark)',
          boxShadow: 'var(--button-shadow)',
          '&:hover': { background: 'var(--button-face)', boxShadow: 'var(--shadow-e2)' },
          '&:active': { boxShadow: 'var(--button-shadow-press)' },
        }}
      >
        <ArrowBackIcon />
      </IconButton>
      <Typography
        variant="h6"
        sx={{
          fontSize: 'var(--type-section-size)',
          lineHeight: 'var(--type-section-line)',
          fontWeight: 'var(--type-section-weight)',
          letterSpacing: 'var(--type-section-tracking)',
          color: 'var(--text)',
        }}
      >
        {title}
      </Typography>
    </Stack>
  )
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Box sx={{ mb: 1.5 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
        <Typography
          sx={{
            fontSize: 'var(--type-section-size)',
            lineHeight: 'var(--type-section-line)',
            fontWeight: 'var(--type-section-weight)',
            letterSpacing: 'var(--type-section-tracking)',
            color: 'var(--text)',
          }}
        >
          {title}
        </Typography>
        {action}
      </Stack>
      <Paper
        elevation={0}
        sx={{ p: 1.5, border: 0, borderRadius: 'var(--radius-depth-2)', boxShadow: 'var(--shadow-e2)' }}
      >
        {children}
      </Paper>
    </Box>
  )
}

/** 「已自定义」小徽标：标记该字段为卡级别覆盖值 */
function CustomizedTag() {
  return (
    <Box
      component="span"
      sx={{
        fontSize: 10,
        lineHeight: 1,
        px: 0.5,
        py: 0.25,
        borderRadius: 'var(--radius-pill)',
        bgcolor: 'rgba(10,31,68,0.06)',
        color: 'var(--muted)',
        fontWeight: 600,
      }}
    >
      已自定义
    </Box>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="center">
      <Typography
        sx={{
          fontSize: 'var(--type-body-size)',
          lineHeight: 'var(--type-body-line)',
          letterSpacing: 'var(--type-body-tracking)',
          color: 'var(--muted)',
        }}
      >
        {label}
      </Typography>
      <Typography className="num-tabular" sx={{ fontSize: 'var(--type-body-size)', letterSpacing: 'var(--type-body-tracking)', fontWeight: 600, color: 'var(--text)' }}>
        {value}
      </Typography>
    </Stack>
  )
}

function Quota({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <Box sx={{ textAlign: 'center' }}>
      <Typography
        sx={{
          fontSize: 'var(--type-body-size)',
          lineHeight: 'var(--type-body-line)',
          letterSpacing: 'var(--type-body-tracking)',
          color: 'var(--muted)',
          mb: 0.25,
        }}
      >
        {label}
      </Typography>
      <Typography className="num-tabular" sx={{ fontSize: 15, fontWeight: 700, color }}>
        ¥{Number(value).toLocaleString()}
      </Typography>
    </Box>
  )
}
