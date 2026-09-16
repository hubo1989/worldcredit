'use client'

import { Box, Stack, Typography, Paper, Button, IconButton } from '@mui/material'
import { Add as AddIcon, Edit as EditIcon } from '@mui/icons-material'
import { categoryLabel, type PayableWithStatus } from '@/lib/api/payables'
import { currencySymbol } from '@/lib/fx'
import { ClockIcon, ChevronRightIcon } from '@/components/icons/WcIcon'

interface Props {
  payables: PayableWithStatus[]
  onAdd: () => void
  onEdit: (payable: PayableWithStatus) => void
  onPay: (payable: PayableWithStatus) => void
}

/**
 * 固定支出（房租 / 贷款等按月应付）。
 *
 * 与上方卡账分节展示：它们的到期与还款规则不同（没有免息期、没有额度），
 * 混在一张卡里会让两套口径互相污染。
 */
export function PayableList({ payables, onAdd, onEdit, onPay }: Props) {
  return (
    <Box sx={{ mb: 2.5 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.25 }}>
        <Typography
          sx={{
            fontSize: 'var(--type-section-size)',
            lineHeight: 'var(--type-section-line)',
            letterSpacing: 'var(--type-section-tracking)',
            fontWeight: 'var(--type-section-weight)',
            color: 'var(--text)',
          }}
        >
          固定支出
        </Typography>
        <Button
          size="small"
          startIcon={<AddIcon fontSize="small" />}
          onClick={onAdd}
          sx={{
            textTransform: 'none',
            fontWeight: 600,
            fontSize: 14.5,
            lineHeight: '18px',
            color: 'var(--strong)',
            borderRadius: 'var(--radius-pill)',
            px: 1.25,
          }}
        >
          添加
        </Button>
      </Stack>

      {payables.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            p: 2,
            bgcolor: 'var(--paper)',
            border: 0,
            borderRadius: 'var(--radius-depth-2)',
            boxShadow: 'var(--shadow-e1)',
            textAlign: 'center',
          }}
        >
          <Typography sx={{ fontSize: 'var(--type-body-size)', lineHeight: 'var(--type-body-line)', letterSpacing: 'var(--type-body-tracking)', color: 'var(--muted)' }}>
            还没有固定支出。房租、贷款这类每月固定要付的可以加在这里。
          </Typography>
        </Paper>
      ) : (
        <Stack spacing={1.5}>
          {payables.map(p => {
            const paid = p.status === 'paid'
            const overdue = p.status === 'overdue'
            const label = overdue
              ? `已逾期 ${Math.abs(p.days_until_due)} 天`
              : p.days_until_due === 0
                ? '今天应付'
                : `距离应付日 ${p.days_until_due} 天`
            return (
              <Paper
                key={p.id}
                elevation={0}
                sx={{
                  p: 2,
                  bgcolor: 'var(--paper)',
                  border: 0,
                  borderRadius: 'var(--radius-depth-2)',
                  boxShadow: 'var(--shadow-e1)',
                }}
              >
                <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
                  <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ minWidth: 0 }}>
                      <Typography
                        noWrap
                        sx={{
                          fontSize: 'var(--type-section-size)',
                          lineHeight: 'var(--type-section-line)',
                          letterSpacing: 'var(--type-section-tracking)',
                          fontWeight: 'var(--type-section-weight)',
                          color: 'var(--text)',
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                      >
                        {p.name}
                      </Typography>
                      <Typography component="span" sx={{ flexShrink: 0, fontSize: 14.5, lineHeight: '18px', letterSpacing: '0.3px', color: 'var(--muted)' }}>
                        · {categoryLabel(p.category)}
                      </Typography>
                    </Stack>
                    <Typography className="type-label" sx={{ mt: 0.5, display: 'block' }}>
                      每月 {p.due_day} 日 · 本期应付日 {p.due_date.slice(5)}
                    </Typography>
                  </Box>
                  <IconButton size="small" aria-label="编辑固定支出" onClick={() => onEdit(p)} sx={{ flexShrink: 0, color: 'var(--muted)' }}>
                    <EditIcon fontSize="small" />
                  </IconButton>
                </Stack>

                <Stack direction="row" alignItems="flex-end" justifyContent="space-between" sx={{ mt: 1 }}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography className="type-label">
                      {paid ? '本期已付' : '本期应付'}
                    </Typography>
                    <Typography
                      className="num-tabular"
                      sx={{
                        fontSize: 'var(--type-title-size)',
                        lineHeight: 'var(--type-title-line)',
                        letterSpacing: 'var(--type-title-tracking)',
                        fontWeight: 'var(--type-title-weight)',
                        color: paid ? 'var(--success-ink)' : overdue ? 'var(--danger-ink)' : 'var(--text)',
                        mt: 0.25,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {currencySymbol(p.currency)}{p.amount.toLocaleString()}
                    </Typography>
                  </Box>
                  {paid ? (
                    <Typography sx={{ fontSize: 14.5, lineHeight: '18px', letterSpacing: '0.3px', fontWeight: 600, color: 'var(--success-ink)', flexShrink: 0 }}>
                      已登记
                    </Typography>
                  ) : (
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => onPay(p)}
                      sx={{
                        borderRadius: 'var(--radius-pill)',
                        fontSize: 14.5,
                        lineHeight: '18px',
                        fontWeight: 600,
                        py: 0.4,
                        px: 1.75,
                        textTransform: 'none',
                        flexShrink: 0,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      登记付款
                    </Button>
                  )}
                </Stack>

                <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mt: 1.25, color: overdue ? 'var(--danger-ink)' : 'var(--gold-700)', fontSize: 14.5, lineHeight: '18px', letterSpacing: '0.3px', fontWeight: 600 }}>
                  <ClockIcon size={14} />
                  {label}
                  <ChevronRightIcon size={12} />
                </Stack>
              </Paper>
            )
          })}
        </Stack>
      )}
    </Box>
  )
}
