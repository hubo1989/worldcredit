'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  Container, Typography, Box, Stack, Paper,
  Card, CardContent,
  Chip, Button, Skeleton
} from '@mui/material'
import PromoIcon from '@mui/icons-material/LocalOffer'
import StoreIcon from '@mui/icons-material/Store'
import GasIcon from '@mui/icons-material/LocalGasStation'
import DrinkIcon from '@mui/icons-material/Coffee'
import { insforge } from '@/lib/insforge'
import type { Promo } from '@/lib/types'

export default function PromosPage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      const { data } = await insforge.database
        .from('promos')
        .select('*')
        .order('end_date', { ascending: true })
      setPromos(data || [])
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  const handleRegister = async (promo: Promo) => {
    try {
      // 获取用户的第一张卡（简单实现）
      const { data: cards } = await insforge.database
        .from('credit_cards')
        .select('id')
        .limit(1)

      await insforge.database
        .from('promo_usages')
        .insert([{
          promo_id: promo.id,
          card_id: cards?.[0]?.id,
          used_at: new Date().toISOString()
        }])
      
      alert('权益领取成功！请前往银行 App 使用。')
    } catch (err) {
      console.error(err)
      alert('领取失败，请稍后重试')
    }
  }

  const getPromoIcon = (title: string) => {
    if (title.includes('加油')) return <GasIcon />
    if (title.includes('饮品') || title.includes('咖啡')) return <DrinkIcon />
    if (title.includes('商超')) return <StoreIcon />
    return <PromoIcon />
  }

  return (
    <Container sx={{ py: 3, pb: 10 }}>
      <Box sx={{ mb: 3 }}>
        <Typography variant="h5" fontWeight={700} gutterBottom>发现优惠</Typography>
        <Typography variant="body2" color="text.secondary">精选各行信用卡热门活动</Typography>
      </Box>

      {loading ? (
        <Stack spacing={2}>
          {[1, 2, 3].map(i => <Skeleton key={i} variant="rounded" height={150} sx={{ borderRadius: 4 }} />)}
        </Stack>
      ) : promos.length === 0 ? (
        <Paper sx={{ p: 4, textAlign: 'center', borderRadius: 4, bgcolor: 'grey.50' }}>
          <PromoIcon sx={{ fontSize: 48, color: 'text.disabled', mb: 2 }} />
          <Typography color="text.secondary">暂无优惠活动</Typography>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {promos.map(p => (
            <Card key={p.id} sx={{ 
              borderRadius: 4, 
              border: '1px solid', 
              borderColor: 'divider',
              boxShadow: 'none'
            }}>
              <CardContent>
                <Stack direction="row" spacing={2}>
                  <Box sx={{ 
                    width: 54, height: 54, borderRadius: 3, 
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    bgcolor: 'error.50', color: 'error.main'
                  }}>
                    {getPromoIcon(p.title)}
                  </Box>
                  <Box sx={{ flex: 1 }}>
                    <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                      <Typography variant="caption" fontWeight={700} color="primary" sx={{ mb: 0.5 }}>
                        {p.bank_name}
                      </Typography>
                      <Chip 
                        label={p.discount_type || '优惠'} 
                        size="small" 
                        color="error"
                        variant="outlined"
                        sx={{ height: 18, fontSize: 10 }}
                      />
                    </Stack>
                    <Typography variant="subtitle1" fontWeight={700} sx={{ mb: 1, lineHeight: 1.2 }}>
                      {p.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ 
                      fontSize: 12, mb: 2, overflow: 'hidden', textOverflow: 'ellipsis',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
                    }}>
                      {p.description}
                    </Typography>
                    <Button 
                      variant="contained" 
                      fullWidth 
                      size="small"
                      onClick={() => handleRegister(p)}
                    >
                      立即参与
                    </Button>
                  </Box>
                </Stack>
              </CardContent>
            </Card>
          ))}
        </Stack>
      )}
    </Container>
  )
}
