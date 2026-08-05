'use client'

import { Box, Typography, Paper } from '@mui/material'
import type { ReactNode } from 'react'

interface StatCardProps {
  icon: ReactNode
  label: string
  value: string | number
  subtitle?: string
  color: string // gradient start color
}

export function StatCard({ icon, label, value, subtitle, color }: StatCardProps) {
  return (
    <Paper sx={{
      p: 2.5,
      borderRadius: '5px',
      bgcolor: '#FFFFFF',
      border: '1px solid #DDDDDD',
      boxShadow: '0px 2px 4px rgba(0, 0, 0, 0.08)',
      display: 'flex',
      alignItems: 'flex-start',
      gap: 2,
      transition: 'border-color 0.2s, transform 0.2s, box-shadow 0.2s',
      '&:hover': {
        borderColor: color,
        boxShadow: '0px 4px 8px rgba(0, 0, 0, 0.12)',
        transform: 'translateY(-2px)',
      },
    }}>
      <Box sx={{
        width: 44, height: 44, borderRadius: '5px',
        background: `linear-gradient(135deg, ${color}20 0%, ${color}10 100%)`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: color,
        flexShrink: 0,
      }}>
        {icon}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ color: '#636363', fontSize: 12, fontWeight: 500 }}>
          {label}
        </Typography>
        <Typography variant="h2" sx={{ color: '#030059', fontSize: '24px', fontWeight: 300, lineHeight: 1.3, mt: 0.25 }}>
          {value}
        </Typography>
        {subtitle && (
          <Typography variant="caption" sx={{ color: '#00AA00', fontSize: 11, fontWeight: 700 }}>
            {subtitle}
          </Typography>
        )}
      </Box>
    </Paper>
  )
}
