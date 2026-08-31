'use client'

import type { ReactNode } from 'react'
import { Box, Typography, Stack } from '@mui/material'
import { CreditCard as CreditCardIcon } from '@mui/icons-material'
import Link from 'next/link'

/**
 * 认证页分屏壳：桌面端左品牌面板（签名渐变 + 悬浮卡视觉）+ 右表单区；
 * 移动端收敛为表单优先的单列，品牌磁贴保留渐变签名。
 */

// 左侧面板的签名渐变卡（纯 CSS 视觉，即 DESIGN.md 的信用卡签名元素）
function CardVisual() {
  return (
    <Box sx={{
      position: 'relative',
      width: 'min(360px, 78%)',
      aspectRatio: '1.6',
      '@keyframes floatCard': {
        from: { transform: 'translateY(-6px) rotate(-3deg)' },
        to: { transform: 'translateY(8px) rotate(-3deg)' },
      },
      animation: 'floatCard 7s cubic-bezier(0.45, 0, 0.55, 1) infinite alternate',
    }}>
      {/* 底层卡边：增加纵深 */}
      <Box sx={{
        position: 'absolute',
        inset: 0,
        borderRadius: '22px',
        transform: 'translate(14px, 14px) rotate(0deg)',
        bgcolor: 'rgba(255, 255, 255, 0.07)',
      }} />
      {/* 主卡面 */}
      <Box sx={{
        position: 'absolute',
        inset: 0,
        borderRadius: '22px',
        background: 'linear-gradient(135deg, #030059 0%, #004f78 100%)',
        boxShadow: '0 24px 48px rgba(2, 0, 50, 0.45)',
        overflow: 'hidden',
        p: 3,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
      }}>
        {/* 高光 */}
        <Box sx={{
          position: 'absolute',
          inset: 0,
          background: 'radial-gradient(120% 90% at 85% -10%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 55%)',
        }} />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 15, letterSpacing: '0.02em' }}>
            WorldCredit
          </Typography>
          <Box sx={{
            width: 34, height: 24, borderRadius: '5px',
            bgcolor: 'rgba(255,255,255,0.22)',
            border: '1px solid rgba(255,255,255,0.35)',
          }} />
        </Box>
        <Typography sx={{
          color: 'rgba(255,255,255,0.92)',
          fontSize: 19,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums',
          letterSpacing: '0.12em',
        }}>
          •••• •••• •••• 0305
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.65)', fontSize: 12 }}>
            全家的卡 · 一处掌握
          </Typography>
          <Box sx={{
            width: 30, height: 30, borderRadius: '50%',
            bgcolor: 'rgba(255,255,255,0.16)',
            border: '1px solid rgba(255,255,255,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Typography sx={{ color: '#fff', fontSize: 13, fontWeight: 700 }}>W</Typography>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

export function AuthShell({
  title,
  subtitle,
  crossLinkHref,
  crossLinkLabel,
  children,
}: {
  title: string
  subtitle: string
  crossLinkHref: '/login' | '/register'
  crossLinkLabel: string
  children: ReactNode
}) {
  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', bgcolor: 'background.paper' }}>
      {/* 品牌面板（md 及以上显示） */}
      <Box sx={{
        display: { xs: 'none', md: 'flex' },
        flexBasis: { md: '42%' },
        flexDirection: 'column',
        justifyContent: 'space-between',
        p: { md: 6, lg: 8 },
        background: 'linear-gradient(160deg, #030059 0%, #00224a 70%, #004f78 100%)',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* 背景辉光 */}
        <Box sx={{
          position: 'absolute',
          width: 560,
          height: 560,
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(122,173,255,0.18) 0%, rgba(122,173,255,0) 70%)',
          top: '12%',
          left: '-10%',
          pointerEvents: 'none',
        }} />
        <Stack direction="row" alignItems="center" spacing={1.5} sx={{ position: 'relative' }}>
          <Box sx={{
            width: 38, height: 38, borderRadius: '11px',
            bgcolor: 'rgba(255,255,255,0.14)',
            border: '1px solid rgba(255,255,255,0.2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <CreditCardIcon sx={{ fontSize: 20, color: '#fff' }} />
          </Box>
          <Typography sx={{ color: '#fff', fontWeight: 700, fontSize: 16 }}>
            WorldCredit
          </Typography>
        </Stack>
        <Box sx={{ position: 'relative', display: 'flex', justifyContent: 'center', py: 4 }}>
          <CardVisual />
        </Box>
        <Stack spacing={1.5} sx={{ position: 'relative' }}>
          <Typography sx={{ color: 'rgba(255,255,255,0.92)', fontSize: 20, fontWeight: 600, lineHeight: 1.5 }}>
            账单、权益、优惠，
            <br />
            全家的卡，一处掌握。
          </Typography>
          <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.5)' }}>
            © 2026 WorldCredit
          </Typography>
        </Stack>
      </Box>

      {/* 表单区 */}
      <Box sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        px: { xs: 3, md: 8 },
        py: { xs: 6, md: 8 },
      }}>
        <Box sx={{ width: '100%', maxWidth: 400 }}>
          {/* 移动端品牌行 */}
          <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 5, display: { md: 'none' } }}>
            <Box sx={{
              width: 36, height: 36, borderRadius: '10px',
              background: 'linear-gradient(135deg, #030059 0%, #004f78 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <CreditCardIcon sx={{ fontSize: 19, color: '#fff' }} />
            </Box>
            <Typography sx={{ fontSize: 15, fontWeight: 700, color: '#030059' }}>
              WorldCredit
            </Typography>
          </Stack>

          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
            <Typography sx={{ fontSize: 30, fontWeight: 700, color: '#030059', letterSpacing: '-0.02em' }}>
              {title}
            </Typography>
            <Link
              href={crossLinkHref}
              style={{ fontSize: 14, color: '#1565c0', textDecoration: 'underline', fontWeight: 600 }}
            >
              {crossLinkLabel}
            </Link>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 4 }}>
            {subtitle}
          </Typography>
          {children}
        </Box>
      </Box>
    </Box>
  )
}
