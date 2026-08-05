'use client'

import { useEffect, useRef, useState } from 'react'
import {
  Box,
  CircularProgress,
  IconButton,
  InputBase,
  Paper,
  Snackbar,
  Stack,
  SxProps,
  Theme,
} from '@mui/material'
import MicIcon from '@mui/icons-material/Mic'
import SendIcon from '@mui/icons-material/Send'

/** 动态占位符轮播 */
const PLACEHOLDERS = [
  '例如：我最近应该优先还哪几张卡？',
  '问问：本月总账单多少？',
  '试试：有逾期风险吗？',
  '比如：帮我规划还款计划',
  '问问：哪张卡消费最多？',
]

const PLACEHOLDER_ROTATE_MS = 3000

/** 输入框下方的快捷话题标签 */
const QUICK_TOPICS = ['#账单', '#还款', '#提额', '#积分', '#优惠']

export interface SmartInputAreaProps {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  loading?: boolean
  /** 占位符随机变化开关 */
  rotatePlaceholder?: boolean
  sx?: SxProps<Theme>
}

/**
 * Area 4 - 智能输入区
 * - 动态轮播占位符（3s）
 * - 占位语音按钮（点击 toast 提示）
 * - 发送按钮三态：禁用 / 加载 / 启用
 * - 快捷话题标签条
 */
export function SmartInputArea({
  value,
  onChange,
  onSubmit,
  loading = false,
  rotatePlaceholder = true,
  sx,
}: SmartInputAreaProps) {
  const [phIndex, setPhIndex] = useState(0)
  const [voiceToast, setVoiceToast] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!rotatePlaceholder) return
    const t = setInterval(() => {
      setPhIndex(i => (i + 1) % PLACEHOLDERS.length)
    }, PLACEHOLDER_ROTATE_MS)
    return () => clearInterval(t)
  }, [rotatePlaceholder])

  // 语音 toast 自动消失
  useEffect(() => {
    if (!voiceToast) return
    const t = setTimeout(() => setVoiceToast(false), 2000)
    return () => clearTimeout(t)
  }, [voiceToast])

  const handleVoiceClick = () => {
    setVoiceToast(true)
  }

  const handleTopicClick = (topic: string) => {
    // 在当前值末尾追加话题（去 #）
    const tag = topic.replace(/^#/, '')
    const next = value.trim() ? `${value.trim()} ${tag}` : tag
    onChange(next)
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Enter 提交，Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (!loading && value.trim()) onSubmit()
    }
  }

  const canSend = !loading && value.trim().length > 0

  return (
    <Box sx={sx}>
      <Paper
        elevation={0}
        sx={{
          p: 1,
          px: 1.5,
          borderRadius: 3,
          border: '1px solid',
          borderColor: canSend ? '#2563EB' : '#E5E7EB',
          bgcolor: '#fff',
          transition: 'border-color 0.2s',
        }}
      >
        <Stack direction="row" spacing={1} alignItems="flex-end">
          {/* 语音按钮（占位） */}
          <IconButton
            size="small"
            onClick={handleVoiceClick}
            sx={{
              color: '#6B7280',
              p: 0.5,
              '&:hover': { bgcolor: '#F3F4F6' },
            }}
            aria-label="语音输入"
          >
            <MicIcon sx={{ fontSize: 22 }} />
          </IconButton>

          {/* 输入框 */}
          <InputBase
            inputRef={inputRef}
            multiline
            maxRows={4}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={PLACEHOLDERS[phIndex]}
            sx={{
              flex: 1,
              fontSize: 15,
              lineHeight: 1.5,
              py: 0.5,
              '& .MuiInputBase-input::placeholder': {
                color: '#9CA3AF',
                opacity: 1,
              },
            }}
          />

          {/* 发送按钮：三态 */}
          <IconButton
            onClick={onSubmit}
            disabled={!canSend}
            size="small"
            sx={{
              bgcolor: canSend ? '#2563EB' : '#E5E7EB',
              color: canSend ? '#fff' : '#9CA3AF',
              '&:hover': { bgcolor: canSend ? '#1D4ED8' : '#E5E7EB' },
              width: 34,
              height: 34,
              transition: 'all 0.2s',
            }}
            aria-label="发送"
          >
            {loading ? (
              <CircularProgress size={18} color="inherit" />
            ) : (
              <SendIcon sx={{ fontSize: 18 }} />
            )}
          </IconButton>
        </Stack>
      </Paper>

      {/* 快捷话题标签 */}
      <Stack direction="row" spacing={0.75} sx={{ mt: 1, px: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
        {QUICK_TOPICS.map(t => (
          <Box
            key={t}
            component="button"
            onClick={() => handleTopicClick(t)}
            sx={{
              border: 'none',
              background: 'transparent',
              color: '#6B7280',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 500,
              p: 0,
              '&:hover': { color: '#2563EB' },
            }}
          >
            {t}
          </Box>
        ))}
      </Stack>

      {/* 语音占位 toast */}
      <Snackbar
        open={voiceToast}
        message="🎤 语音功能开发中，敬请期待"
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{
          '& .MuiSnackbarContent-root': {
            bgcolor: 'rgba(31, 41, 55, 0.9)',
            color: '#fff',
            borderRadius: 2,
            fontSize: 13,
            justifyContent: 'center',
            textAlign: 'center',
          },
        }}
        ContentProps={{ 'aria-label': '语音功能提示' }}
      />
    </Box>
  )
}

export default SmartInputArea
