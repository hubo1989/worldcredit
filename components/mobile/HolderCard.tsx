// components/mobile/HolderCard.tsx
'use client'

import { Avatar, Card, CardActionArea, CardContent, Typography, Box, Chip } from '@mui/material'
import type { CardHolder } from '@/lib/types'

interface Props {
  holder: CardHolder
  cardCount: number
  onClick: () => void
}

export function HolderCard({ holder, cardCount, onClick }: Props) {
  return (
    <Card sx={{ mb: 1.5 }}>
      <CardActionArea onClick={onClick}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar sx={{ bgcolor: holder.avatar_color, width: 48, height: 48 }}>
            {holder.name.charAt(0)}
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              {holder.name}
            </Typography>
            {holder.phone && (
              <Typography variant="body2" color="text.secondary">
                {holder.phone}
              </Typography>
            )}
          </Box>
          <Chip label={`${cardCount} 张卡`} size="small" />
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
