'use client'

import { Avatar, Card, CardActionArea, CardContent, Typography, Box, Chip, IconButton } from '@mui/material'
import EditIcon from '@mui/icons-material/Edit'
import type { CardHolder } from '@/lib/types'

interface Props {
  holder: CardHolder
  cardCount: number
  onClick: () => void
  onEdit?: () => void
}

// MUI Typography 自带样式注入在 globals.css 之后，同特异性下角色 class 会被覆盖，
// 因此排版令牌直接写进 sx。
const BODY = {
  fontSize: 'var(--type-body-size)',
  lineHeight: 'var(--type-body-line)',
  fontWeight: 'var(--type-body-weight)',
  letterSpacing: 'var(--type-body-tracking)',
}
const SECTION = {
  fontSize: 'var(--type-section-size)',
  lineHeight: 'var(--type-section-line)',
  fontWeight: 'var(--type-section-weight)',
  letterSpacing: 'var(--type-section-tracking)',
}

export function HolderCard({ holder, cardCount, onClick, onEdit }: Props) {
  return (
    <Card
      sx={{
        mb: 1.5,
        position: 'relative',
        // 列表项：无边框 + 分层阴影，圆角走 12px 档
        border: 0,
        borderRadius: 'var(--radius-depth-1)',
        boxShadow: 'var(--shadow-e1)',
      }}
    >
      <CardActionArea onClick={onClick}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar sx={{ bgcolor: holder.avatar_color, width: 48, height: 48, fontSize: 20 }}>
            {holder.name.charAt(0)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* 卡片标题：19/24 · 600 · -0.6px */}
            <Typography sx={{ ...SECTION, color: 'var(--text)' }} noWrap>
              {holder.name}
            </Typography>
            {holder.aliases && holder.aliases.length > 0 && (
              <Typography sx={{ ...BODY, color: 'var(--muted)', display: 'block', mt: 0.25 }} noWrap>
                别名: {holder.aliases.join('、')}
              </Typography>
            )}
            {holder.phone && (
              <Typography sx={{ ...BODY, color: 'var(--muted)' }}>
                {holder.phone}
              </Typography>
            )}
          </Box>
          <Chip
            label={`${cardCount} 张卡`}
            size="small"
            sx={{
              // 微型标签：保留 ≤12px 小字号，只统一圆角档与配色语义
              // 计数标签是不可拆语义单元：不参与收缩，位数变多也不折行
              flexShrink: 0,
              whiteSpace: 'nowrap',
              borderRadius: 'var(--radius-pill)',
              bgcolor: 'primary.light',
              color: 'primary.dark',
              fontWeight: 600,
            }}
          />
          {onEdit && (
            <IconButton
              aria-label="编辑持卡人"
              size="small"
              onClick={(e) => { e.stopPropagation(); onEdit() }}
              // 图标按钮是固定触控目标，不参与被压缩
              sx={{ color: 'var(--strong)', flexShrink: 0 }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          )}
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
