'use client'

import { useState, useMemo, useEffect } from 'react'
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
  Stack,
  Avatar,
  Checkbox,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Chip,
  Paper,
  Divider,
  Alert,
  CircularProgress,
} from '@mui/material'
import MergeTypeIcon from '@mui/icons-material/MergeType'
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh'
import type { CardHolder } from '@/lib/types'
import { mergeHolders } from '@/lib/api/holders'

interface Props {
  open: boolean
  onClose: () => void
  holders: CardHolder[]
  cardCounts: Record<string, number>
  onSuccess: () => void
}

export function MergeHoldersDialog({
  open,
  onClose,
  holders,
  cardCounts,
  onSuccess,
}: Props) {
  // 选中的主持卡人 ID（默认选持有卡片最多或者第一个）
  const [primaryId, setPrimaryId] = useState<string>('')
  // 选中的被合并持卡人 ID 列表
  const [sourceIds, setSourceIds] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 当弹窗打开时，初始化默认主持卡人（卡片最多的优先作为主身份）
  useEffect(() => {
    if (open && holders.length > 0) {
      const sorted = [...holders].sort((a, b) => (cardCounts[b.id] || 0) - (cardCounts[a.id] || 0))
      setPrimaryId(sorted[0]?.id || holders[0].id)
      setSourceIds([])
      setError(null)
    }
  }, [open, holders, cardCounts])

  // 主持卡人对象
  const primaryHolder = useMemo(() => {
    return holders.find(h => h.id === primaryId)
  }, [holders, primaryId])

  // 可被合并的备选持卡人列表（排除主持卡人本身）
  const candidateHolders = useMemo(() => {
    return holders.filter(h => h.id !== primaryId)
  }, [holders, primaryId])

  // 智能识别相似别名（如姓氏相同、包含*、包含"先生"/"女士"、或拼音相关的候选人）
  const autoSuggestedIds = useMemo(() => {
    if (!primaryHolder) return []
    const pName = primaryHolder.name.trim()
    const pSurname = pName[0]

    return candidateHolders
      .filter(c => {
        const cName = c.name.trim()
        // 1. 同姓且名字包含 *
        if (cName[0] === pSurname && (cName.includes('*') || cName.includes('先生') || cName.includes('女士'))) {
          return true
        }
        // 2. 名字完全相同（同名重复录入）
        if (cName === pName) return true
        // 3. 通用别名如 "主持卡人"
        if (cName === '主持卡人') return true
        // 4. 拼音或者英文简写（如 ZHANG SAN / SAN ZHANG）
        if (/^[A-Za-z\s]+$/.test(cName)) return true
        return false
      })
      .map(c => c.id)
  }, [primaryHolder, candidateHolders])

  // 一键全选智能推荐的相似身份
  const handleSelectSuggested = () => {
    setSourceIds(autoSuggestedIds)
  }

  // 切换单个源持卡人选择
  const handleToggleSource = (id: string) => {
    setSourceIds(prev =>
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    )
  }

  // 计算将要合并转移的卡片数量
  const transferCardsCount = useMemo(() => {
    return sourceIds.reduce((sum, id) => sum + (cardCounts[id] || 0), 0)
  }, [sourceIds, cardCounts])

  // 收集将被合并的所有名字作为别名预览
  const collectedAliases = useMemo(() => {
    const names = new Set<string>()
    candidateHolders
      .filter(c => sourceIds.includes(c.id))
      .forEach(c => {
        if (c.name && c.name !== primaryHolder?.name) names.add(c.name)
        if (Array.isArray(c.aliases)) {
          c.aliases.forEach(a => {
            if (a && a !== primaryHolder?.name) names.add(a)
          })
        }
      })
    return Array.from(names)
  }, [candidateHolders, sourceIds, primaryHolder])

  // 提交合并
  const handleMerge = async () => {
    if (!primaryId || sourceIds.length === 0) return
    setLoading(true)
    setError(null)
    try {
      await mergeHolders(primaryId, sourceIds)
      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err?.message || '合并持卡人失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onClose={() => !loading && onClose()} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 800 }}>
        <MergeTypeIcon color="primary" />
        持卡人归拢合并
      </DialogTitle>
      <DialogContent dividers>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2.5 }}>
          由于邮件账单中常出现脱敏姓名（如 <strong>张*</strong>、<strong>张先生</strong>、<strong>ZHANG SAN</strong>），您可以将这些重复身份一键归拢合并到真实主持卡人名下。其名下卡片将自动转移，同时沉淀为别名库。
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {/* 1. 选择保留的主身份 */}
        <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
          1. 选择保留的主持卡人 (目标主身份)
        </Typography>
        <FormControl fullWidth size="small" sx={{ mb: 3 }}>
          <InputLabel id="primary-holder-label">主持卡人</InputLabel>
          <Select
            labelId="primary-holder-label"
            value={primaryId}
            label="主持卡人"
            onChange={e => {
              setPrimaryId(e.target.value)
              setSourceIds([]) // 切换主持卡人时重置被合并项
            }}
          >
            {holders.map(h => (
              <MenuItem key={h.id} value={h.id}>
                <Stack direction="row" alignItems="center" spacing={1.5}>
                  <Avatar sx={{ bgcolor: h.avatar_color, width: 24, height: 24, fontSize: 12 }}>
                    {h.name.charAt(0)}
                  </Avatar>
                  <Typography variant="body2" fontWeight={600}>
                    {h.name}
                  </Typography>
                  <Chip
                    label={`${cardCounts[h.id] || 0} 张卡`}
                    size="small"
                    variant="outlined"
                    sx={{ height: 20, fontSize: 11 }}
                  />
                </Stack>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* 2. 选择被归拢的重复持卡人 */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Typography variant="subtitle2" fontWeight={700}>
            2. 选择需要归拢合并进来的重复身份 ({sourceIds.length}/{candidateHolders.length})
          </Typography>
          {autoSuggestedIds.length > 0 && (
            <Button
              size="small"
              variant="text"
              startIcon={<AutoFixHighIcon fontSize="small" />}
              onClick={handleSelectSuggested}
              sx={{ fontSize: 11.5, fontWeight: 700, textTransform: 'none' }}
            >
              智能全选相似 ({autoSuggestedIds.length})
            </Button>
          )}
        </Box>

        {candidateHolders.length === 0 ? (
          <Typography variant="body2" color="text.secondary" sx={{ py: 2, textAlign: 'center' }}>
            没有其他可合并的持卡人
          </Typography>
        ) : (
          <Paper
            variant="outlined"
            sx={{
              maxHeight: 220,
              overflowY: 'auto',
              borderRadius: 2,
              p: 0.5,
              bgcolor: 'var(--bg-subtle, #fafafa)',
              mb: 2.5,
            }}
          >
            <Stack spacing={0.5}>
              {candidateHolders.map(c => {
                const isSelected = sourceIds.includes(c.id)
                const isSuggested = autoSuggestedIds.includes(c.id)
                const count = cardCounts[c.id] || 0

                return (
                  <Paper
                    key={c.id}
                    elevation={0}
                    onClick={() => handleToggleSource(c.id)}
                    sx={{
                      p: 1,
                      px: 1.5,
                      borderRadius: 1.5,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                      bgcolor: isSelected ? 'rgba(30, 58, 138, 0.08)' : '#fff',
                      border: '1px solid',
                      borderColor: isSelected ? 'primary.main' : 'rgba(0,0,0,0.06)',
                      transition: 'all 120ms ease',
                    }}
                  >
                    <Stack direction="row" alignItems="center" spacing={1.5} sx={{ minWidth: 0 }}>
                      <Checkbox
                        size="small"
                        checked={isSelected}
                        onClick={e => e.stopPropagation()}
                        onChange={() => handleToggleSource(c.id)}
                        sx={{ p: 0 }}
                      />
                      <Avatar sx={{ bgcolor: c.avatar_color, width: 28, height: 28, fontSize: 13 }}>
                        {c.name.charAt(0)}
                      </Avatar>
                      <Box sx={{ minWidth: 0 }}>
                        <Stack direction="row" spacing={0.75} alignItems="center">
                          <Typography variant="body2" fontWeight={600} noWrap>
                            {c.name}
                          </Typography>
                          {isSuggested && (
                            <Chip
                              label="相似推荐"
                              size="small"
                              color="warning"
                              variant="filled"
                              sx={{ height: 18, fontSize: 10, px: 0.5 }}
                            />
                          )}
                        </Stack>
                        {c.aliases && c.aliases.length > 0 && (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            已有别名: {c.aliases.join('、')}
                          </Typography>
                        )}
                      </Box>
                    </Stack>

                    <Chip
                      label={`${count} 张卡`}
                      size="small"
                      color={count > 0 ? 'primary' : 'default'}
                      variant="outlined"
                      sx={{ height: 22, fontSize: 11, fontWeight: 600, flexShrink: 0 }}
                    />
                  </Paper>
                )
              })}
            </Stack>
          </Paper>
        )}

        {/* 3. 合并预览卡片 */}
        {sourceIds.length > 0 && primaryHolder && (
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: 2,
              bgcolor: 'rgba(22, 163, 74, 0.06)',
              border: '1px solid rgba(22, 163, 74, 0.25)',
            }}
          >
            <Typography variant="subtitle2" fontWeight={800} color="success.dark" sx={{ mb: 1 }}>
              🎯 合并生效预览
            </Typography>
            <Stack spacing={0.5} sx={{ fontSize: 13 }}>
              <Box>
                • 目标主持卡人：<strong>{primaryHolder.name}</strong>
              </Box>
              <Box>
                • 转移卡片数：
                <strong>
                  原 {cardCounts[primaryHolder.id] || 0} 张 + 迁入 {transferCardsCount} 张 = 合计{' '}
                  {(cardCounts[primaryHolder.id] || 0) + transferCardsCount} 张
                </strong>
              </Box>
              {collectedAliases.length > 0 && (
                <Box>
                  • 沉淀别名库：
                  {collectedAliases.map(a => (
                    <Chip
                      key={a}
                      label={a}
                      size="small"
                      sx={{ height: 20, fontSize: 11, mr: 0.5, mb: 0.5, bgcolor: '#fff' }}
                    />
                  ))}
                </Box>
              )}
            </Stack>
          </Paper>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose} disabled={loading}>
          取消
        </Button>
        <Button
          variant="contained"
          onClick={handleMerge}
          disabled={loading || sourceIds.length === 0}
          startIcon={loading ? <CircularProgress size={16} color="inherit" /> : <MergeTypeIcon />}
          sx={{ fontWeight: 700, borderRadius: 2 }}
        >
          {sourceIds.length > 0 ? `确认归拢合并 (${sourceIds.length} 个身份)` : '请选择合并项'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
