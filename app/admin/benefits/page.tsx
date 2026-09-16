'use client'

import { useState, useEffect } from 'react'
import {
  Box, Typography, Paper, Button, TextField, InputAdornment,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  IconButton, Switch, Chip, Dialog, DialogTitle, DialogContent,
  DialogActions, Grid, MenuItem, CircularProgress, Autocomplete, TablePagination
} from '@mui/material'
import {
  Add as AddIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material'
import { getAdminBenefits, createBenefit, updateBenefit, deleteBenefit, getAdminCardProducts } from '@/lib/api/admin'
import { Benefit, CardProduct } from '@/lib/types'

/** 权益列表行： benefits 字段 + 关联卡产品联查字段 */
type AdminBenefitRow = Benefit & {
  is_active: boolean
  // The admin RPC returns flat joined columns (product_bank_name/product_card_name),
  // not a nested card_products object.
  product_bank_name?: string
  product_card_name?: string
}

export default function BenefitsPage() {
  const [loading, setLoading] = useState(true)
  const [benefits, setBenefits] = useState<AdminBenefitRow[]>([])
  const [cardProducts, setCardProducts] = useState<CardProduct[]>([])
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentBenefit, setCurrentBenefit] = useState<Partial<AdminBenefitRow> | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [bData, cpData] = await Promise.all([
        getAdminBenefits(),
        getAdminCardProducts()
      ])
      setBenefits(bData as unknown as AdminBenefitRow[])
      setCardProducts(cpData)
    } catch (error) {
      console.error('Failed to fetch benefits:', error)
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

  const filteredBenefits = benefits.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    (b.product_card_name || '').toLowerCase().includes(search.toLowerCase())
  )

  const paginatedBenefits = filteredBenefits.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage)
  }

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10))
    setPage(0)
  }

  const handleOpenDialog = (benefit?: AdminBenefitRow) => {
    if (benefit) {
      setCurrentBenefit(benefit)
    } else {
      setCurrentBenefit({
        name: '',
        quota: 1,
        period: 'yearly',
        is_active: true
      })
    }
    setDialogOpen(true)
  }

  const handleToggleStatus = async (benefit: AdminBenefitRow) => {
    try {
      await updateBenefit(benefit.id, { is_active: !benefit.is_active } as unknown as Partial<Benefit>)
      setBenefits(benefits.map(b => b.id === benefit.id ? { ...b, is_active: !b.is_active } : b))
    } catch (error) {
      console.error('Failed to toggle status:', error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个权益配置吗？这将影响所有持有此卡的用户。')) return
    try {
      await deleteBenefit(id)
      setBenefits(benefits.filter(b => b.id !== id))
    } catch (error) {
      console.error('Failed to delete benefit:', error)
    }
  }

  const handleSubmit = async () => {
    if (!currentBenefit?.card_product_id || !currentBenefit?.name) {
      alert('请选择卡产品并填写权益名称')
      return
    }

    setSubmitting(true)
    try {
      if (currentBenefit.id) {
        const { product_bank_name, product_card_name, ...payload } = currentBenefit
        void product_bank_name
        void product_card_name
        const updated = await updateBenefit(currentBenefit.id, payload)
        setBenefits(benefits.map(b => b.id === currentBenefit.id ? { ...b, ...updated } as AdminBenefitRow : b))
      } else {
        const created = await createBenefit(currentBenefit)
        setBenefits([created as unknown as AdminBenefitRow, ...benefits])
      }
      setDialogOpen(false)
      fetchData()
    } catch (error) {
      console.error('Failed to save benefit:', error)
      alert('保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ color: '#e4e6eb', fontWeight: 700, mb: 0.5 }}>
            卡产品权益管理
          </Typography>
          <Typography variant="body2" sx={{ color: '#9ca3af' }}>
            配置信用卡的各类权益（如接送机、贵宾厅、酒店积分等）及其使用限额
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
          sx={{ bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' }, textTransform: 'none', borderRadius: 2, px: 3 }}
        >
          添加权益
        </Button>
      </Box>

      {/* 搜索 */}
      <Paper sx={{ p: 2, mb: 3, bgcolor: '#181a24', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="搜索权益名称或所属卡片..."
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
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>所属卡产品</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>权益名称</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>配额/频率</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>重置规则</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>状态</TableCell>
              <TableCell align="right" sx={{ color: '#9ca3af', fontWeight: 600 }}>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 10 }}><CircularProgress size={24} sx={{ color: '#818cf8' }} /></TableCell></TableRow>
            ) : filteredBenefits.length === 0 ? (
              <TableRow><TableCell colSpan={6} align="center" sx={{ py: 10, color: '#9ca3af' }}>当前暂无权益数据</TableCell></TableRow>
            ) : (
              paginatedBenefits.map((benefit) => (
                <TableRow key={benefit.id} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' }, borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <TableCell sx={{ color: '#e4e6eb', fontWeight: 500 }}>
                    {benefit.product_bank_name} - {benefit.product_card_name}
                  </TableCell>
                  <TableCell sx={{ color: '#e4e6eb' }}>{benefit.name}</TableCell>
                  <TableCell>
                    <Chip
                      label={`${benefit.quota} 次 / ${benefit.period === 'yearly' ? '年' : benefit.period === 'monthly' ? '月' : '终身'}`}
                      size="small"
                      sx={{ bgcolor: 'rgba(99, 102, 241, 0.1)', color: '#818cf8', fontSize: 11 }}
                    />
                  </TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontSize: 13 }}>
                    {benefit.period === 'yearly' ? `${benefit.reset_month || 1} 月重置` : benefit.period === 'monthly' ? '每月末重置' : '不重置'}
                  </TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={benefit.is_active}
                      onChange={() => handleToggleStatus(benefit)}
                      sx={{ '& .MuiSwitch-switchBase.Mui-checked': { color: '#10b981' }, '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#10b981' } }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton aria-label="编辑" size="small" onClick={() => handleOpenDialog(benefit)} sx={{ color: '#9ca3af' }}><EditIcon fontSize="small" /></IconButton>
                    <IconButton aria-label="删除" size="small" onClick={() => handleDelete(benefit.id)} sx={{ color: '#f43f5e', ml: 1 }}><DeleteIcon fontSize="small" /></IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={filteredBenefits.length}
          page={page}
          onPageChange={handleChangePage}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          labelRowsPerPage="每页行数:"
          sx={{ color: '#9ca3af', borderTop: '1px solid rgba(255,255,255,0.06)' }}
        />
      </TableContainer>

      {/* 对话框 */}
      <Dialog open={dialogOpen} onClose={() => !submitting && setDialogOpen(false)} maxWidth="sm" fullWidth PaperProps={{ sx: { bgcolor: '#1e2028', color: '#e4e6eb', borderRadius: 3, p: 1 } }}>
        <DialogTitle sx={{ fontWeight: 700 }}>{currentBenefit?.id ? '编辑权益配置' : '添加新权益'}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12 }}>
              <Autocomplete
                options={cardProducts}
                getOptionLabel={(option) => `${option.bank_name} - ${option.card_name}`}
                value={cardProducts.find(cp => cp.id === currentBenefit?.card_product_id) || null}
                onChange={(_, newValue) => setCurrentBenefit({ ...currentBenefit, card_product_id: newValue?.id })}
                renderInput={(params) => (
                  <TextField {...params} label="所属卡产品" required InputLabelProps={{ style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
                )}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField fullWidth label="权益名称" placeholder="例如：机场贵宾厅服务" required value={currentBenefit?.name || ''} onChange={(e) => setCurrentBenefit({ ...currentBenefit, name: e.target.value })} InputLabelProps={{ style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="权益配额 (次)" type="number" value={currentBenefit?.quota || 1} onChange={(e) => setCurrentBenefit({ ...currentBenefit, quota: Number(e.target.value) })} InputLabelProps={{ style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="重置周期" select value={currentBenefit?.period || 'yearly'} onChange={(e) => setCurrentBenefit({ ...currentBenefit, period: e.target.value as Benefit['period'] })} InputLabelProps={{ style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}>
                <MenuItem value="yearly">按年重置</MenuItem>
                <MenuItem value="monthly">按月重置</MenuItem>
                <MenuItem value="one_time">终身一次性</MenuItem>
              </TextField>
            </Grid>
            {currentBenefit?.period === 'yearly' && (
              <Grid size={{ xs: 12, md: 6 }}>
                <TextField fullWidth label="重置月份 (1-12)" type="number" value={currentBenefit?.reset_month || 1} onChange={(e) => setCurrentBenefit({ ...currentBenefit, reset_month: Number(e.target.value) })} InputLabelProps={{ style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
              </Grid>
            )}
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField fullWidth label="到期日期 (可选)" type="date" value={currentBenefit?.expiry_date || ''} onChange={(e) => setCurrentBenefit({ ...currentBenefit, expiry_date: e.target.value })} InputLabelProps={{ shrink: true, style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField fullWidth label="权益说明" multiline rows={3} value={currentBenefit?.description || ''} onChange={(e) => setCurrentBenefit({ ...currentBenefit, description: e.target.value })} InputLabelProps={{ style: { color: '#9ca3af' } }} sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }} />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: '#9ca3af' }}>取消</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={submitting} sx={{ bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' }, px: 4, borderRadius: 2 }}>确认添加</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
