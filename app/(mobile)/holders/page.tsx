// app/(mobile)/holders/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  Box, Typography, Fab, Skeleton, TextField, InputAdornment,
  Button, Alert, Dialog, DialogTitle, DialogContent, DialogActions,
  CircularProgress, List, ListItem, ListItemText, Divider,
} from '@mui/material'
import { Add as AddIcon, Search as SearchIcon, Refresh as RefreshIcon, Link as LinkIcon } from '@mui/icons-material'
import { getHoldersWithStats, createHolder, autoBindHoldersByEmail } from '@/lib/api/holders'
import type { HolderWithStats } from '@/lib/api/holders'
import { HolderCard } from '@/components/mobile/HolderCard'
import { HolderForm } from '@/components/mobile/HolderForm'
import { useAuth } from '@/lib/auth'
import { asRole, getErrorMessage } from '@/lib/permissions'
import { usePermission } from '@/lib/hooks/usePermission'

export default function HoldersPage() {
  const [holders, setHolders] = useState<HolderWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [autoBindDialogOpen, setAutoBindDialogOpen] = useState(false)
  const [autoBinding, setAutoBinding] = useState(false)
  const [autoBindResult, setAutoBindResult] = useState<{ boundCount: number; unmatched: string[]; multipleMatches: string[] } | null>(null)
  const [search, setSearch] = useState('')
  const { user, profile } = useAuth()
  const router = useRouter()
  const { canManage } = usePermission()

  const loadHolders = useCallback(async () => {
    if (!user || !profile) return
    setLoading(true)
    setError(null)
    try {
      const data = await getHoldersWithStats(profile.id, asRole(profile))
      setHolders(data)
    } catch (err: unknown) {
      setError(getErrorMessage(err))
    } finally {
      setLoading(false)
    }
  }, [user, profile])

  useEffect(() => { loadHolders() }, [loadHolders])

  const handleCreate = async (data: { name: string; phone?: string; email?: string; avatar_color: string }) => {
    if (!profile) throw new Error('未登录')
    await createHolder({ ...data, managed_by: profile.id })
    loadHolders()
  }

  const handleAutoBind = async () => {
    if (!profile) return
    setAutoBinding(true)
    setAutoBindResult(null)
    try {
      const result = await autoBindHoldersByEmail(profile.id)
      setAutoBindResult(result)
      if (result.boundCount > 0) {
        loadHolders()
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err))
    } finally {
      setAutoBinding(false)
    }
  }

  const filtered = search.trim()
    ? holders.filter(h =>
        h.name.toLowerCase().includes(search.toLowerCase()) ||
        (h.phone && h.phone.includes(search))
      )
    : holders

  const totalPending = holders.reduce((sum, h) => sum + h.stats.pendingAmount, 0)

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" fontWeight={800}>持卡人</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {canManage && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<LinkIcon />}
              onClick={() => setAutoBindDialogOpen(true)}
            >
              自动绑定
            </Button>
          )}
          <Typography variant="body2" color="text.secondary">
            共 {holders.length} 人
          </Typography>
        </Box>
      </Box>

      {/* 汇总条 */}
      {holders.length > 0 && (
        <Box
          sx={{
            display: 'flex',
            gap: 2,
            mb: 2,
            p: 1.5,
            borderRadius: 2,
            bgcolor: totalPending > 0 ? 'error.50' : 'grey.50',
            border: 1,
            borderColor: totalPending > 0 ? 'error.100' : 'grey.200',
          }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            待还总额
          </Typography>
          <Typography variant="body2" fontWeight={700} color={totalPending > 0 ? 'error.main' : 'text.primary'}>
            ¥{totalPending.toLocaleString('zh-CN', { minimumFractionDigits: 2 })}
          </Typography>
        </Box>
      )}

      {/* 搜索 */}
      {holders.length > 3 && (
        <TextField
          fullWidth
          size="small"
          placeholder="搜索持卡人姓名或手机号"
          value={search}
          onChange={e => setSearch(e.target.value)}
          sx={{ mb: 2 }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon sx={{ fontSize: 20, color: 'text.secondary' }} />
              </InputAdornment>
            ),
          }}
        />
      )}

      {/* 错误状态 */}
      {error && (
        <Alert
          severity="error"
          action={
            <Button size="small" startIcon={<RefreshIcon />} onClick={loadHolders}>
              重试
            </Button>
          }
          sx={{ mb: 2 }}
        >
          {error}
        </Alert>
      )}

      {/* 列表 */}
      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={120} sx={{ mb: 1.5, borderRadius: 3 }} />
        ))
      ) : filtered.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" sx={{ mt: 4 }}>
          {holders.length === 0 ? '还没有持卡人，点击右下角添加' : '没有匹配的持卡人'}
        </Typography>
      ) : (
        filtered.map(h => (
          <HolderCard
            key={h.id}
            holder={h}
            onClick={() => router.push(`/holders/${h.id}`)}
          />
        ))
      )}

      {canManage && (
        <Fab
          color="primary"
          sx={{ position: 'fixed', bottom: 80, right: 16 }}
          onClick={() => setFormOpen(true)}
        >
          <AddIcon />
        </Fab>
      )}

      <HolderForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleCreate}
      />

      {/* 自动绑定对话框 */}
      {canManage && <Dialog open={autoBindDialogOpen} onClose={() => setAutoBindDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>自动绑定成员账号</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            系统将按持卡人邮箱自动匹配成员账号并绑定。此操作不会覆盖已有绑定。
          </Typography>

          {autoBinding && (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress />
            </Box>
          )}

          {autoBindResult && !autoBinding && (
            <Box sx={{ mt: 2 }}>
              <Alert severity={autoBindResult.boundCount > 0 ? 'success' : 'info'} sx={{ mb: 2 }}>
                成功绑定 {autoBindResult.boundCount} 个持卡人
              </Alert>

              {autoBindResult.unmatched.length > 0 && (
                <>
                  <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1 }}>
                    未匹配邮箱 ({autoBindResult.unmatched.length})
                  </Typography>
                  <List dense sx={{ bgcolor: 'grey.50', borderRadius: 1, mb: 2 }}>
                    {autoBindResult.unmatched.map((email, i) => (
                      <ListItem key={i} divider={i < autoBindResult.unmatched.length - 1}>
                        <ListItemText primary={email} />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}

              {autoBindResult.multipleMatches.length > 0 && (
                <>
                  <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 1, color: 'warning.main' }}>
                    邮箱对应多个账号 ({autoBindResult.multipleMatches.length})
                  </Typography>
                  <List dense sx={{ bgcolor: 'warning.50', borderRadius: 1 }}>
                    {autoBindResult.multipleMatches.map((text, i) => (
                      <ListItem key={i} divider={i < autoBindResult.multipleMatches.length - 1}>
                        <ListItemText primary={text} />
                      </ListItem>
                    ))}
                  </List>
                </>
              )}
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => {
            setAutoBindDialogOpen(false)
            setAutoBindResult(null)
          }} disabled={autoBinding}>
            {autoBindResult ? '关闭' : '取消'}
          </Button>
          {!autoBindResult && (
            <Button
              variant="contained"
              onClick={handleAutoBind}
              disabled={autoBinding}
              startIcon={autoBinding && <CircularProgress size={16} />}
            >
              {autoBinding ? '绑定中…' : '开始绑定'}
            </Button>
          )}
        </DialogActions>
      </Dialog>}
    </Box>
  )
}
