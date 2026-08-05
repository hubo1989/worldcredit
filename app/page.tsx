'use client'

import { Box, Button, Container, Typography, Stack, Paper } from '@mui/material'
import { RocketLaunch, Security, Speed, Wallet } from '@mui/icons-material'
import { useRouter } from 'next/navigation'

export default function LandingPage() {
  const router = useRouter()

  return (
    <Box sx={{
      minHeight: '100vh',
      bgcolor: 'background.default',
      background: 'linear-gradient(135deg, #f0f4fd 0%, #ffffff 100%)',
      display: 'flex',
      flexDirection: 'column'
    }}>
      {/* 顶部导航占位 */}
      <Container maxWidth="lg" sx={{ py: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="h6" fontWeight={800} color="primary.main">
          WorldCredit
        </Typography>
        <Button onClick={() => router.push('/login')} variant="outlined" size="small" sx={{ borderRadius: 2 }}>
          登录
        </Button>
      </Container>
      
      {/* Hero Content */}
      <Container maxWidth="md" sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', py: 8 }}>
        <Box sx={{ textAlign: 'center', mb: 8 }}>
          <Typography variant="h2" fontWeight={800} sx={{ 
            fontSize: { xs: '2.5rem', md: '4.5rem' },
            background: 'linear-gradient(90deg, #1976d2, #9c27b0)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            mb: 3
          }}>
            家庭信用卡管理<br/>全新体验
          </Typography>
          <Typography variant="h6" color="text.secondary" sx={{ mb: 6, fontWeight: 400, maxWidth: 640, mx: 'auto', lineHeight: 1.6 }}>
            专业、简洁地聚合您的账单、权益和信用卡资产。提供智能分析与提醒，帮您轻松掌控家庭财务健康。
          </Typography>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} justifyContent="center">
            <Button 
              onClick={() => router.push('/dashboard')}
              variant="contained" 
              size="large"
              endIcon={<RocketLaunch />}
              sx={{ 
                borderRadius: 4, 
                px: 4, 
                py: 1.5,
                fontSize: '1.1rem',
                boxShadow: '0 8px 16px rgba(25, 118, 210, 0.24)'
              }}
            >
              开始使用
            </Button>
            <Button 
              onClick={() => router.push('/login')}
              variant="outlined" 
              size="large"
              sx={{ borderRadius: 4, px: 4, py: 1.5, fontSize: '1.1rem' }}
            >
              登录系统
            </Button>
          </Stack>
        </Box>

        {/* Features */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' }, gap: 4 }}>
          <Paper elevation={0} sx={{ p: 4, borderRadius: 4, bgcolor: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(10px)', height: '100%', transition: 'transform 0.2s', '&:hover': { transform: 'translateY(-4px)' } }}>
            <Wallet sx={{ fontSize: 40, color: 'primary.main', mb: 2 }} />
            <Typography variant="h6" fontWeight={700} mb={1}>全景账单</Typography>
            <Typography color="text.secondary" variant="body2" sx={{ lineHeight: 1.6 }}>
              一站式聚合所有信用卡账单，清爽直观的负债总览，告别逾期风险。
            </Typography>
          </Paper>
          <Paper elevation={0} sx={{ p: 4, borderRadius: 4, bgcolor: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(10px)', height: '100%', transition: 'transform 0.2s', '&:hover': { transform: 'translateY(-4px)' } }}>
            <Security sx={{ fontSize: 40, color: 'success.main', mb: 2 }} />
            <Typography variant="h6" fontWeight={700} mb={1}>数据安全</Typography>
            <Typography color="text.secondary" variant="body2" sx={{ lineHeight: 1.6 }}>
              独立部署的基础设施，严格的访问控制保护，您的财务数据仅您可见。
            </Typography>
          </Paper>
          <Paper elevation={0} sx={{ p: 4, borderRadius: 4, bgcolor: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(10px)', height: '100%', transition: 'transform 0.2s', '&:hover': { transform: 'translateY(-4px)' } }}>
            <Speed sx={{ fontSize: 40, color: 'secondary.main', mb: 2 }} />
            <Typography variant="h6" fontWeight={700} mb={1}>极致体验</Typography>
            <Typography color="text.secondary" variant="body2" sx={{ lineHeight: 1.6 }}>
              专为移动端优化的交互设计，功能全面且无广告打扰，秒级触达。
            </Typography>
          </Paper>
        </Box>
      </Container>
      
      {/* Footer */}
      <Box sx={{ py: 4, textAlign: 'center', color: 'text.secondary' }}>
        <Typography variant="body2">
          &copy; {new Date().getFullYear()} WorldCredit. All rights reserved.
        </Typography>
      </Box>
    </Box>
  )
}
