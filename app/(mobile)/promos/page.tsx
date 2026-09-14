'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import {
  Container, Typography, Box, Stack, Paper,
  Card, CardContent, Chip, Button, Skeleton,
  Tabs, Tab, TextField, Dialog, DialogTitle,
  DialogContent, DialogActions,
  Snackbar, Alert
} from '@mui/material'
import PromoIcon from '@mui/icons-material/LocalOffer'
import StoreIcon from '@mui/icons-material/Store'
import GasIcon from '@mui/icons-material/LocalGasStation'
import DrinkIcon from '@mui/icons-material/Coffee'
import TravelIcon from '@mui/icons-material/FlightTakeoff'
import CinemaIcon from '@mui/icons-material/Movie'
import AddIcon from '@mui/icons-material/Add'
import AccessTimeIcon from '@mui/icons-material/AccessTime'
import CreditCardIcon from '@mui/icons-material/CreditCard'
import { getPromosWithBanks, createUserPromo } from '@/lib/api/promos'
import type { Promo } from '@/lib/types'

// 热门活动初始数据源 (若云端数据库活动较少时自动合并展现)
const POPULAR_PROMOS: Array<Omit<Promo, 'id' | 'created_at' | 'updated_at'>> = [
  {
    bank_name: '招商银行',
    title: '掌上生活 · 周三 5 折美食日',
    discount_type: '5折立减',
    description: '每周三上午 10:00 掌上生活 App 抢购大牌餐饮 5 折代金券（海底捞、西贝、星巴克等）。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'food', quota: '每周 1 次', channel: '掌上生活 App' }
  },
  {
    bank_name: '工商银行',
    title: '爱购周末 · 超市满 50 减 10 元',
    discount_type: '满50减10',
    description: '每周六、周日在指定商超（永辉、大润发、盒马）使用工行信用卡微信/银联支付立减 10 元。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'shopping', quota: '每日限 1 次', channel: '微信支付/云闪付' }
  },
  {
    bank_name: '建设银行',
    title: '龙卡加油惠 · 中石化中石油立减 20',
    discount_type: '加油返现',
    description: '建行龙卡信用卡持卡人通过建行手机银行或中石化钱包加油充值满 200 减 20 元。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'gas', quota: '每月 2 次', channel: '建行手机银行 App' }
  },
  {
    bank_name: '广发银行',
    title: '发现精彩 · 超级发发发买一送一',
    discount_type: '买一送一',
    description: '喜茶、奈雪、瑞幸等指定咖啡茶饮品牌使用广发信用卡买一送一，周五专属。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'drink', quota: '每周五限 1 次', channel: '发现精彩 App' }
  },
  {
    bank_name: '交通银行',
    title: '最红星期五 · 餐饮商超 5% 秒减',
    discount_type: '5%返现',
    description: '每周五在全国指定超市、加油站、外卖平台消费享 5% 秒减立减金。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'food', quota: '每月最高返 100 元', channel: '买单吧 App' }
  },
  {
    bank_name: '中信银行',
    title: '9 积分精彩兑 · 星巴克/电影票',
    discount_type: '积分兑换',
    description: '当月消费满 3 笔 399 元即可获得 1 个 9 分权益，可兑换大杯星巴克或淘票票电影代金券。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'entertainment', quota: '每月限兑 2 次', channel: '动卡空间 App' }
  },
  {
    bank_name: '浦发银行',
    title: '境外消费享最高 10% 返现',
    discount_type: '境外返现',
    description: '报名后使用浦发万事达/Visa 信用卡在境外线上及线下消费，笔笔返现高达 10%。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'travel', quota: '活动期间最高 1000 元', channel: '浦大喜奔 App' }
  }
]

export default function PromosPage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [userBanks, setUserBanks] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // 筛选状态
  const [categoryTab, setCategoryTab] = useState<string>('all')
  const [selectedBank, setSelectedBank] = useState<string>('all')

  // 新增活动弹窗
  const [addOpen, setAddOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBank, setNewBank] = useState('招商银行')
  const [newType, setNewType] = useState('满减')
  const [newDesc, setNewDesc] = useState('')
  const [newEndDate, setNewEndDate] = useState('2026-12-31')

  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'info' | 'error' }>({
    open: false, message: '', severity: 'success'
  })

  // 加载优惠与用户卡包所属银行
  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      
      // 1. 获取 DB 中的优惠列表与用户卡包银行
      const { promos: dbPromos, userBanks: banks } = await getPromosWithBanks()

      // 合并热门精选与 DB 优惠
      const existingTitles = new Set((dbPromos || []).map(p => p.title))
      const combined: Promo[] = [...(dbPromos || [])]
      
      POPULAR_PROMOS.forEach((p, idx) => {
        if (!existingTitles.has(p.title)) {
          combined.push({
            id: `popular-${idx}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...p,
          } as Promo)
        }
      })
      setPromos(combined)
      setUserBanks(banks)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // 分类与银行筛选计算
  const filteredPromos = useMemo(() => {
    return promos.filter(p => {
      // 分类筛选
      if (categoryTab !== 'all') {
        const title = (p.title + ' ' + (p.description || '')).toLowerCase()
        if (categoryTab === 'food' && !(title.includes('餐') || title.includes('美食') || title.includes('吃') || title.includes('5折') || title.includes('外卖'))) return false
        if (categoryTab === 'shopping' && !(title.includes('超市') || title.includes('商超') || title.includes('购物') || title.includes('买'))) return false
        if (categoryTab === 'gas' && !(title.includes('加油') || title.includes('车') || title.includes('出行'))) return false
        if (categoryTab === 'drink' && !(title.includes('咖啡') || title.includes('茶') || title.includes('饮品') || title.includes('星巴克'))) return false
        if (categoryTab === 'travel' && !(title.includes('境外') || title.includes('机票') || title.includes('酒店') || title.includes('商旅') || title.includes('返现'))) return false
      }

      // 银行筛选
      if (selectedBank !== 'all' && selectedBank !== 'my_cards') {
        if (!p.bank_name.includes(selectedBank)) return false
      } else if (selectedBank === 'my_cards') {
        if (!userBanks.some(b => p.bank_name.includes(b))) return false
      }

      return true
    })
  }, [promos, categoryTab, selectedBank, userBanks])

  // 获取所有出现的银行列表
  const allBanks = useMemo(() => {
    const set = new Set<string>()
    promos.forEach(p => {
      if (p.bank_name) set.add(p.bank_name.trim())
    })
    return Array.from(set)
  }, [promos])

  const handleRegister = (promo: Promo) => {
    const channel = promo.rules?.channel || `${promo.bank_name}手机银行 App`
    setToast({
      open: true,
      message: `✨ 已为您记录关注！请在 ${channel} 报名或使用对应银行卡支付享优惠。`,
      severity: 'success'
    })
  }

  const handleAddPromo = async () => {
    if (!newTitle.trim()) {
      setToast({ open: true, message: '请输入活动名称', severity: 'error' })
      return
    }
    setSubmitting(true)
    try {
      await createUserPromo({
        bank_name: newBank,
        title: newTitle.trim(),
        discount_type: newType,
        description: newDesc.trim() || '用户自定义记录的银行优惠活动',
        start_date: new Date().toISOString().split('T')[0],
        end_date: newEndDate,
      })
      
      setAddOpen(false)
      setNewTitle('')
      setNewDesc('')
      setToast({ open: true, message: '优惠活动添加成功！', severity: 'success' })
      loadData()
    } catch (err) {
      setToast({ open: true, message: '添加失败: ' + (err instanceof Error ? err.message : String(err)), severity: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const getPromoIcon = (title: string, desc: string = '') => {
    const text = title + desc
    if (text.includes('加油') || text.includes('车')) return <GasIcon />
    if (text.includes('饮品') || text.includes('咖啡') || text.includes('茶')) return <DrinkIcon />
    if (text.includes('商超') || text.includes('超市')) return <StoreIcon />
    if (text.includes('境外') || text.includes('航') || text.includes('酒店')) return <TravelIcon />
    if (text.includes('电影') || text.includes('影音') || text.includes('娱乐')) return <CinemaIcon />
    return <PromoIcon />
  }

  return (
    <Container sx={{ py: 3, pb: 12 }}>
      {/* 顶部标题栏 */}
      <Box sx={{ mb: 2.5, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography
            variant="h5"
            sx={{
              fontSize: 'var(--type-title-size)',
              lineHeight: 'var(--type-title-line)',
              fontWeight: 'var(--type-title-weight)',
              letterSpacing: 'var(--type-title-tracking)',
              color: 'var(--text)',
            }}
          >
            优惠活动
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
            }}
          >
            精选各行当期热门活动与信用卡专属羊毛
          </Typography>
        </Box>
        <Button
          variant="contained"
          size="small"
          startIcon={<AddIcon />}
          onClick={() => setAddOpen(true)}
          sx={{ borderRadius: 'var(--radius-pill)', fontWeight: 700, whiteSpace: 'nowrap' }}
        >
          添加活动
        </Button>
      </Box>

      {/* 分类 Tabs */}
      <Box sx={{ borderBottom: '1px solid var(--track)', mb: 2 }}>
        <Tabs
          value={categoryTab}
          onChange={(_, v) => setCategoryTab(v)}
          variant="scrollable"
          scrollButtons="auto"
          sx={{
            minHeight: 40,
            '& .MuiTab-root': {
              minHeight: 40,
              fontSize: 'var(--type-body-size)',
              letterSpacing: 'var(--type-body-tracking)',
              fontWeight: 700,
              px: 1.5,
              textTransform: 'none'
            }
          }}
        >
          <Tab label="全部精选" value="all" />
          <Tab label="餐饮美食" value="food" />
          <Tab label="超市便利" value="shopping" />
          <Tab label="加油车主" value="gas" />
          <Tab label="咖啡茶饮" value="drink" />
          <Tab label="商旅海淘" value="travel" />
        </Tabs>
      </Box>

      {/* 银行快速筛选 Chips */}
      <Box sx={{ mb: 2.5, display: 'flex', gap: 1, overflowX: 'auto', pb: 0.5 }}>
        <Chip
          label="全部银行"
          clickable
          size="small"
          color={selectedBank === 'all' ? 'primary' : 'default'}
          variant={selectedBank === 'all' ? 'filled' : 'outlined'}
          onClick={() => setSelectedBank('all')}
          sx={{
            // 无边框：层级由分层阴影表达；选中态走品牌色填充
            border: selectedBank === 'all' ? 0 : '1px solid transparent',
            fontSize: 'var(--type-body-size)',
            letterSpacing: 'var(--type-body-tracking)',
            fontWeight: 600,
            boxShadow: selectedBank === 'all' ? 'var(--shadow-e2)' : 'var(--shadow-e1)',
          }}
        />
        {userBanks.length > 0 && (
          <Chip
            icon={<CreditCardIcon sx={{ fontSize: '14px !important' }} />}
            label={`我持有的银行 (${userBanks.length})`}
            clickable
            size="small"
            color={selectedBank === 'my_cards' ? 'primary' : 'default'}
            variant={selectedBank === 'my_cards' ? 'filled' : 'outlined'}
            onClick={() => setSelectedBank('my_cards')}
            sx={{
              border: selectedBank === 'my_cards' ? 0 : '1px solid transparent',
              fontSize: 'var(--type-body-size)',
              letterSpacing: 'var(--type-body-tracking)',
              fontWeight: 600,
              boxShadow: selectedBank === 'my_cards' ? 'var(--shadow-e2)' : 'var(--shadow-e1)',
            }}
          />
        )}
        {allBanks.map(b => (
          <Chip
            key={b}
            label={b}
            clickable
            size="small"
            color={selectedBank === b ? 'primary' : 'default'}
            variant={selectedBank === b ? 'filled' : 'outlined'}
            onClick={() => setSelectedBank(b)}
            sx={{
              border: selectedBank === b ? 0 : '1px solid transparent',
              fontSize: 'var(--type-body-size)',
              letterSpacing: 'var(--type-body-tracking)',
              fontWeight: 600,
              boxShadow: selectedBank === b ? 'var(--shadow-e2)' : 'var(--shadow-e1)',
            }}
          />
        ))}
      </Box>

      {/* 列表渲染 */}
      {loading ? (
        <Stack spacing={2}>
          {[1, 2, 3].map(i => <Skeleton key={i} variant="rounded" height={140} sx={{ borderRadius: 'var(--radius-depth-3)' }} />)}
        </Stack>
      ) : filteredPromos.length === 0 ? (
        <Paper
          elevation={0}
          sx={{
            p: 5, textAlign: 'center', borderRadius: 'var(--radius-depth-3)',
            bgcolor: 'var(--bg)', border: '1px dashed', borderColor: 'var(--track)',
          }}
        >
          <PromoIcon sx={{ fontSize: 48, color: 'var(--text-disabled)', mb: 2 }} />
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              fontWeight: 600,
              color: 'var(--text)',
            }}
          >
            该分类下暂无活动
          </Typography>
          <Typography
            sx={{
              fontSize: 'var(--type-body-size)',
              lineHeight: 'var(--type-body-line)',
              letterSpacing: 'var(--type-body-tracking)',
              color: 'var(--muted)',
              display: 'block',
              mt: 0.5,
              mb: 2,
            }}
          >
            您可以切换银行分类或手动添加您关注的信用卡优惠
          </Typography>
          <Button variant="outlined" size="small" onClick={() => { setCategoryTab('all'); setSelectedBank('all') }}>
            查看全部活动
          </Button>
        </Paper>
      ) : (
        <Stack spacing={2}>
          {filteredPromos.map(p => {
            const hasCard = userBanks.some(b => p.bank_name.includes(b))

            return (
              <Card
                key={p.id}
                elevation={0}
                sx={{
                  // 无边框：层级由分层阴影表达；持卡可享的强调走品牌蓝描边语义
                  borderRadius: 'var(--radius-depth-3)',
                  border: hasCard ? '1px solid var(--navy-600)' : 0,
                  boxShadow: hasCard ? 'var(--shadow-e3)' : 'var(--shadow-e1)',
                  position: 'relative',
                  overflow: 'hidden',
                  transition: 'transform 0.15s ease',
                  '&:hover': { transform: 'translateY(-1px)' }
                }}
              >
                {/* 我已持卡可享 顶部角标 */}
                {hasCard && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: 0,
                      right: 0,
                      bgcolor: 'var(--navy-600)',
                      color: 'var(--text-on-dark)',
                      fontSize: 'var(--type-body-size)',
                      lineHeight: 1.4,
                      letterSpacing: 'var(--type-body-tracking)',
                      fontWeight: 600,
                      px: 1.5,
                      py: 0.25,
                      borderBottomLeftRadius: 'var(--radius-depth-1)',
                    }}
                  >
                    💳 我已持卡可享
                  </Box>
                )}

                <CardContent sx={{ p: 2.5 }}>
                  <Stack direction="row" spacing={2}>
                    <Box
                      sx={{
                        width: 52,
                        height: 52,
                        borderRadius: 'var(--radius-depth-1)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        bgcolor: 'rgba(30,58,138,0.08)',
                        color: 'var(--strong)',
                        flexShrink: 0
                      }}
                    >
                      {getPromoIcon(p.title, p.description || '')}
                    </Box>

                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.5 }}>
                        <Typography
                          sx={{
                            fontSize: 'var(--type-body-size)',
                            lineHeight: 'var(--type-body-line)',
                            letterSpacing: 'var(--type-body-tracking)',
                            fontWeight: 600,
                            color: 'var(--strong)',
                          }}
                        >
                          {p.bank_name}
                        </Typography>
                        <Chip
                          label={p.discount_type || '优惠'}
                          size="small"
                          color="error"
                          sx={{
                            height: 20, fontSize: 'var(--type-body-size)',
                            letterSpacing: 'var(--type-body-tracking)', fontWeight: 600,
                            mr: hasCard ? 10 : 0,
                          }}
                        />
                      </Stack>

                      <Typography
                        variant="h6"
                        sx={{
                          fontSize: 'var(--type-section-size)',
                          lineHeight: 'var(--type-section-line)',
                          fontWeight: 'var(--type-section-weight)',
                          letterSpacing: 'var(--type-section-tracking)',
                          color: 'var(--text)',
                          mb: 0.75,
                        }}
                      >
                        {p.title}
                      </Typography>

                      {p.description && (
                        <Typography sx={{
                          fontSize: 'var(--type-body-size)',
                          lineHeight: 'var(--type-body-line)',
                          letterSpacing: 'var(--type-body-tracking)',
                          color: 'var(--muted)',
                          mb: 1.5,
                          overflow: 'hidden', textOverflow: 'ellipsis',
                          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical'
                        }}>
                          {p.description}
                        </Typography>
                      )}

                      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ pt: 1, borderTop: '1px dashed var(--track)' }}>
                        <Typography
                          sx={{
                            fontSize: 'var(--type-body-size)',
                            lineHeight: 'var(--type-body-line)',
                            letterSpacing: 'var(--type-body-tracking)',
                            color: 'var(--muted)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 0.5,
                          }}
                        >
                          <AccessTimeIcon sx={{ fontSize: 13 }} />
                          截止至 {p.end_date || '长期有效'}
                        </Typography>
                        <Button
                          variant={hasCard ? 'contained' : 'outlined'}
                          size="small"
                          onClick={() => handleRegister(p)}
                          sx={{
                            borderRadius: 'var(--radius-pill)',
                            fontSize: 'var(--type-body-size)',
                            letterSpacing: 'var(--type-body-tracking)',
                            fontWeight: 700,
                            py: 0.4,
                            px: 1.5,
                            textTransform: 'none'
                          }}
                        >
                          {hasCard ? '一键享用' : '关注活动'}
                        </Button>
                      </Stack>
                    </Box>
                  </Stack>
                </CardContent>
              </Card>
            )
          })}
        </Stack>
      )}

      {/* 新增活动 Dialog */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} fullWidth maxWidth="xs">
        {/* Dialog 走 portal，在 .phone 作用域之外：显式声明角色令牌 */}
        <DialogTitle
          sx={{
            fontSize: 'var(--type-section-size)',
            lineHeight: 'var(--type-section-line)',
            fontWeight: 'var(--type-section-weight)',
            letterSpacing: 'var(--type-section-tracking)',
            color: 'var(--text)',
            fontFamily: 'var(--font-display)',
          }}
        >
          添加信用卡优惠活动
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <TextField
              label="发卡银行 *"
              fullWidth
              size="small"
              value={newBank}
              onChange={e => setNewBank(e.target.value)}
              placeholder="例如 招商银行 / 工商银行"
            />
            <TextField
              label="活动名称 *"
              fullWidth
              size="small"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              placeholder="例如 周三 5 折美食日"
            />
            <TextField
              label="优惠标签"
              fullWidth
              size="small"
              value={newType}
              onChange={e => setNewType(e.target.value)}
              placeholder="例如 5折立减 / 满50减10 / 积分兑换"
            />
            <TextField
              label="活动截止日期"
              type="date"
              fullWidth
              size="small"
              value={newEndDate}
              onChange={e => setNewEndDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
            />
            <TextField
              label="活动说明与规则"
              fullWidth
              multiline
              rows={3}
              size="small"
              value={newDesc}
              onChange={e => setNewDesc(e.target.value)}
              placeholder="描述参与方式、达标条件及使用渠道等"
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: 2 }}>
          <Button onClick={() => setAddOpen(false)}>取消</Button>
          <Button
            variant="contained"
            onClick={handleAddPromo}
            disabled={submitting}
            sx={{ borderRadius: 'var(--radius-pill)', fontWeight: 700 }}
          >
            {submitting ? '保存中...' : '确认添加'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 提示 Toast */}
      <Snackbar
        open={toast.open}
        autoHideDuration={3000}
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert severity={toast.severity} sx={{ borderRadius: 'var(--radius-depth-1)', fontWeight: 600 }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </Container>
  )
}
