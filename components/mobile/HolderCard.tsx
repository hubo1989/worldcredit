// components/mobile/HolderCard.tsx
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

export function HolderCard({ holder, cardCount, onClick, onEdit }: Props) {
  return (
    <Card sx={{ mb: 1.5, borderRadius: 3, position: 'relative' }}>
      <CardActionArea onClick={onClick}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar sx={{ bgcolor: holder.avatar_color, width: 48, height: 48, fontSize: 20 }}>
            {holder.name.charAt(0)}
          </Avatar>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" fontWeight={700} noWrap>
              {holder.name}
            </Typography>
            {holder.aliases && holder.aliases.length > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25 }} noWrap>
                别名: {holder.aliases.join('、')}
              </Typography>
            )}
            {holder.phone && (
              <Typography variant="body2" color="text.secondary">
                {holder.phone}
              </Typography>
            )}
          </Box>
          <Chip
            label={`${cardCount} 张卡`}
            size="small"
            sx={{ bgcolor: 'primary.light', color: 'primary.dark', fontWeight: 600 }}
          />
          {onEdit && (
            <IconButton
              aria-label="编辑持卡人"
              size="small"
              onClick={(e) => { e.stopPropagation(); onEdit() }}
            >
              <EditIcon fontSize="small" />
            </IconButton>
          )}
        </CardContent>
      </CardActionArea>
        {holder.auth_user_id && (
          <Chip
            label="已绑定成员账号"
            size="small"
            sx={{ position: 'absolute', top: 8, left: 8, bgcolor: 'success.light', color: 'success.dark' }}
          />
        )}
    </Card>
  )
}
