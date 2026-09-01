'use client'

import { useState } from 'react'
import { Box, Collapse, IconButton, Stack, Typography } from '@mui/material'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutline'

interface SampleDialogue {
  question: string
  answer: string
}

/** 静态示例对话数据，仅用于展示 AI 能力，不调用真实接口 */
const SAMPLE_DIALOGUES: SampleDialogue[] = [
  {
    question: '我最近应该优先还哪几张卡？',
    answer:
      '根据你的账单数据，建议优先偿还以下两笔：\n\n1. 招商银行尾号 1234（已逾期 2 天，剩余 ¥3,200）— 请立即还款避免征信影响。\n2. 工商银行尾号 5678（3 天后到期，剩余 ¥1,800）— 建议本周内还清。\n\n其他账单均在免息期内，可按最低还款额灵活安排。',
  },
  {
    question: '我的额度使用率安全吗？',
    answer:
      '当前总授信 ¥80,000，已用 ¥24,500，使用率约 31%，处于健康范围（建议 <50%）。\n\n不过招商银行尾号 1234 单卡使用率达 78%，建议降低该卡使用频率，避免触发银行风控。',
  },
]

export interface SampleDialoguePreviewProps {
  /** 点击示例问题，自动填入输入框 */
  onUseQuestion?: (question: string) => void
}

/**
 * Area 3 - 示例对话预览
 * 展示 AI 真实问答样例，让用户直观了解能力边界。
 * 默认折叠，点击「查看示例」展开。
 */
export function SampleDialoguePreview({ onUseQuestion }: SampleDialoguePreviewProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Box
      sx={{
        borderRadius: 3,
        border: '1px dashed #CBD5E1',
        bgcolor: '#FAFBFC',
        p: 2,
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        onClick={() => setExpanded(v => !v)}
        sx={{ cursor: 'pointer' }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <ChatBubbleOutlineIcon sx={{ fontSize: 18, color: 'text.secondary' }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: 14 }}>
            看看 AI 能做什么
          </Typography>
          <Box
            sx={{
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              bgcolor: '#F1F5F9',
              color: 'text.secondary',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            示例
          </Box>
        </Stack>
        <IconButton aria-label="展开示例对话" size="small" sx={{ p: 0.5 }}>
          <ExpandMoreIcon
            sx={{
              transition: 'transform 0.2s',
              transform: expanded ? 'rotate(180deg)' : 'rotate(0)',
              fontSize: 20,
            }}
          />
        </IconButton>
      </Stack>

      <Collapse in={expanded}>
        <Stack spacing={1.5} sx={{ mt: 1.5 }}>
          {SAMPLE_DIALOGUES.map((d, i) => (
            <Box
              key={i}
              sx={{
                borderRadius: 2,
                bgcolor: '#fff',
                border: '1px solid #E5E7EB',
                p: 1.5,
              }}
            >
              {/* 用户问题 */}
              <Stack direction="row" spacing={0.75} alignItems="flex-start">
                <Box
                  sx={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    bgcolor: '#E0E7FF',
                    color: 'primary.main',
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    mt: 0.25,
                  }}
                >
                  我
                </Box>
                <Typography variant="body2" sx={{ fontSize: 13, color: '#1F2937', lineHeight: 1.5 }}>
                  {d.question}
                </Typography>
              </Stack>

              {/* AI 回答 */}
              <Stack direction="row" spacing={0.75} alignItems="flex-start" sx={{ mt: 1 }}>
                <Box
                  sx={{
                    width: 22,
                    height: 22,
                    borderRadius: '50%',
                    bgcolor: 'primary.main',
                    color: '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    mt: 0.25,
                  }}
                >
                  <AutoAwesomeIcon sx={{ fontSize: 13 }} />
                </Box>
                <Typography
                  component="pre"
                  sx={{
                    m: 0,
                    fontSize: 13,
                    color: '#374151',
                    lineHeight: 1.7,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'inherit',
                    flex: 1,
                  }}
                >
                  {d.answer}
                </Typography>
              </Stack>

              {/* 一键试问 */}
              {onUseQuestion && (
                <Box sx={{ mt: 1, textAlign: 'right' }}>
                  <Box
                    component="button"
                    onClick={() => onUseQuestion(d.question)}
                    sx={{
                      border: 'none',
                      background: 'transparent',
                      color: 'primary.main',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      p: 0,
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    我也问这个 →
                  </Box>
                </Box>
              )}
            </Box>
          ))}
        </Stack>
      </Collapse>
    </Box>
  )
}

export default SampleDialoguePreview
