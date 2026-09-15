'use client'

import {
  Card,
  CardContent,
  Stack,
  Box,
  Typography,
  Divider,
  Switch,
  FormControlLabel,
  FormGroup,
  Checkbox,
  Chip
} from '@mui/material'
import DisplayIcon from '@mui/icons-material/Tune'
import type { UserDisplayConfig } from '@/lib/types'

interface DisplayPreferencesCardProps {
  config: UserDisplayConfig
  onChange: (updates: Partial<UserDisplayConfig>) => void
  disabled?: boolean
}

export function DisplayPreferencesCard({ config, onChange, disabled }: DisplayPreferencesCardProps) {
  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 2.5 }}>
        <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 2 }}>
          <Box
            sx={{
              width: 44,
              height: 44,
              borderRadius: 3,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              bgcolor: 'primary.50',
              color: 'primary.main'
            }}
          >
            <DisplayIcon fontSize="small" />
          </Box>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={700}>
              显示要素与隐私保护
            </Typography>
            <Typography variant="body2" color="text.secondary">
              自定义看板遮罩规则与卡片展示字段
            </Typography>
          </Box>
        </Stack>

        <Divider sx={{ my: 2, borderStyle: 'dashed' }} />

        <Stack spacing={2}>
          <Box
            sx={{
              p: 2,
              borderRadius: 3,
              bgcolor: config.privacy_mode ? 'primary.50' : 'grey.50',
              border: '1px solid',
              borderColor: config.privacy_mode ? 'primary.200' : 'divider',
              transition: 'all 0.2s ease'
            }}
          >
            <FormControlLabel
              disabled={disabled}
              control={
                <Switch
                  checked={config.privacy_mode}
                  onChange={e => onChange({ privacy_mode: e.target.checked })}
                  color="primary"
                />
              }
              label={
                <Box sx={{ ml: 0.5 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Typography variant="body2" fontWeight={700}>
                      高斯模糊隐私模式 (隐匿敏感金额)
                    </Typography>
                    {config.privacy_mode && (
                      <Chip label="已开启" size="small" color="primary" sx={{ height: 20, fontSize: 11 }} />
                    )}
                  </Stack>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                    开启后，看板与账单列表的敏感金额将通过高斯模糊平滑遮罩
                  </Typography>
                </Box>
              }
              sx={{ m: 0, width: '100%' }}
            />
          </Box>

          <Box>
            <Typography variant="caption" color="text.secondary" fontWeight={700} sx={{ display: 'block', mb: 1 }}>
              账单卡片显隐要素定制：
            </Typography>
            <FormGroup row sx={{ gap: 1 }}>
              <FormControlLabel
                disabled={disabled}
                control={
                  <Checkbox
                    size="small"
                    checked={config.show_min_payment}
                    onChange={e => onChange({ show_min_payment: e.target.checked })}
                  />
                }
                label={<Typography variant="body2">最低还款额</Typography>}
              />
              <FormControlLabel
                disabled={disabled}
                control={
                  <Checkbox
                    size="small"
                    checked={config.show_statement_date}
                    onChange={e => onChange({ show_statement_date: e.target.checked })}
                  />
                }
                label={<Typography variant="body2">账单日</Typography>}
              />
              <FormControlLabel
                disabled={disabled}
                control={
                  <Checkbox
                    size="small"
                    checked={config.show_card_last4}
                    onChange={e => onChange({ show_card_last4: e.target.checked })}
                  />
                }
                label={<Typography variant="body2">卡号后4位</Typography>}
              />
            </FormGroup>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}
