'use client'

import { useState, useEffect } from 'react'
import {
  Box, Typography, Paper, Button, TextField, InputAdornment,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Switch, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, Grid, MenuItem, CircularProgress, Autocomplete, TablePagination,
  Checkbox, Snackbar, Alert
} from '@mui/material'
import {
  Add as AddIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  AutoAwesome as AiIcon
} from '@mui/icons-material'
import { getAdminPromos, createPromo, updatePromo, deletePromo, getAdminCardProducts } from '@/lib/api/admin'
import { Promo, CardProduct } from '@/lib/types'
import { suggestPromosFromWeb, type PromoSuggestion } from '@/lib/api/ai'

/** 优惠列表行：promos 字段 + 关联卡产品联查字段 */
type AdminPromoRow = Promo & {
  is_active: boolean
  // The admin RPC returns flat joined columns (product_bank_name/product_card_name),
  // not a nested card_products object.
  product_bank_name?: string
  product_card_name?: string
}

export default function PromosPage() {
  const [loading, setLoading] = useState(true)
  const [promos, setPromos] = useState<AdminPromoRow[]>([])
  const [cardProducts, setCardProducts] = useState<CardProduct[]>([])
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentPromo, setCurrentPromo] = useState<Partial<AdminPromoRow> | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  // AI 拉取活动：候选先复核再落库
  const [aiOpen, setAiOpen] = useState(false)
  const [aiBank, setAiBank] = useState('')
  const [aiCardName, setAiCardName] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiRows, setAiRows] = useState<PromoSuggestion[]>([])
  const [aiChecked, setAiChecked] = useState<boolean[]>([])
  const [aiSaving, setAiSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [pData, cpData] = await Promise.all([
        getAdminPromos(),
        getAdminCardProducts()
      ])
      setPromos(pData as unknown as AdminPromoRow[])
      setCardProducts(cpData)
    } catch (error) {
      console.error('Failed to fetch promos:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    setPage(0)
  }, [search])

  const filteredPromos = promos.filter(p =>
    p.bank_name.toLowerCase().includes(search.toLowerCase()) ||
    p.title.toLowerCase().includes(search.toLowerCase())
  )

  const paginatedPromos = filteredPromos.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage)
  }

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10))
    setPage(0)
  }

  const handleOpenDialog = (promo?: AdminPromoRow) => {
    if (promo) {
      setCurrentPromo(promo)
    } else {
      setCurrentPromo({
        bank_name: '',
        title: '',
        discount_type: '满减',
        is_active: true,
        start_date: new Date().toISOString().slice(0, 10)
      })
    }
    setDialogOpen(true)
  }

  const handleToggleStatus = async (promo: AdminPromoRow) => {
    try {
      await updatePromo(promo.id, { is_active: !promo.is_active })
      setPromos(promos.map(p => p.id === promo.id ? { ...p, is_active: !p.is_active } : p))
    } catch (error) {
      console.error('Failed to toggle status:', error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个优惠活动吗？')) return
    try {
      await deletePromo(id)
      setPromos(promos.filter(p => p.id !== id))
    } catch (error) {
      console.error('Failed to delete promo:', error)
    }
  }

  const handleSubmit = async () => {
    if (!currentPromo?.bank_name || !currentPromo?.title) {
      alert('请填写必填项（银行名称、活动名称）')
      return
    }

    setSubmitting(true)
    try {
      if (currentPromo.id) {
        const { product_bank_name, product_card_name, ...payload } = currentPromo
        void product_bank_name
        void product_card_name
        const updated = await updatePromo(currentPromo.id, payload)
        setPromos(promos.map(p => p.id === currentPromo.id ? { ...p, ...updated } as AdminPromoRow : p))
      } else {
        const created = await createPromo(currentPromo)
        setPromos([created as unknown as AdminPromoRow, ...promos])
      }
      setDialogOpen(false)
      fetchData() // Refresh to get relations
    } catch (error) {
      console.error('Failed to save promo:', error)
      alert('保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  /** 拉取 AI 候选。不写库——活动时效性强，先复核再落库。 */
  const handleFetchSuggestions = async () => {
    if (!aiBank.trim()) {
      setAiError('请先填写银行名称')
      return
    }
    setAiLoading(true)
    setAiError(null)
    setAiRows([])
    setAiChecked([])
    try {
      const rows = await suggestPromosFromWeb({
        bankName: aiBank.trim(),
        cardName: aiCardName.trim() || null,
        websiteUrl: null,
      })
      if (rows.length === 0) {
        setAiError('未查到可用的活动信息，可换一个银行名称或稍后再试')
      }
      setAiRows(rows)
      // 默认只勾选「官网页面能对上」的候选；模型记忆的留给人工判断
      setAiChecked(rows.map(r => r.provenance === 'site'))
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI 获取失败')
    } finally {
      setAiLoading(false)
    }
  }

  /** 把勾选的候选写入 promos。逐条创建并在结束时汇总成败。 */
  const handleImportSuggestions = async () => {
    const picked = aiRows.filter((_, i) => aiChecked[i])
    if (picked.length === 0) {
      setAiError('请先勾选要写入的活动')
      return
    }
    setAiSaving(true)
    let ok = 0
    const failed: string[] = []
    try {
      for (const row of picked) {
        try {
          await createPromo({
            bank_name: aiBank.trim(),
            title: row.title,
            description: row.description || undefined,
            discount_type: row.discount_type || undefined,
            start_date: row.start_date || undefined,
            end_date: row.end_date || undefined,
            conditions: row.conditions || undefined,
            is_active: true,
          } as Partial<Promo & { is_active: boolean }>)
          ok++
        } catch (err) {
          failed.push(`${row.title}（${err instanceof Error ? err.message : '失败'}）`)
        }
      }
      await fetchData()
      setAiOpen(false)
      setAiRows([])
      setAiChecked([])
      setNotice(
        failed.length === 0
          ? `已导入 ${ok} 条优惠活动`
          : `已导入 ${ok} 条，${failed.length} 条失败：${failed.slice(0, 3).join('；')}`
      )
    } finally {
      setAiSaving(false)
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ color: '#e4e6eb', fontWeight: 700, mb: 0.5 }}>
            优惠活动管理
          </Typography>
          <Typography variant="body2" sx={{ color: '#9ca3af' }}>
            管理全平台银行优惠活动，支持设置满减、返现、折扣等活动细节
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<AiIcon />}
            onClick={() => { setAiOpen(true); setAiError(null); setAiRows([]); setAiChecked([]) }}
            sx={{ color: '#c7d2fe', borderColor: 'rgba(199,210,254,0.4)', textTransform: 'none', borderRadius: 2, px: 3 }}
          >
            AI 获取活动
          </Button>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => handleOpenDialog()}
            sx={{ bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' }, textTransform: 'none', borderRadius: 2, px: 3 }}
          >
            发布新活动
          </Button>
        </Box>
      </Box>

      {/* 搜索 */}
      <Paper sx={{ p: 2, mb: 3, bgcolor: '#181a24', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="搜索银行或活动..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon sx={{ color: '#9ca3af', fontSize: 20 }} />
                  </InputAdornment>
                ),
                sx: { color: '#e4e6eb', bgcolor: 'rgba(255,255,255,0.03)' }
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 8 }} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <IconButton aria-label="刷新" onClick={fetchData} sx={{ color: '#9ca3af' }}>
              <RefreshIcon />
            </IconButton>
          </Grid>
        </Grid>
      </Paper>

      {/* 列表 */}
      <TableContainer component={Paper} sx={{ bgcolor: '#181a24', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <Table sx={{ minWidth: 650 }}>
          <TableHead sx={{ bgcolor: 'rgba(255,255,255,0.02)' }}>
            <TableRow>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>银行</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>活动名称</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>关联产品</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>折扣类型</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>有效期</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>状态</TableCell>
              <TableCell align="right" sx={{ color: '#9ca3af', fontWeight: 600 }}>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7} align="center" sx={{ py: 10 }}><CircularProgress size={24} sx={{ color: '#818cf8' }} /></TableCell></TableRow>
            ) : filteredPromos.length === 0 ? (
              <TableRow><TableCell colSpan={7} align="center" sx={{ py: 10, color: '#9ca3af' }}>未找到优惠活动</TableCell></TableRow>
            ) : (
              paginatedPromos.map((promo) => (
                <TableRow key={promo.id} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' }, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <TableCell sx={{ color: '#e4e6eb', fontWeight: 500 }}>{promo.bank_name}</TableCell>
                  <TableCell sx={{ color: '#e4e6eb' }}>{promo.title}</TableCell>
                  <TableCell sx={{ color: '#9ca3af' }}>{promo.product_card_name || '全门类'}</TableCell>
                  <TableCell>
                    <Chip label={promo.discount_type} size="small" variant="outlined" sx={{ color: '#818cf8', borderColor: '#818cf8', fontSize: 11 }} />
                  </TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontSize: 13 }}>
                    {promo.start_date || '即日起'} 至 {promo.end_date || '长期'}
                  </TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={promo.is_active}
                      onChange={() => handleToggleStatus(promo)}
                      sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#10b981' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#10b981' } }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton aria-label="编辑" size="small" onClick={() => handleOpenDialog(promo)} sx={{ color: '#9ca3af' }}><EditIcon fontSize="small" /></IconButton>
                    <IconButton aria-label="删除" size="small" onClick={() => handleDelete(promo.id)} sx={{ color: '#f43f5e', ml: 1 }}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={filteredPromos.length}
          page={page}
          onPageChange={handleChangePage}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          labelRowsPerPage="每页行数:"
          sx={{ color: '#9ca3af', borderTop: '1px solid rgba(255,255,255,0.06)' }}
        />
      </TableContainer>

      {/* AI 获取活动：先复核再落库 */}
      <Dialog open={aiOpen} onClose={() => !aiSaving && setAiOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { bgcolor: '#1e2028', color: '#e4e6eb', borderRadius: 3, p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>AI 获取活动</DialogTitle>
        <DialogContent>
          <Typography sx={{ color: '#9ca3af', fontSize: 13, mb: 2 }}>
            按银行（可选指定卡片）检索当前可查到的优惠活动。抓得到官网活动页时以页面正文为准，
            标为「官网」；仅来自模型记忆的标为「待确认」。默认只勾选「官网」项，写入前请自行核对。
          </Typography>
          <Grid container spacing={2} sx={{ mb: 1 }}>
            <Grid size={{ xs: 12, md: 5 }}>
              <TextField
                fullWidth size="small" label="银行名称" required value={aiBank}
                onChange={e => setAiBank(e.target.value)}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb', bgcolor: 'rgba(255,255,255,0.03)' } }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 5 }}>
              <TextField
                fullWidth size="small" label="卡片名称（可选）" value={aiCardName}
                onChange={e => setAiCardName(e.target.value)}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb', bgcolor: 'rgba(255,255,255,0.03)' } }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 2 }} sx={{ display: 'flex', alignItems: 'center' }}>
              <Button
                fullWidth variant="contained" onClick={handleFetchSuggestions}
                disabled={aiLoading}
                startIcon={aiLoading ? <CircularProgress size={16} color="inherit" /> : <AiIcon />}
                sx={{ bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' }, textTransform: 'none' }}
              >
                {aiLoading ? '获取中' : '获取'}
              </Button>
            </Grid>
          </Grid>

          {aiError && <Alert severity="warning" sx={{ mb: 2 }}>{aiError}</Alert>}

          {aiRows.length > 0 && (
            <TableContainer component={Paper} sx={{ bgcolor: '#181a24', border: '1px solid rgba(255,255,255,0.06)' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" sx={{ color: '#9ca3af' }}>
                      <Checkbox
                        size="small"
                        checked={aiChecked.length > 0 && aiChecked.every(Boolean)}
                        indeterminate={aiChecked.some(Boolean) && !aiChecked.every(Boolean)}
                        onChange={e => setAiChecked(aiRows.map(() => e.target.checked))}
                        sx={{ color: '#6b7280', '&.Mui-checked': { color: 'primary.main' } }}
                      />
                    </TableCell>
                    <TableCell sx={{ color: '#9ca3af' }}>活动名称</TableCell>
                    <TableCell sx={{ color: '#9ca3af' }}>类型</TableCell>
                    <TableCell sx={{ color: '#9ca3af' }}>有效期</TableCell>
                    <TableCell sx={{ color: '#9ca3af' }}>依据</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {aiRows.map((row, i) => (
                    <TableRow key={i}>
                      <TableCell padding="checkbox">
                        <Checkbox
                          size="small"
                          checked={aiChecked[i] || false}
                          onChange={e => setAiChecked(aiChecked.map((v, j) => j === i ? e.target.checked : v))}
                          sx={{ color: '#6b7280', '&.Mui-checked': { color: 'primary.main' } }}
                        />
                      </TableCell>
                      <TableCell sx={{ color: '#e4e6eb', fontSize: 13 }}>
                        {row.title}
                        {row.description && (
                          <Typography sx={{ color: '#9ca3af', fontSize: 12 }}>{row.description}</Typography>
                        )}
                      </TableCell>
                      <TableCell sx={{ color: '#e4e6eb', fontSize: 12 }}>{row.discount_type || '—'}</TableCell>
                      <TableCell sx={{ color: '#9ca3af', fontSize: 12 }}>
                        {row.start_date || '即日起'} 至 {row.end_date || '长期'}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={row.provenance === 'site' ? '官网' : '待确认'}
                          sx={{
                            height: 18, fontSize: 11,
                            bgcolor: row.provenance === 'site' ? 'rgba(74,222,128,0.15)' : 'rgba(251,191,36,0.15)',
                            color: row.provenance === 'site' ? '#4ade80' : '#fbbf24',
                          }}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setAiOpen(false)} disabled={aiSaving} sx={{ color: '#9ca3af' }}>取消</Button>
          <Button
            onClick={handleImportSuggestions}
            variant="contained"
            disabled={aiSaving || aiRows.length === 0}
            sx={{ bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' }, px: 4, borderRadius: 2 }}
          >
            {aiSaving ? '写入中...' : `写入勾选 (${aiChecked.filter(Boolean).length})`}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(notice)} autoHideDuration={6000} onClose={() => setNotice(null)}>
        <Alert onClose={() => setNotice(null)} severity="success" variant="filled" sx={{ width: '100%' }}>
          {notice}
        </Alert>
      </Snackbar>

      {/* 对话框 */}
      <Dialog open={dialogOpen} onClose={() => !submitting && setDialogOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { bgcolor: '#1e2028', color: '#e4e6eb', borderRadius: 3, p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>{currentPromo?.id ? '编辑优惠活动' : '发布新优惠活动'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="银行名称" required value={currentPromo?.bank_name || ''} onChange={(e) => setCurrentPromo({ ...currentPromo, bank_name: e.target.value })} InputLabelProps={{ style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="活动标题" required value={currentPromo?.title || ''} onChange={(e) => setCurrentPromo({ ...currentPromo, title: e.target.value })} InputLabelProps={{ style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Autocomplete
                options={cardProducts}
                getOptionLabel={(option) => `${option.bank_name} - ${option.card_name}`}
                value={cardProducts.find(cp => cp.id === currentPromo?.card_product_id) || null}
                onChange={(_, newValue) => setCurrentPromo({ ...currentPromo, card_product_id: newValue?.id, bank_name: newValue?.bank_name || currentPromo?.bank_name })}
                renderInput={(params) => (
                  <TextField {...params} label="关联卡产品 (可选)" InputLabelProps={{ style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="开始日期" type="date" value={currentPromo?.start_date || ''} onChange={(e) => setCurrentPromo({ ...currentPromo, start_date: e.target.value })} InputLabelProps={{ shrink: true, style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="结束日期" type="date" value={currentPromo?.end_date || ''} onChange={(e) => setCurrentPromo({ ...currentPromo, end_date: e.target.value })} InputLabelProps={{ shrink: true, style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="折扣类型" select value={currentPromo?.discount_type || '满减'} onChange={(e) => setCurrentPromo({ ...currentPromo, discount_type: e.target.value })} InputLabelProps={{ style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}>
                <MenuItem value="满减">满减</MenuItem>
                <MenuItem value="折扣">折扣</MenuItem>
                <MenuItem value="积分">积分</MenuItem>
                <MenuItem value="返现">返现</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="最大使用次数" type="number" value={currentPromo?.max_uses || ''} onChange={(e) => setCurrentPromo({ ...currentPromo, max_uses: Number(e.target.value) })} InputLabelProps={{ style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField fullWidth label="详细描述/条件" multiline rows={3} value={currentPromo?.description || ''} onChange={(e) => setCurrentPromo({ ...currentPromo, description: e.target.value })} InputLabelProps={{ style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: '#9ca3af' }}>取消</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={submitting} sx={{ bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' }, px: 4, borderRadius: 2 }}>确定</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
