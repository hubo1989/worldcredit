'use client'

import {
  Box, Typography, Paper, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Chip
} from '@mui/material'
import type { CardProductStat } from '@/lib/api/dashboard'

interface CardProductOverviewProps {
  data: CardProductStat[]
}

const cellSx = {
  color: 'text.secondary',
  borderBottom: '1px solid rgba(255,255,255,0.04)',
  fontSize: 13,
  py: 1.5,
}

const headSx = {
  ...cellSx,
  color: '#9ca3af',
  fontWeight: 600,
  fontSize: 12,
  textTransform: 'uppercase' as const,
  letterSpacing: 0.5,
}

export function CardProductOverview({ data }: CardProductOverviewProps) {
  return (
    <Paper sx={{
      borderRadius: 3,
      bgcolor: '#181a24',
      border: '1px solid rgba(255,255,255,0.06)',
      overflow: 'hidden',
    }}>
      <Box sx={{ p: 3, pb: 1 }}>
        <Typography variant="subtitle2" sx={{ color: '#e4e6eb', fontWeight: 600 }}>
          信用卡产品目录
        </Typography>
        <Typography variant="caption" sx={{ color: '#9ca3af' }}>
          共 {data.length} 个在册产品
        </Typography>
      </Box>

      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={headSx}>银行</TableCell>
              <TableCell sx={headSx}>卡片名称</TableCell>
              <TableCell sx={headSx}>币种</TableCell>
              <TableCell sx={headSx} align="right">年费</TableCell>
              <TableCell sx={headSx}>年费减免</TableCell>
              <TableCell sx={headSx} align="right">开卡数</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} sx={{ ...cellSx, textAlign: 'center', py: 4, color: '#9ca3af' }}>
                  暂无卡产品数据
                </TableCell>
              </TableRow>
            ) : (
              data.map(p => (
                <TableRow key={p.id} sx={{
                  transition: 'background-color 0.15s',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' },
                }}>
                  <TableCell sx={cellSx}>
                    <Chip
                      label={p.bank_name}
                      size="small"
                      sx={{
                        bgcolor: 'rgba(99, 102, 241, 0.12)',
                        color: '#818cf8',
                        fontWeight: 600,
                        fontSize: 12,
                        height: 24,
                      }}
                    />
                  </TableCell>
                  <TableCell sx={{ ...cellSx, fontWeight: 500, color: '#e4e6eb' }}>
                    {p.card_name}
                  </TableCell>
                  <TableCell sx={cellSx}>{p.currency}</TableCell>
                  <TableCell sx={cellSx} align="right">
                    {p.annual_fee ? `¥${Number(p.annual_fee).toLocaleString()}` : '免年费'}
                  </TableCell>
                  <TableCell sx={{ ...cellSx, fontSize: 12 }}>
                    {p.annual_fee_waiver || '—'}
                  </TableCell>
                  <TableCell sx={cellSx} align="right">
                    <Typography component="span" sx={{ color: 'success.main', fontWeight: 700, fontSize: 14 }}>
                      {p.card_count}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  )
}
