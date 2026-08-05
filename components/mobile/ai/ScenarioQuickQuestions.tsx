'use client'

import { Box, Chip, Stack, Typography } from '@mui/material'
import type { ScenarioGroup } from '@/lib/types'

/** 三组场景化快捷问题 */
export const SCENARIO_GROUPS: ScenarioGroup[] = [
  {
    id: 'bills',
    title: '查账单',
    emoji: '📊',
    questions: [
      '本月总账单多少？',
      '哪张卡消费最多？',
      '帮我对比最近 3 个月账单',
      '我有几笔账单还没还？',
    ],
  },
  {
    id: 'payments',
    title: '排还款',
    emoji: '💳',
    questions: [
      '最近要还多少？',
      '帮我规划还款',
      '哪张卡应该优先还？',
      '最低还款额是多少？',
    ],
  },
  {
    id: 'risk',
    title: '防风险',
    emoji: '🛡️',
    questions: [
      '额度使用率安全吗？',
      '有逾期风险吗？',
      '未来 7 天有哪些账单要注意？',
      '我的负债健康度如何？',
    ],
  },
]

export interface ScenarioQuickQuestionsProps {
  /** 点击 chip 回调（通常为自动填入输入框） */
  onSelectQuestion: (question: string) => void
  /** 加载中禁用 */
  disabled?: boolean
}

/**
 * Area 2 - 场景化快捷问题分组
 * 三组（查账单 / 排还款 / 防风险），每组 3-4 个 chip
 */
export function ScenarioQuickQuestions({ onSelectQuestion, disabled }: ScenarioQuickQuestionsProps) {
  return (
    <Stack spacing={2}>
      {SCENARIO_GROUPS.map(group => (
        <Box key={group.id}>
          <Stack direction="row" spacing={0.75} alignItems="center" sx={{ mb: 1 }}>
            <Typography component="span" sx={{ fontSize: 16 }}>
              {group.emoji}
            </Typography>
            <Typography variant="subtitle2" fontWeight={700} sx={{ fontSize: 14 }}>
              {group.title}
            </Typography>
          </Stack>
          <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
            {group.questions.map(q => (
              <Chip
                key={q}
                label={q}
                size="medium"
                onClick={() => onSelectQuestion(q)}
                disabled={disabled}
                sx={{
                  borderRadius: '20px',
                  height: 32,
                  fontSize: 13,
                  bgcolor: '#F0F4F8',
                  color: '#1F2937',
                  border: '1px solid #E5E7EB',
                  '&:hover': {
                    bgcolor: '#E0E7FF',
                    borderColor: '#2563EB',
                    color: '#2563EB',
                  },
                  '&.Mui-disabled': {
                    opacity: 0.5,
                  },
                }}
              />
            ))}
          </Stack>
        </Box>
      ))}
    </Stack>
  )
}

export default ScenarioQuickQuestions
