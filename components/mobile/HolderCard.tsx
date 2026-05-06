// components/mobile/HolderCard.tsx
'use client'

import { Avatar, Card, CardActionArea, CardContent, Typography, Box, Stack, Chip } from '@mui/material'
import type { ReactElement } from 'react'
import { CreditCard as CardIcon, AccountBalance as BankIcon, Link as LinkIcon, Email as EmailIcon } from '@mui/icons-material'
import { formatAmount } from '@/lib/utils'
import type { HolderWithStats } from '@/lib/api/holders'

interface Props {
  holder: HolderWithStats
  onClick: () => void
}

function getBindingStatus(holder: HolderWithStats): { label: string; color: 'default' | 'success' | 'warning' | 'error'; icon?: ReactElement } {
  if (!holder.email) {
    return { label: '未填写邮箱', color: 'default', icon: <EmailIcon sx={{ fontSize: 14 }} /> }
  }
  if (holder.auth_user_id) {
    return { label: '已绑定成员', color: 'success', icon: <LinkIcon sx={{ fontSize: 14 }} /> }
  }
  return { label: '等待绑定', color: 'warning', icon: <EmailIcon sx={{ fontSize: 14 }} /> }
}

function StatItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Box sx={{ textAlign: 'center', flex: 1 }}>
      <Typography
        variant="body2"
        fontWeight={700}
        color={highlight ? 'error.main' : 'text.primary'}
        sx={{ fontSize: '0.95rem', lineHeight: 1.3 }}
      >
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
        {label}
      </Typography>
    </Box>
  )
}

export function HolderCard({ holder, onClick }: Props) {
  const { stats } = holder
  const bindingStatus = getBindingStatus(holder)

  return (
    <Card
      sx={{
        mb: 1.5,
        borderRadius: 3,
        boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
        transition: 'box-shadow 0.2s, transform 0.2s',
        '&:hover': { boxShadow: '0 4px 12px rgba(0,0,0,0.1)', transform: 'translateY(-1px)' },
      }}
    >
      <CardActionArea onClick={onClick} sx={{ p: 0 }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          {/* 头部：头像 + 姓名 + 绑定状态 + 银行/卡数摘要 */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
            <Avatar
              sx={{
                bgcolor: holder.avatar_color,
                width: 44,
                height: 44,
                fontSize: '1.1rem',
                fontWeight: 700,
                boxShadow: `0 2px 8px ${holder.avatar_color}40`,
              }}
            >
              {holder.name.charAt(0)}
            </Avatar>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.3 }}>
                <Typography variant="subtitle1" fontWeight={700} noWrap>
                  {holder.name}
                </Typography>
                <Chip
                  icon={bindingStatus.icon}
                  label={bindingStatus.label}
                  size="small"
                  color={bindingStatus.color}
                  variant={bindingStatus.color === 'default' ? 'outlined' : 'filled'}
                  sx={{ height: 20, fontSize: '0.65rem', '& .MuiChip-label': { px: 0.5 } }}
                />
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                  <CardIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                  <Typography variant="caption" color="text.secondary">
                    {stats.cardCount}张卡
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                  <BankIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                  <Typography variant="caption" color="text.secondary">
                    {stats.bankCount}家银行
                  </Typography>
                </Box>
              </Stack>
            </Box>
          </Box>

          {/* 统计栏 */}
          <Box
            sx={{
              display: 'flex',
              bgcolor: 'grey.50',
              borderRadius: 2,
              py: 1,
              px: 0.5,
            }}
          >
            <StatItem label="持卡数" value={`${stats.cardCount}`} />
            <StatItem label="发卡银行" value={`${stats.bankCount}`} />
            <StatItem label="待还金额" value={formatAmount(stats.pendingAmount)} highlight={stats.pendingAmount > 0} />
            <StatItem label="待还卡数" value={`${stats.pendingCardCount}`} highlight={stats.pendingCardCount > 0} />
          </Box>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
