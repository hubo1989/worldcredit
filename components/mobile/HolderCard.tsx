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
    <Card sx={{ 
      mb: 1.5, 
      borderRadius: '5px',
      border: '1px solid #DDDDDD',
      boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.08)',
      bgcolor: '#FFFFFF'
    }}>
      <CardActionArea onClick={onClick}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2, p: 2 }}>
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
            color={cardCount > 0 ? 'primary' : 'default'}
            variant={cardCount > 0 ? 'filled' : 'outlined'}
          />
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
