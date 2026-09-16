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
  Refresh as RefreshIcon
} from '@mui/icons-material'
import { 
  getAdminCardProducts, 
  createCardProduct, 
  updateCardProduct, 
  deleteCardProduct,
  getAdminBanks
} from '@/lib/api/admin'
import { CardProduct, Bank } from '@/lib/types'
import { COUNTRIES } from '@/lib/constants'
import AiCompleteButton from '@/components/admin/AiCompleteButton'
import { aiComplete } from '@/lib/api/ai'

export default function CardProductsPage() {
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState<(CardProduct & { is_active: boolean })[]>([])
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentProduct, setCurrentProduct] = useState<Partial<CardProduct & { is_active: boolean }> | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [banks, setBanks] = useState<Bank[]>([])
  const [filterBank, setFilterBank] = useState<string>('all')
  const [filterCountry, setFilterCountry] = useState<string>('all')
  // 批量选择：选中的卡产品 id
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  const fetchData = async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const [productsData, banksData] = await Promise.all([
        getAdminCardProducts(),
        getAdminBanks()
      ])
      setProducts(productsData || [])
      setBanks(banksData || [])
    } catch (error) {
      console.error('Failed to fetch data:', error)
      setFetchError(error instanceof Error ? error.message : 'Unknown fetching error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    setPage(0)
  }, [search, filterBank, filterCountry])

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.bank_name.toLowerCase().includes(search.toLowerCase()) ||
      p.card_name.toLowerCase().includes(search.toLowerCase())
    const matchesBank = filterBank === 'all' || p.bank_id === filterBank || p.bank_name === filterBank
    const matchesCountry = filterCountry === 'all' || p.country === filterCountry
    return matchesSearch && matchesBank && matchesCountry
  })

  const paginatedProducts = filteredProducts.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage)
  }

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10))
    setPage(0)
  }

  const handleOpenDialog = (product?: CardProduct & { is_active: boolean }) => {
    if (product) {
      setCurrentProduct(product)
    } else {
      setCurrentProduct({
        country: 'CN',
        currency: 'CNY',
        payment_due_type: 'after_billing',
        payment_due_value: 20,
        annual_fee: 0,
        is_active: true
      })
    }
    setDialogOpen(true)
  }

  const handleToggleStatus = async (product: CardProduct & { is_active: boolean }) => {
    try {
      await updateCardProduct(product.id, { is_active: !product.is_active })
      setProducts(products.map(p => p.id === product.id ? { ...p, is_active: !p.is_active } : p))
    } catch (error) {
      console.error('Failed to toggle status:', error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个卡产品吗？此操作不可撤销且会影响关联的用户信用卡。')) return
    try {
      await deleteCardProduct(id)
      setProducts(products.filter(p => p.id !== id))
    } catch (error) {
      console.error('Failed to delete product:', error)
    }
  }

  // ── 批量操作 ──────────────────────────────────────────────────────────────
  // 逐条调用既有单条接口而不是新增批量 RPC：单条接口已经带了全部校验与级联语义
  // （例如删除会影响关联用户信用卡），批量版很容易漏掉其中一条变成静默不一致。
  // 顺序执行并在结束时汇总成败，避免「部分成功」被当成全成功。
  const runBatch = async (ids: string[], label: string, fn: (id: string) => Promise<unknown>) => {
    if (ids.length === 0) return
    setSubmitting(true)
    let ok = 0
    const failed: string[] = []
    try {
      for (const id of ids) {
        try {
          await fn(id)
          ok++
        } catch (err) {
          const name = products.find(p => p.id === id)?.card_name || id
          failed.push(`${name}（${err instanceof Error ? err.message : '失败'}）`)
        }
      }
      await fetchData()
      setSelectedIds([])
      if (failed.length === 0) {
        setNotice(`已${label} ${ok} 项`)
      } else {
        setSaveError(`${label}完成 ${ok} 项，${failed.length} 项失败：${failed.slice(0, 3).join('；')}${failed.length > 3 ? ' …' : ''}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleBatchEnable = () => runBatch(selectedIds, '启用', id => updateCardProduct(id, { is_active: true }))
  const handleBatchDisable = () => runBatch(selectedIds, '禁用', id => updateCardProduct(id, { is_active: false }))

  /**
   * 批量 AI 补全：逐条调 aiComplete 再把结果写回。
   *
   * 不盲目覆盖：只写入 AI 返回且当前为空/缺失的字段，已有值保持不动——批量操作
   * 最危险的失败模式就是把人工精心维护过的字段批量冲掉。
   */
  const handleBatchAI = async () => {
    if (selectedIds.length === 0) return
    setSubmitting(true)
    let ok = 0
    const failed: string[] = []
    try {
      for (const id of selectedIds) {
        const product = products.find(p => p.id === id)
        if (!product) continue
        try {
          const result = await aiComplete({
            type: 'card_product',
            data: {
              bank_name: product.bank_name,
              card_name: product.card_name,
              currency: product.currency,
              country: product.country,
            },
          }) as Record<string, unknown>

          const patch: Record<string, unknown> = {}
          const fillable = ['annual_fee', 'annual_fee_waiver', 'rewards_summary', 'description_md', 'apply_url', 'payment_due_type', 'payment_due_value'] as const
          for (const key of fillable) {
            const current = (product as unknown as Record<string, unknown>)[key]
            const next = result?.[key]
            if ((current === null || current === undefined || current === '') && next !== null && next !== undefined) {
              patch[key] = next
            }
          }
          if (Object.keys(patch).length > 0) {
            await updateCardProduct(id, patch as Partial<CardProduct>)
            ok++
          }
        } catch (err) {
          failed.push(`${product.card_name}（${err instanceof Error ? err.message : '失败'}）`)
        }
      }
      await fetchData()
      setSelectedIds([])
      if (failed.length === 0) {
        setNotice(ok > 0 ? `AI 补全完成 ${ok} 项（仅填充空白字段）` : '选中项没有可补全的空白字段')
      } else {
        setSaveError(`AI 补全完成 ${ok} 项，${failed.length} 项失败：${failed.slice(0, 3).join('；')}${failed.length > 3 ? ' …' : ''}`)
      }
    } finally {
      setSubmitting(false)
    }
  }
  const handleBatchDelete = () => {
    if (!confirm(`确定删除选中的 ${selectedIds.length} 个卡产品？此操作不可撤销且会影响关联的用户信用卡。`)) return
    return runBatch(selectedIds, '删除', id => deleteCardProduct(id))
  }

  const handleSubmit = async () => {
    if (!currentProduct?.bank_name || !currentProduct?.card_name) {
      alert('请填写必填项（银行名称、卡片名称）')
      return
    }

    setSubmitting(true)
    try {
      if (currentProduct.id) {
        const updated = await updateCardProduct(currentProduct.id, currentProduct)
        setProducts(products.map(p => p.id === currentProduct.id ? { ...p, ...updated } : p))
      } else {
        const created = await createCardProduct(currentProduct) as unknown as CardProduct & { is_active: boolean }
        setProducts([created, ...products])
      }
      setDialogOpen(false)
    } catch (error) {
      console.error('Failed to save product:', error)
      alert('保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ color: '#e4e6eb', fontWeight: 700, mb: 0.5 }}>
            卡产品管理
          </Typography>
          <Typography variant="body2" sx={{ color: '#9ca3af' }}>
            管理全平台信用卡产品目录、年费政策及账期规则
          </Typography>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => handleOpenDialog()}
          sx={{
            bgcolor: 'primary.main',
            '&:hover': { bgcolor: 'primary.dark' },
            textTransform: 'none',
            borderRadius: 2,
            px: 3
          }}
        >
          新增卡产品
        </Button>
      </Box>

      {/* 过滤器 */}
      <Paper sx={{ p: 2, mb: 3, bgcolor: '#181a24', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="搜索银行或卡片名称..."
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
          <Grid size={{ xs: 12, md: 2.5 }}>
            <TextField
              fullWidth
              size="small"
              select
              label="按银行筛选"
              value={filterBank}
              onChange={(e) => setFilterBank(e.target.value)}
              InputLabelProps={{ shrink: true, style: { color: '#9ca3af' } }}
              sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb', bgcolor: 'rgba(255,255,255,0.03)' } }}
            >
              <MenuItem value="all">全部银行</MenuItem>
              {banks.map(bank => (
                <MenuItem key={bank.id} value={bank.id}>{bank.name}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 2.5 }}>
            <TextField
              fullWidth
              size="small"
              select
              label="按国家筛选"
              value={filterCountry}
              onChange={(e) => setFilterCountry(e.target.value)}
              InputLabelProps={{ shrink: true, style: { color: '#9ca3af' } }}
              sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb', bgcolor: 'rgba(255,255,255,0.03)' } }}
            >
              <MenuItem value="all">全部国家</MenuItem>
              {COUNTRIES.map(c => (
                <MenuItem key={c.code} value={c.code}>{c.label}</MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 12, md: 3 }} sx={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ color: '#9ca3af', fontSize: 13 }}>
              共 {filteredProducts.length} 项
            </Typography>
            <IconButton aria-label="刷新" onClick={fetchData} sx={{ color: '#9ca3af' }}>
              <RefreshIcon />
            </IconButton>
          </Grid>
        </Grid>
      </Paper>

      {/* 数据表格 */}
      <TableContainer component={Paper} sx={{ bgcolor: '#181a24', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>
        {/* 批量操作条：只在有选中项时出现，免得平时占位 */}
        {selectedIds.length > 0 && (
          <Box sx={{
            px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1,
            bgcolor: 'rgba(79,70,229,0.10)', borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <Typography sx={{ color: '#c7d2fe', fontSize: 13, fontWeight: 600, mr: 1 }}>
              已选 {selectedIds.length} 项
            </Typography>
            <Button
              size="small" variant="outlined" disabled={submitting}
              onClick={handleBatchAI}
              sx={{ color: '#c7d2fe', borderColor: 'rgba(199,210,254,0.4)', textTransform: 'none' }}
            >
              AI 补全
            </Button>
            <Button
              size="small" variant="outlined" disabled={submitting}
              onClick={handleBatchEnable}
              sx={{ color: '#4ade80', borderColor: 'rgba(74,222,128,0.4)', textTransform: 'none' }}
            >
              启用
            </Button>
            <Button
              size="small" variant="outlined" disabled={submitting}
              onClick={handleBatchDisable}
              sx={{ color: '#9ca3af', borderColor: 'rgba(156,163,175,0.4)', textTransform: 'none' }}
            >
              禁用
            </Button>
            <Button
              size="small" variant="outlined" disabled={submitting}
              onClick={handleBatchDelete}
              sx={{ color: '#f87171', borderColor: 'rgba(248,113,113,0.4)', textTransform: 'none' }}
            >
              删除
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button size="small" onClick={() => setSelectedIds([])} sx={{ color: '#9ca3af', textTransform: 'none' }}>
              取消选择
            </Button>
          </Box>
        )}
        <Table sx={{ minWidth: 650 }}>
          <TableHead sx={{ bgcolor: 'rgba(255,255,255,0.02)' }}>
            <TableRow>
              <TableCell padding="checkbox" sx={{ color: '#9ca3af', fontWeight: 600, width: 48 }}>
                <Checkbox
                  size="small"
                  indeterminate={selectedIds.length > 0 && selectedIds.length < paginatedProducts.length}
                  checked={paginatedProducts.length > 0 && paginatedProducts.every(p => selectedIds.includes(p.id))}
                  onChange={(e) => {
                    const pageIds = paginatedProducts.map(p => p.id)
                    setSelectedIds(e.target.checked
                      ? [...new Set([...selectedIds, ...pageIds])]
                      : selectedIds.filter(id => !pageIds.includes(id)))
                  }}
                  sx={{ color: '#6b7280', '&.Mui-checked': { color: 'primary.main' } }}
                />
              </TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>银行名称</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>卡片名称</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>年费</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>还款宽限</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>状态</TableCell>
              <TableCell align="right" sx={{ color: '#9ca3af', fontWeight: 600 }}>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 10 }}>
                  <CircularProgress size={24} sx={{ color: '#818cf8' }} />
                </TableCell>
              </TableRow>
            ) : filteredProducts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} align="center" sx={{ py: 10, color: '#9ca3af' }}>
                  {fetchError ? `加载失败: ${fetchError}` : '未检索到卡产品数据'}
                </TableCell>
              </TableRow>
            ) : (
              paginatedProducts.map((product) => (
                <TableRow
                  key={product.id}
                  sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' }, borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                >
                  <TableCell padding="checkbox">
                    <Checkbox
                      size="small"
                      checked={selectedIds.includes(product.id)}
                      onChange={(e) => setSelectedIds(e.target.checked
                        ? [...selectedIds, product.id]
                        : selectedIds.filter(id => id !== product.id))}
                      sx={{ color: '#6b7280', '&.Mui-checked': { color: 'primary.main' } }}
                    />
                  </TableCell>
                  <TableCell sx={{ color: '#e4e6eb', fontWeight: 500 }}>{product.bank_name}</TableCell>
                  <TableCell sx={{ color: '#e4e6eb' }}>{product.card_name}</TableCell>
                  <TableCell sx={{ color: '#e4e6eb' }}>
                    {product.annual_fee ? `${product.currency} ${product.annual_fee}` : '免费'}
                  </TableCell>
                  <TableCell sx={{ color: '#9ca3af', fontSize: 13 }}>
                    {product.payment_due_type === 'after_billing' ? `账单日后 ${product.payment_due_value} 天` : `每月固定 ${product.payment_due_value} 日`}
                  </TableCell>
                  <TableCell>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Switch
                        size="small"
                        checked={product.is_active}
                        onChange={() => handleToggleStatus(product)}
                        sx={{
                          '& .MuiSwitch-switchBase.Mui-checked': { color: '#10b981' },
                          '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#10b981' }
                        }}
                      />
                      <Chip
                        label={product.is_active ? '启用中' : '已禁用'}
                        size="small"
                        sx={{
                          bgcolor: product.is_active ? 'rgba(16, 185, 129, 0.1)' : 'rgba(244, 63, 94, 0.1)',
                          color: product.is_active ? '#10b981' : '#f43f5e',
                          fontSize: 11,
                          fontWeight: 600
                        }}
                      />
                    </Box>
                  </TableCell>
                  <TableCell align="right">
                    <IconButton aria-label="编辑" size="small" onClick={() => handleOpenDialog(product)} sx={{ color: '#9ca3af' }}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton aria-label="删除" size="small" onClick={() => handleDelete(product.id)} sx={{ color: '#f43f5e', ml: 1 }}>
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
        <TablePagination
          component="div"
          count={filteredProducts.length}
          page={page}
          onPageChange={handleChangePage}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          labelRowsPerPage="每页行数:"
          sx={{ color: '#9ca3af', borderTop: '1px solid rgba(255,255,255,0.06)' }}
        />
      </TableContainer>

      {/* 新增/编辑对话框 */}
      <Dialog
        open={dialogOpen}
        onClose={() => !submitting && setDialogOpen(false)}
        maxWidth="sm"
        fullWidth
        PaperProps={{
          sx: { bgcolor: '#1e2028', color: '#e4e6eb', borderRadius: 3, p: 1 }
        }}
      >
        <DialogTitle sx={{ fontWeight: 700 }}>
          {currentProduct?.id ? '编辑卡产品' : '新增卡产品'}
        </DialogTitle>
        <DialogContent sx={{ bgcolor: '#1e2028', pt: 1 }}>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <AiCompleteButton
              type="card_product"
              formData={currentProduct || {}}
              onComplete={(data) => setCurrentProduct({ ...currentProduct, ...data })}
              availableFields={[
                { key: 'description_md', label: '详细介绍 (Markdown)' },
                { key: 'apply_url', label: '申请链接' },
                { key: 'rewards_summary', label: '积分/返现规则' },
                { key: 'annual_fee', label: '年费金额' },
                { key: 'annual_fee_waiver', label: '年费减免政策' }
              ]}
            />
          </Box>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Autocomplete
                fullWidth
                options={banks}
                getOptionLabel={(option) => option.name || ''}
                value={banks.find(b => b.id === currentProduct?.bank_id) || null}
                onChange={(_, newValue) => {
                  setCurrentProduct({ 
                    ...currentProduct, 
                    bank_id: newValue?.id || '',
                    bank_name: newValue?.name || ''
                  })
                }}
                renderInput={(params) => (
                  <TextField 
                    {...params} 
                    label="银行名称" 
                    required 
                    InputLabelProps={{ style: { color: '#9ca3af' } }}
                    sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
                  />
                )}
                slotProps={{
                  paper: { sx: { bgcolor: '#1e2028', color: '#e4e6eb' } }
                }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="卡片全称"
                required
                value={currentProduct?.card_name || ''}
                onChange={(e) => setCurrentProduct({ ...currentProduct, card_name: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label="币种"
                select
                value={currentProduct?.currency || 'CNY'}
                onChange={(e) => setCurrentProduct({ ...currentProduct, currency: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              >
                <MenuItem value="CNY">CNY - 人民币</MenuItem>
                <MenuItem value="USD">USD - 美元</MenuItem>
                <MenuItem value="HKD">HKD - 港币</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <TextField
                fullWidth
                label="年费"
                type="number"
                value={currentProduct?.annual_fee || 0}
                onChange={(e) => setCurrentProduct({ ...currentProduct, annual_fee: Number(e.target.value) })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="申请链接"
                value={currentProduct?.apply_url || ''}
                onChange={(e) => setCurrentProduct({ ...currentProduct, apply_url: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                label="积分/返现规则摘要"
                multiline
                rows={2}
                value={currentProduct?.rewards_summary || ''}
                onChange={(e) => setCurrentProduct({ ...currentProduct, rewards_summary: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Autocomplete
                fullWidth
                options={[{ code: 'CN', name: '中国', label: 'CN - 中国' }, ...COUNTRIES.filter(c => c.code !== 'CN')]}
                getOptionLabel={(option) => option.label}
                value={COUNTRIES.find(c => c.code === currentProduct?.country) || COUNTRIES[0]}
                onChange={(_, newValue) => {
                  setCurrentProduct({ ...currentProduct, country: newValue?.code || 'CN' })
                }}
                renderInput={(params) => (
                  <TextField 
                    {...params} 
                    label="国家" 
                    InputLabelProps={{ style: { color: '#9ca3af' } }}
                    sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
                  />
                )}
                slotProps={{
                  paper: { sx: { bgcolor: '#1e2028', color: '#e4e6eb' } }
                }}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                label="卡片详细介绍 (Markdown)"
                multiline
                rows={4}
                placeholder="支持 Markdown 格式..."
                value={currentProduct?.description_md || ''}
                onChange={(e) => setCurrentProduct({ ...currentProduct, description_md: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                label="年费减免政策"
                multiline
                rows={2}
                placeholder="例如：刷卡 5 次免次年年费"
                value={currentProduct?.annual_fee_waiver || ''}
                onChange={(e) => setCurrentProduct({ ...currentProduct, annual_fee_waiver: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="还款日规则"
                select
                value={currentProduct?.payment_due_type || 'after_billing'}
                onChange={(e) => setCurrentProduct({ ...currentProduct, payment_due_type: e.target.value as 'after_billing' | 'fixed' })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              >
                <MenuItem value="after_billing">账单日后 N 天</MenuItem>
                <MenuItem value="fixed">每月固定日期</MenuItem>
              </TextField>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="规则数值 (天/日)"
                type="number"
                value={currentProduct?.payment_due_value || 20}
                onChange={(e) => setCurrentProduct({ ...currentProduct, payment_due_value: Number(e.target.value) })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: '#9ca3af' }}>取消</Button>
          <Button
            onClick={handleSubmit}
            variant="contained"
            disabled={submitting}
            sx={{ bgcolor: 'primary.main', '&:hover': { bgcolor: 'primary.dark' }, px: 4, borderRadius: 2 }}
          >
            {submitting ? '保存中...' : '确定'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* 批量结果反馈：部分成功必须说清楚，不能静默 */}
      <Snackbar open={Boolean(notice)} autoHideDuration={6000} onClose={() => setNotice(null)}>
        <Alert onClose={() => setNotice(null)} severity="success" variant="filled" sx={{ width: '100%' }}>
          {notice}
        </Alert>
      </Snackbar>
      <Snackbar open={Boolean(saveError)} autoHideDuration={10000} onClose={() => setSaveError(null)}>
        <Alert onClose={() => setSaveError(null)} severity="error" variant="filled" sx={{ width: '100%' }}>
          {saveError}
        </Alert>
      </Snackbar>
    </Box>
  )
}
