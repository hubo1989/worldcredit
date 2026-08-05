'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Box, Button, CircularProgress, Container, Paper, Stack, Typography } from '@mui/material'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import RefreshIcon from '@mui/icons-material/Refresh'
import { useAuth } from '@/lib/auth'
import { askAiAssistant } from '@/lib/api/ai-assistant'
import { getAiWelcomeContext } from '@/lib/api/welcome-context'
import type { AiMessage, AiPageMode, AiWelcomeContext } from '@/lib/types'
import { WelcomeBanner } from '@/components/mobile/ai/WelcomeBanner'
import { ScenarioQuickQuestions } from '@/components/mobile/ai/ScenarioQuickQuestions'
import { SampleDialoguePreview } from '@/components/mobile/ai/SampleDialoguePreview'
import { SmartInputArea } from '@/components/mobile/ai/SmartInputArea'

/**
 * AI 助手页面（空状态 + 对话模式）
 *
 * 编排 4 个独立组件：
 *  - WelcomeBanner          : 个性化欢迎横幅
 *  - ScenarioQuickQuestions : 场景化快捷问题
 *  - SampleDialoguePreview  : 示例对话预览（可折叠）
 *  - SmartInputArea         : 智能输入区（底部固定）
 *
 * 状态机：empty / loading / error / conversation
 */
export default function AiAssistantPage() {
  const { user } = useAuth()
  const [mode, setMode] = useState<AiPageMode>('empty')
  const [prompt, setPrompt] = useState('')
  const [messages, setMessages] = useState<AiMessage[]>([])
  const [error, setError] = useState('')
  const [welcomeCtx, setWelcomeCtx] = useState<AiWelcomeContext | undefined>(undefined)

  const messagesEndRef = useRef<HTMLDivElement>(null)

  // 加载欢迎横幅真实数据（静默，失败兜底）
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    getAiWelcomeContext(user.id)
      .then(ctx => {
        if (!cancelled) setWelcomeCtx(ctx)
      })
      .catch(() => {
        // 失败使用 undefined，组件显示兜底文案
      })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  // 滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const ask = useCallback(
    async (text?: string) => {
      const question = (text ?? prompt).trim()
      if (!question) return

      setPrompt(question)
      setMode('loading')
      setError('')

      const userMsg: AiMessage = {
        id: `u_${Date.now()}`,
        role: 'user',
        content: question,
        created_at: Date.now(),
      }
      setMessages(prev => [...prev, userMsg])

      try {
        const result = await askAiAssistant({ prompt: question })
        const aiMsg: AiMessage = {
          id: `a_${Date.now()}`,
          role: 'assistant',
          content: result.answer,
          model: result.model,
          created_at: Date.now(),
        }
        setMessages(prev => [...prev, aiMsg])
        setMode('conversation')
        setPrompt('')
      } catch (err: any) {
        setError(err?.message || 'AI 调用失败')
        setMode('error')
      }
    },
    [prompt]
  )

  const handleReset = () => {
    setMessages([])
    setPrompt('')
    setError('')
    setMode('empty')
  }

  const isLoading = mode === 'loading'
  const hasConversation = messages.length > 0

  return (
    <Container maxWidth="sm" sx={{ py: 2, pb: 14 }}>
      {/* === Area 1: 个性化欢迎横幅 === */}
      <Box sx={{ mb: 3 }}>
        <WelcomeBanner context={welcomeCtx} />
      </Box>

      {/* === 对话模式：显示消息流 === */}
      {hasConversation && (
        <Stack spacing={1.5} sx={{ mb: 2 }}>
          {messages.map(msg => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          {isLoading && (
            <Paper
              elevation={0}
              sx={{
                p: 1.5,
                borderRadius: 2,
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: '#F9FAFB',
              }}
            >
              <Stack direction="row" spacing={1.5} alignItems="center">
                <CircularProgress size={18} />
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
                  AI 正在读取账单上下文并生成回答...
                </Typography>
              </Stack>
            </Paper>
          )}
          <div ref={messagesEndRef} />

          <Box sx={{ pt: 1 }}>
            <Button
              size="small"
              startIcon={<RefreshIcon />}
              onClick={handleReset}
              sx={{ color: 'text.secondary' }}
            >
              开始新对话
            </Button>
          </Box>
        </Stack>
      )}

      {/* === 空状态：显示快捷问题 + 示例对话 === */}
      {!hasConversation && (
        <Stack spacing={3}>
          {/* === Area 2: 场景化快捷问题 === */}
          <ScenarioQuickQuestions
            onSelectQuestion={q => {
              setPrompt(q)
            }}
            disabled={isLoading}
          />

          {/* 错误提示 */}
          {error && (
            <Alert severity="error" sx={{ borderRadius: 2 }}>
              {error}
            </Alert>
          )}

          {/* === Area 3: 示例对话预览 === */}
          <SampleDialoguePreview
            onUseQuestion={q => {
              setPrompt(q)
            }}
          />
        </Stack>
      )}

      {/* === Area 4: 智能输入区（固定底部） === */}
      <Box
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: { xs: 64, sm: 64 }, // 留出 BottomNav 空间（MobileShell pb=9）
          zIndex: 100,
          bgcolor: '#F0F4F8',
          borderTop: '1px solid #E5E7EB',
          px: 2,
          py: 1.5,
        }}
      >
        <Box sx={{ maxWidth: 600, mx: 'auto' }}>
          <SmartInputArea
            value={prompt}
            onChange={setPrompt}
            onSubmit={() => ask()}
            loading={isLoading}
          />
        </Box>
      </Box>
    </Container>
  )
}

/**
 * 单条消息气泡（区分 user / assistant）
 */
function MessageBubble({ message }: { message: AiMessage }) {
  const isUser = message.role === 'user'
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      <Box
        sx={{
          maxWidth: '85%',
          borderRadius: 2,
          px: 1.5,
          py: 1,
          bgcolor: isUser ? '#2563EB' : '#fff',
          color: isUser ? '#fff' : '#1F2937',
          border: isUser ? 'none' : '1px solid #E5E7EB',
          boxShadow: isUser ? '0 2px 8px rgba(37, 99, 235, 0.2)' : 'none',
        }}
      >
        {!isUser && (
          <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
            <AutoAwesomeIcon sx={{ fontSize: 14, color: '#2563EB' }} />
            <Typography variant="caption" fontWeight={700} sx={{ fontSize: 11, color: '#2563EB' }}>
              AI 回复
            </Typography>
            {message.model && (
              <Typography variant="caption" sx={{ fontSize: 10, color: 'text.secondary' }}>
                · {message.model}
              </Typography>
            )}
          </Stack>
        )}
        <Typography
          component="pre"
          sx={{
            m: 0,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontFamily: 'inherit',
            fontSize: 14,
            lineHeight: 1.7,
          }}
        >
          {message.content}
        </Typography>
      </Box>
    </Box>
  )
}
