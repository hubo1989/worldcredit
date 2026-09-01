// app/(mobile)/promos/page.tsx
'use client'

import { Box, Typography } from '@mui/material'
import { LocalOffer as PromoIcon } from '@mui/icons-material'

export default function PromosPage() {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>优惠权益</Typography>

      <Box sx={{
        textAlign: 'center', p: 4, bgcolor: '#fff', borderRadius: 4,
        border: '2px dashed', borderColor: 'divider', mt: 4
      }}>
        <PromoIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
        <Typography variant="subtitle1" fontWeight={600}>优惠活动管理</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          此功能将在 Phase 2 版本中实现
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          包括：优惠活动管理、权益追踪、使用记录
        </Typography>
      </Box>
    </Box>
  )
}
