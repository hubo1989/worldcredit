'use client'

import { useState, useEffect } from 'react'
import {
  Box, Typography, Paper, Button, TextField, InputAdornment,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TablePagination,
  IconButton, Switch, Dialog, DialogTitle, DialogContent,
  DialogActions, Grid, CircularProgress, Autocomplete,
  Snackbar, Alert, Avatar, Chip
} from '@mui/material'
import {
  Add as AddIcon,
  Search as SearchIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material'
import { getAdminBanks, createBank, updateBank, deleteBank } from '@/lib/api/admin'
import { Bank } from '@/lib/types'
import { COUNTRIES } from '@/lib/constants'
import AiCompleteButton from '@/components/admin/AiCompleteButton'
import { enrichBankFromWeb, type BankEnrichment } from '@/lib/api/ai'

export default function BanksPage() {
  const [loading, setLoading] = useState(true)
  const [banks, setBanks] = useState<Bank[]>([])
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentBank, setCurrentBank] = useState<Partial<Bank> | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [filterCountry, setFilterCountry] = useState<string>('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  // 「按真实内容补全」：抓官网页面为证，结果先在弹窗里审阅再决定写不写
  const [enriching, setEnriching] = useState(false)
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0 })
  const [enrichRows, setEnrichRows] = useState<BankEnrichment[]>([])
  const [enrichOpen, setEnrichOpen] = useState(false)

  /** 只补「缺字段」的银行；全部有值就没必要打外网。 */
  const banksMissingFields = (list: Bank[]) =>
    list.filter(b => !b.full_name || !b.customer_service_phone || !b.website_url)

  const handleEnrich = async (targets: Bank[]) => {
    if (enriching || targets.length === 0) return
    setEnriching(true)
    setEnrichProgress({ done: 0, total: targets.length })
    const acc: BankEnrichment[] = []
    try {
      // 串行：每次都打外网 + 调模型，并发会把第三方站点打急眼，也更容易触发限流
      for (const bank of targets) {
        try {
          acc.push(await enrichBankFromWeb({
            id: bank.id,
            name: bank.name,
            country: bank.country,
            website_url: bank.website_url,
          }))
        } catch (err) {
          acc.push({
            id: bank.id,
            name: bank.name,
            full_name: null,
            customer_service_phone: null,
            website_url: null,
            fetched: [],
            fetchErrors: [err instanceof Error ? err.message : '补全失败'],
            provenance: { full_name: 'none', customer_service_phone: 'none', website_url: 'none' },
            domainConsistent: false,
          })
        }
        setEnrichProgress({ done: acc.length, total: targets.length })
      }
      setEnrichRows(acc)
      setEnrichOpen(true)
    } finally {
      setEnriching(false)
    }
  }

  /** 写入只有「官网页面上直接读到」的字段，模型凭记忆给的候选一律不自动写。 */
  const handleApplyEnrichment = async () => {
    setSubmitting(true)
    try {
      let applied = 0
      for (const row of enrichRows) {
        const patch: Partial<Bank> = {}
        if (row.provenance.full_name === 'site' && row.full_name) patch.full_name = row.full_name
        if (row.provenance.customer_service_phone === 'site' && row.customer_service_phone) {
          patch.customer_service_phone = row.customer_service_phone
        }
        if (row.provenance.website_url === 'site' && row.website_url) patch.website_url = row.website_url
        if (Object.keys(patch).length === 0) continue
        await updateBank(row.id, patch)
        applied++
      }
      setEnrichOpen(false)
      setEnrichRows([])
      await fetchData()
      setNotice(`已写入 ${applied} 家银行（仅官网页面上直接读到的字段）`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '写入失败')
    } finally {
      setSubmitting(false)
    }
  }

  const fetchData = async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const data = await getAdminBanks()
      setBanks(data || [])
    } catch (error) {
      console.error('Failed to fetch banks:', error)
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
  }, [search, filterCountry])

  const filteredBanks = banks.filter(b => {
    const matchesSearch = b.name.toLowerCase().includes(search.toLowerCase())
    const matchesCountry = filterCountry === 'all' || b.country === filterCountry
    return matchesSearch && matchesCountry
  })

  const paginatedBanks = filteredBanks.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  const handleChangePage = (event: unknown, newPage: number) => {
    setPage(newPage)
  }

  const handleChangeRowsPerPage = (event: React.ChangeEvent<HTMLInputElement>) => {
    setRowsPerPage(parseInt(event.target.value, 10))
    setPage(0)
  }

  const handleOpenDialog = (bank?: Bank) => {
    if (bank) {
      setCurrentBank(bank)
    } else {
      setCurrentBank({
        name: '',
        country: 'CN',
        is_active: true
      })
    }
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个银行吗？')) return
    try {
      await deleteBank(id)
      setBanks(banks.filter(b => b.id !== id))
    } catch (error) {
      console.error('Failed to delete bank:', error)
    }
  }

  const handleToggleStatus = async (bank: Bank) => {
    try {
      await updateBank(bank.id, { is_active: !bank.is_active })
      setBanks(banks.map(b => b.id === bank.id ? { ...b, is_active: !b.is_active } : b))
    } catch (error) {
      console.error('Failed to toggle status:', error)
    }
  }

  const [saveError, setSaveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!currentBank?.name) {
      setSaveError('请填写银行名称')
      return
    }

    setSubmitting(true)
    setSaveError(null)
    try {
      // 清理只读字段，只保留可写字段
      const { id, created_at, ...payload } = currentBank
      void id
      void created_at

      if (currentBank.id) {
        const updated = await updateBank(currentBank.id, payload)
        setBanks(banks.map(b => b.id === currentBank.id ? { ...b, ...updated } : b))
      } else {
        const created = await createBank(payload)
        setBanks([created, ...banks])
      }
      setDialogOpen(false)
    } catch (error) {
      console.error('Failed to save bank:', error)
      setSaveError(`保存失败: ${error instanceof Error ? error.message : '可能由于名称重复或其他错误'}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 4 }}>
        <Box>
          <Typography variant="h4" sx={{ color: '#e4e6eb', fontWeight: 700, mb: 0.5 }}>
            银行管理
          </Typography>
          <Typography variant="body2" sx={{ color: '#9ca3af' }}>
            维护系统中支持的银行列表及所属国家
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
          新增银行
        </Button>
      </Box>

      <Paper sx={{ p: 2, mb: 3, bgcolor: '#181a24', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <Grid container spacing={2} alignItems="center">
          <Grid size={{ xs: 12, md: 4 }}>
            <TextField
              fullWidth
              size="small"
              placeholder="搜索银行名称..."
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
          <Grid size={{ xs: 12, md: 4 }}>
            <Autocomplete
              size="small"
              options={[{ code: 'all', label: '全部国家', name: '全部' }, ...COUNTRIES]}
              getOptionLabel={(option) => option.label}
              value={[{ code: 'all', label: '全部国家', name: '全部' }, ...COUNTRIES].find(c => c.code === filterCountry) || null}
              onChange={(_, newValue) => setFilterCountry(newValue?.code || 'all')}
              renderInput={(params) => (
                <TextField 
                  {...params} 
                  label="按国家筛选" 
                  InputLabelProps={{ style: { color: '#9ca3af' } }}
                  sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb', bgcolor: 'rgba(255,255,255,0.03)' } }}
                />
              )}
              slotProps={{
                paper: { sx: { bgcolor: '#1e2028', color: '#e4e6eb' } }
              }}
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }} sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={enriching ? <CircularProgress size={16} color="inherit" /> : <RefreshIcon />}
              disabled={enriching || banksMissingFields(filteredBanks).length === 0}
              onClick={() => handleEnrich(banksMissingFields(filteredBanks))}
              sx={{ mr: 1, color: '#a5b4fc', borderColor: 'rgba(165,180,252,0.4)', textTransform: 'none' }}
            >
              {enriching
                ? `补全中 ${enrichProgress.done}/${enrichProgress.total}`
                : `按真实内容补全 (${banksMissingFields(filteredBanks).length})`}
            </Button>
            <IconButton aria-label="刷新" onClick={fetchData} sx={{ color: '#9ca3af' }}>
              <RefreshIcon />
            </IconButton>
          </Grid>
        </Grid>
      </Paper>

      <TableContainer component={Paper} sx={{ bgcolor: '#181a24', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 2 }}>
        <Table>
          <TableHead sx={{ bgcolor: 'rgba(255,255,255,0.02)' }}>
            <TableRow>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600, width: 60 }}>图标</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>银行名称</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>国家</TableCell>
              <TableCell sx={{ color: '#9ca3af', fontWeight: 600 }}>状态</TableCell>
              <TableCell align="right" sx={{ color: '#9ca3af', fontWeight: 600 }}>操作</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 10 }}>
                  <CircularProgress size={24} sx={{ color: '#818cf8' }} />
                </TableCell>
              </TableRow>
            ) : filteredBanks.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} align="center" sx={{ py: 10, color: '#9ca3af' }}>
                  {fetchError ? `加载失败: ${fetchError}` : '暂无银行数据'}
                </TableCell>
              </TableRow>
            ) : (
              paginatedBanks.map((bank) => (
                <TableRow key={bank.id} sx={{ '&:hover': { bgcolor: 'rgba(255,255,255,0.02)' } }}>
                  <TableCell sx={{ py: 1 }}>
                    <Avatar
                      src={bank.logo_url || undefined}
                      variant="rounded"
                      sx={{ width: 36, height: 36, bgcolor: '#2a2d3a', fontSize: 14, color: '#9ca3af' }}
                    >
                      {bank.name?.charAt(0)}
                    </Avatar>
                  </TableCell>
                  <TableCell sx={{ color: '#e4e6eb', fontWeight: 500 }}>{bank.name}</TableCell>
                  <TableCell sx={{ color: '#e4e6eb' }}>
                    {COUNTRIES.find(c => c.code === bank.country)?.label || bank.country}
                  </TableCell>
                  <TableCell>
                    <Switch
                      size="small"
                      checked={bank.is_active}
                      onChange={() => handleToggleStatus(bank)}
                      sx={{
                        '& .MuiSwitch-switchBase.Mui-checked': { color: '#10b981' },
                        '& .MuiSwitch-switchBase.Mui-checked + .MuiSwitch-track': { bgcolor: '#10b981' }
                      }}
                    />
                  </TableCell>
                  <TableCell align="right">
                    <IconButton aria-label="编辑" size="small" onClick={() => handleOpenDialog(bank)} sx={{ color: '#9ca3af' }}>
                      <EditIcon fontSize="small" />
                    </IconButton>
                    <IconButton aria-label="删除" size="small" onClick={() => handleDelete(bank.id)} sx={{ color: '#f43f5e', ml: 1 }}>
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
          count={filteredBanks.length}
          page={page}
          onPageChange={handleChangePage}
          rowsPerPage={rowsPerPage}
          onRowsPerPageChange={handleChangeRowsPerPage}
          labelRowsPerPage="每页行数:"
          sx={{ color: '#9ca3af', borderTop: '1px solid rgba(255,255,255,0.06)' }}
        />
      </TableContainer>

      <Dialog open={dialogOpen} onClose={() => !submitting && setDialogOpen(false)} maxWidth="xs" fullWidth PaperProps={{ sx: { bgcolor: '#1e2028', color: '#e4e6eb', borderRadius: 3 } }}>
        <DialogTitle>{currentBank?.id ? '编辑银行' : '新增银行'}</DialogTitle>
        <DialogContent sx={{ bgcolor: '#1e2028', pt: 1 }}>
          <Box sx={{ mb: 2, display: 'flex', justifyContent: 'flex-end' }}>
            <AiCompleteButton
              type="bank"
              formData={currentBank || {}}
              onComplete={(data) => setCurrentBank({ ...currentBank, ...data })}
              availableFields={[
                { key: 'full_name', label: '银行全称' },
                { key: 'customer_service_phone', label: '客服电话' },
                { key: 'website_url', label: '官方网站' }
              ]}
            />
          </Box>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                label="银行简称 (如 招商银行)"
                required
                value={currentBank?.name || ''}
                onChange={(e) => setCurrentBank({ ...currentBank, name: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                label="银行全称"
                value={currentBank?.full_name || ''}
                onChange={(e) => setCurrentBank({ ...currentBank, full_name: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="客服电话"
                value={currentBank?.customer_service_phone || ''}
                onChange={(e) => setCurrentBank({ ...currentBank, customer_service_phone: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                label="官网地址"
                value={currentBank?.website_url || ''}
                onChange={(e) => setCurrentBank({ ...currentBank, website_url: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <TextField
                fullWidth
                label="Logo URL"
                value={currentBank?.logo_url || ''}
                onChange={(e) => setCurrentBank({ ...currentBank, logo_url: e.target.value })}
                InputLabelProps={{ style: { color: '#9ca3af' } }}
                sx={{ '& .MuiOutlinedInput-root': { color: '#e4e6eb' } }}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Autocomplete
                fullWidth
                options={COUNTRIES}
                getOptionLabel={(option) => option.label}
                value={COUNTRIES.find(c => c.code === currentBank?.country) || COUNTRIES[0]}
                onChange={(_, newValue) => {
                  setCurrentBank({ ...currentBank, country: newValue?.code || 'CN' })
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
          </Grid>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setDialogOpen(false)} sx={{ color: '#9ca3af' }}>取消</Button>
          <Button onClick={handleSubmit} variant="contained" disabled={submitting} sx={{ bgcolor: 'primary.main', px: 4 }}>
            {submitting ? '保存中...' : '确定'}
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(saveError)}
        autoHideDuration={8000}
        onClose={() => setSaveError(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSaveError(null)}
          severity="error"
          variant="filled"
          sx={{ width: '100%', whiteSpace: 'pre-wrap' }}
        >
          {saveError}
        </Alert>
      </Snackbar>

      <Snackbar
        open={Boolean(notice)}
        autoHideDuration={6000}
        onClose={() => setNotice(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
      >
        <Alert onClose={() => setNotice(null)} severity="success" variant="filled" sx={{ width: '100%' }}>
          {notice}
        </Alert>
      </Snackbar>

      {/* 审阅弹窗：只有官网页面上直接读到的字段会被写入，模型凭记忆给的候选只展示不落库 */}
      <Dialog open={enrichOpen} onClose={() => !submitting && setEnrichOpen(false)} maxWidth="md" fullWidth PaperProps={{ sx: { bgcolor: '#1e2028', color: '#e4e6eb', borderRadius: 3 } }}>
        <DialogTitle>按真实内容补全（以官网页面为证）</DialogTitle>
        <DialogContent sx={{ bgcolor: '#1e2028' }}>
          <Typography sx={{ color: '#9ca3af', fontSize: 13, mb: 2 }}>
            每行的「官网」域名来自模型提名，电话与全称只在该行官网页面上直接读到时才标为「官网」并会被写入；
            标为「待确认」的是模型记忆里的候选，需要你人工核对后手动填写。未抓到页面的行不会写入任何内容。
          </Typography>
          <TableContainer component={Paper} sx={{ bgcolor: '#181a24', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ color: '#9ca3af' }}>银行</TableCell>
                  <TableCell sx={{ color: '#9ca3af' }}>全称</TableCell>
                  <TableCell sx={{ color: '#9ca3af' }}>客服电话</TableCell>
                  <TableCell sx={{ color: '#9ca3af' }}>官网</TableCell>
                  <TableCell sx={{ color: '#9ca3af' }}>依据</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {enrichRows.map(row => {
                  const tag = (p: 'site' | 'model' | 'none') =>
                    p === 'site' ? (
                      <Chip size="small" label="官网" sx={{ height: 18, fontSize: 11, bgcolor: 'rgba(74,222,128,0.15)', color: '#4ade80' }} />
                    ) : p === 'model' ? (
                      <Chip size="small" label="待确认" sx={{ height: 18, fontSize: 11, bgcolor: 'rgba(251,191,36,0.15)', color: '#fbbf24' }} />
                    ) : null
                  return (
                    <TableRow key={row.id}>
                      <TableCell sx={{ color: '#e4e6eb' }}>{row.name}</TableCell>
                      <TableCell sx={{ color: '#e4e6eb', fontSize: 12 }}>
                        {row.full_name || '—'} {tag(row.provenance.full_name)}
                      </TableCell>
                      <TableCell sx={{ color: '#e4e6eb', fontSize: 12 }}>
                        {row.customer_service_phone || '—'} {tag(row.provenance.customer_service_phone)}
                      </TableCell>
                      <TableCell sx={{ color: '#93c5fd', fontSize: 12 }}>
                        {row.website_url || '—'} {tag(row.provenance.website_url)}
                      </TableCell>
                      <TableCell sx={{ color: '#9ca3af', fontSize: 11 }}>
                        {row.fetched.length > 0
                          ? `已抓 ${row.fetched.length} 页${row.domainConsistent ? '' : '（域名未能对上，请留意）'}`
                          : row.fetchErrors.length > 0
                            ? `未抓到：${row.fetchErrors[0]} `.slice(0, 60)
                            : '无依据'}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </DialogContent>
        <DialogActions sx={{ p: 3 }}>
          <Button onClick={() => setEnrichOpen(false)} disabled={submitting} sx={{ color: '#9ca3af' }}>取消</Button>
          <Button onClick={handleApplyEnrichment} variant="contained" disabled={submitting} sx={{ bgcolor: 'primary.main', px: 4 }}>
            {submitting ? '写入中...' : '写入已确认字段'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
