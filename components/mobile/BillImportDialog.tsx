// components/mobile/BillImportDialog.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, FormControl, InputLabel, Select, MenuItem,
  Box, Typography, IconButton, Stepper, Step, StepLabel,
  Alert, Stack, Chip, CircularProgress, Divider,
} from '@mui/material'
import {
  ArrowBack, ArrowForward, Check, DeleteOutline,
  ContentPaste, UploadFile, Warning as WarningIcon,
} from '@mui/icons-material'
import { recognizeBillFromText, validateBillDraft, generateWarnings, type BillDraftPayload, type BillDraftItem } from '@/lib/billRecognizer'
import { createBillImportDraft, confirmBillImportDraft, discardBillImportDraft } from '@/lib/api/billDrafts'
import type { CreditCard } from '@/lib/types'

interface CardOption {
  id: string
  label: string
  card: CreditCard
}

const steps = ['选择卡片', '选择来源', '输入内容', '确认草稿', '完成']

type SourceType = 'text' | 'image' | 'pdf'

interface Props {
  open: boolean
  onClose: () => void
  onImportSuccess: () => void
  cards: CardOption[]
  userId: string
}

export function BillImportDialog({ open, onClose, onImportSuccess, cards, userId }: Props) {
  const [activeStep, setActiveStep] = useState(0)
  const [cardId, setCardId] = useState('')
  const [sourceType, setSourceType] = useState<SourceType>('text')
  const [inputText, setInputText] = useState('')
  const [draft, setDraft] = useState<BillDraftPayload | null>(null)
  const [draftId, setDraftId] = useState<string | null>(null)
  const [confidence, setConfidence] = useState(0)
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  // Reset state when dialog opens/closes
  useEffect(() => {
    if (open) {
      setActiveStep(0)
      setCardId(cards[0]?.id || '')
      setSourceType('text')
      setInputText('')
      setDraft(null)
      setDraftId(null)
      setConfidence(0)
      setWarnings([])
      setError('')
      setSuccess(false)
    }
  }, [open, cards])

  const handleNext = async () => {
    setError('')

    if (activeStep === 2) {
      // Process input and generate draft
      await processInput()
    } else if (activeStep === 3) {
      // Save draft and move to confirm step
      await saveDraft()
    } else if (activeStep < steps.length - 1) {
      setActiveStep(prev => prev + 1)
    }
  }

  const handleBack = () => {
    if (activeStep > 0) {
      setActiveStep(prev => prev - 1)
    }
  }

  const processInput = async () => {
    if (sourceType === 'text' && !inputText.trim()) {
      setError('请输入账单文本内容')
      return
    }

    if (sourceType !== 'text') {
      setError('图片和 PDF 导入功能即将推出，请使用文本导入')
      return
    }

    setLoading(true)

    try {
      // Recognize bill from text
      const recognized = recognizeBillFromText(inputText)
      recognized.card_id = cardId

      // Validate and calculate confidence
      const validation = validateBillDraft(recognized)
      const draftWarnings = generateWarnings(recognized)

      setDraft(recognized)
      setConfidence(validation.confidence)
      setWarnings(draftWarnings)

      if (validation.valid || validation.warnings.length > 0) {
        setActiveStep(3)
      } else {
        setError(validation.errors.join('; '))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '解析失败')
    } finally {
      setLoading(false)
    }
  }

  const saveDraft = async () => {
    if (!draft) return

    setLoading(true)

    try {
      const savedDraft = await createBillImportDraft({
        created_by: userId,
        card_id: cardId,
        source_type: sourceType,
        raw_text: inputText,
        parsed_payload: draft,
        confidence,
      })

      setDraftId(savedDraft.id)
      setActiveStep(4)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存草稿失败')
    } finally {
      setLoading(false)
    }
  }

  const handleConfirmImport = async () => {
    if (!draftId) return

    setLoading(true)

    try {
      await confirmBillImportDraft(draftId)
      setSuccess(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDiscard = async () => {
    if (!draftId) return

    setLoading(true)

    try {
      await discardBillImportDraft(draftId)
      handleClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除草稿失败')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    if (success) {
      onImportSuccess()
    }
    onClose()
  }

  const updateDraftField = <K extends keyof BillDraftPayload>(key: K, value: BillDraftPayload[K]) => {
    if (draft) {
      setDraft({ ...draft, [key]: value })
    }
  }

  const updateDraftItem = <K extends keyof BillDraftItem>(index: number, key: K, value: BillDraftItem[K]) => {
    if (draft?.items) {
      const newItems = [...draft.items]
      newItems[index] = { ...newItems[index], [key]: value }
      setDraft({ ...draft, items: newItems })
    }
  }

  const removeDraftItem = (index: number) => {
    if (draft?.items) {
      setDraft({ ...draft, items: draft.items.filter((_, i) => i !== index) })
    }
  }

  const getConfidenceColor = () => {
    if (confidence >= 0.8) return 'success'
    if (confidence >= 0.5) return 'warning'
    return 'error'
  }

  const getConfidenceLabel = () => {
    if (confidence >= 0.8) return '高'
    if (confidence >= 0.5) return '中'
    return '低'
  }

  // Step 1: Select card
  const renderStep1 = () => (
    <Box sx={{ pt: 2 }}>
      <FormControl fullWidth>
        <InputLabel>选择信用卡 *</InputLabel>
        <Select
          value={cardId}
          onChange={e => setCardId(e.target.value)}
          label="选择信用卡 *"
        >
          {cards.map(c => (
            <MenuItem key={c.id} value={c.id}>{c.label}</MenuItem>
          ))}
        </Select>
      </FormControl>
    </Box>
  )

  // Step 2: Select source type
  const renderStep2 = () => (
    <Box sx={{ pt: 2 }}>
      <FormControl fullWidth>
        <InputLabel>导入来源</InputLabel>
        <Select
          value={sourceType}
          onChange={e => setSourceType(e.target.value as SourceType)}
          label="导入来源"
        >
          <MenuItem value="text">
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <ContentPaste fontSize="small" />
              粘贴文本 (推荐)
            </Box>
          </MenuItem>
          <MenuItem value="image" disabled>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <UploadFile fontSize="small" />
              上传图片 (即将推出)
            </Box>
          </MenuItem>
          <MenuItem value="pdf" disabled>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <UploadFile fontSize="small" />
              上传 PDF (即将推出)
            </Box>
          </MenuItem>
        </Select>
      </FormControl>

      {sourceType === 'text' && (
        <Alert severity="info" sx={{ mt: 2 }}>
          支持粘贴银行短信或邮件内容，系统将自动识别账单信息
        </Alert>
      )}
    </Box>
  )

  // Step 3: Input content
  const renderStep3 = () => (
    <Box sx={{ pt: 2 }}>
      {sourceType === 'text' ? (
        <>
          <TextField
            fullWidth
            multiline
            rows={12}
            label="粘贴账单内容"
            placeholder="例如：
招商银行：您账户1234的03月账单金额¥1234.56，最低还款额¥123.45，到期还款日03月25日。
交易明细：
03月01日 星巴克咖啡 38.00
03月03日 地铁出行 12.00"
            value={inputText}
            onChange={e => setInputText(e.target.value)}
            sx={{ fontFamily: 'monospace' }}
          />
        </>
      ) : (
        <Box
          sx={{
            // 上传放置区语义：虚线提示（非分层边框），圆角走令牌
            border: '2px dashed',
            borderColor: 'var(--track)',
            borderRadius: 'var(--radius-depth-2)',
            p: 4,
            textAlign: 'center',
            color: 'var(--muted)',
          }}
        >
          <UploadFile sx={{ fontSize: 48, mb: 1, color: 'var(--strong)' }} />
          <Typography className="type-body" sx={{ color: 'var(--muted)' }}>文件上传功能即将推出</Typography>
        </Box>
      )}
    </Box>
  )

  // Step 4: Preview and edit draft
  const renderStep4 = () => {
    if (!draft) return null

    const itemsTotal = (draft.items || []).reduce((sum, item) => sum + (item.amount || 0), 0)

    return (
      <Box sx={{ pt: 2 }}>
        {/* Confidence indicator */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Typography className="type-body" sx={{ fontWeight: 600 }}>识别置信度:</Typography>
          <Chip
            label={getConfidenceLabel()}
            color={getConfidenceColor()}
            size="small"
          />
          <Typography className="type-label">
            ({(confidence * 100).toFixed(0)}%)
          </Typography>
        </Box>

        {/* Warnings */}
        {warnings.length > 0 && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {warnings.map((warn, i) => (
              <Box key={i} sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                <WarningIcon fontSize="inherit" sx={{ mt: 0.25 }} />
                <Typography className="type-body">{warn}</Typography>
              </Box>
            ))}
          </Alert>
        )}

        {/* Bill fields */}
        <Stack spacing={2}>
          <TextField
            fullWidth
            label="账单月份"
            type="month"
            value={draft.bill_month || ''}
            onChange={e => updateDraftField('bill_month', e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
          <Box sx={{ display: 'flex', gap: 1 }}>
            <TextField
              fullWidth
              label="账单金额"
              type="number"
              value={draft.bill_amount || ''}
              onChange={e => updateDraftField('bill_amount', Number(e.target.value))}
              inputProps={{ step: 0.01 }}
            />
            <TextField
              fullWidth
              label="最低还款额"
              type="number"
              value={draft.min_payment || ''}
              onChange={e => updateDraftField('min_payment', Number(e.target.value))}
              inputProps={{ step: 0.01 }}
            />
          </Box>
          <TextField
            fullWidth
            label="还款截止日"
            type="date"
            value={draft.due_date || ''}
            onChange={e => updateDraftField('due_date', e.target.value)}
            InputLabelProps={{ shrink: true }}
          />
        </Stack>

        {/* Items */}
        <Divider sx={{ my: 2, borderColor: 'var(--track)' }} />
        <Typography className="type-section" gutterBottom>
          交易明细 (合计: ¥{itemsTotal.toFixed(2)})
        </Typography>

        {draft.items && draft.items.length > 0 ? (
          <Stack spacing={1}>
            {draft.items.map((item, index) => (
              <Box
                key={index}
                sx={{
                  // 分层阴影代替边框
                  borderRadius: 'var(--radius-depth-2)',
                  boxShadow: 'var(--shadow-e1)',
                  p: 1.5,
                }}
              >
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography className="type-label">
                    #{index + 1}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => removeDraftItem(index)}
                    aria-label="删除明细"
                  >
                    <DeleteOutline fontSize="small" />
                  </IconButton>
                </Box>
                <TextField
                  fullWidth
                  size="small"
                  label="商户说明"
                  value={item.description}
                  onChange={e => updateDraftItem(index, 'description', e.target.value)}
                  sx={{ mb: 1 }}
                />
                <Box sx={{ display: 'flex', gap: 1 }}>
                  <TextField
                    size="small"
                    label="金额"
                    type="number"
                    value={item.amount}
                    onChange={e => updateDraftItem(index, 'amount', Number(e.target.value))}
                    inputProps={{ step: 0.01 }}
                    sx={{ flex: 1 }}
                  />
                  <TextField
                    size="small"
                    label="分类"
                    value={item.category || ''}
                    onChange={e => updateDraftItem(index, 'category', e.target.value)}
                    sx={{ flex: 1 }}
                  />
                </Box>
              </Box>
            ))}
          </Stack>
        ) : (
          <Alert severity="info">未识别到交易明细，可手动添加</Alert>
        )}
      </Box>
    )
  }

  // Step 5: Complete
  const renderStep5 = () => (
    <Box sx={{ pt: 2, textAlign: 'center' }}>
      {success ? (
        <>
          <Check sx={{ fontSize: 64, color: 'success.main', mb: 2 }} />
          <Typography className="type-title" gutterBottom>导入成功</Typography>
          <Typography className="type-body" sx={{ color: 'var(--muted)' }}>
            账单已创建完成
          </Typography>
        </>
      ) : (
        <>
          <Typography className="type-title" gutterBottom>确认导入</Typography>
          <Typography className="type-body" sx={{ color: 'var(--muted)', mb: 2 }}>
            草稿已保存，确认后将创建正式账单
          </Typography>
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center' }}>
            <Button
              variant="outlined"
              color="error"
              onClick={handleDiscard}
              disabled={loading}
            >
              放弃
            </Button>
            <Button
              variant="contained"
              onClick={handleConfirmImport}
              disabled={loading}
              startIcon={loading ? <CircularProgress size={16} /> : <Check />}
            >
              确认导入
            </Button>
          </Box>
        </>
      )}
    </Box>
  )

  const isNextDisabled = () => {
    if (loading) return true
    if (activeStep === 0 && !cardId) return true
    if (activeStep === 2 && sourceType === 'text' && !inputText.trim()) return true
    return false
  }

  return (
    <Dialog open={open} onClose={handleClose} fullWidth maxWidth="sm">
      <DialogTitle className="type-title">智能导入账单</DialogTitle>

      <Stepper activeStep={activeStep} sx={{ px: 2, pt: 1 }}>
        {steps.map((label) => (
          <Step key={label}>
            <StepLabel>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      <DialogContent>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {activeStep === 0 && renderStep1()}
        {activeStep === 1 && renderStep2()}
        {activeStep === 2 && renderStep3()}
        {activeStep === 3 && renderStep4()}
        {activeStep === 4 && renderStep5()}
      </DialogContent>

      {activeStep < 4 && (
        <DialogActions>
          <Button
            onClick={handleBack}
            disabled={activeStep === 0 || loading}
            startIcon={<ArrowBack />}
          >
            上一步
          </Button>
          <Button
            variant="contained"
            onClick={handleNext}
            disabled={isNextDisabled()}
            endIcon={loading ? null : <ArrowForward />}
            startIcon={loading ? <CircularProgress size={16} /> : null}
          >
            {loading ? '处理中...' : activeStep === 3 ? '保存草稿' : '下一步'}
          </Button>
        </DialogActions>
      )}

      {activeStep === 4 && success && (
        <DialogActions>
          <Button onClick={handleClose} variant="contained">
            完成
          </Button>
        </DialogActions>
      )}
    </Dialog>
  )
}
