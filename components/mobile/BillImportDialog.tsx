// components/mobile/BillImportDialog.tsx
'use client'

import { useState, useEffect } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField, TextArea, SelectField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import {
  ChevronLeftIcon, ChevronRightIcon, CheckIcon, TrashIcon,
  UploadIcon, AlertIcon,
} from '@/components/icons/WcIcon'
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

/** 横向步骤条（替代 MUI Stepper）：完成步打勾，当前步高亮。 */
function StepBar({ activeStep }: { activeStep: number }) {
  return (
    <ol className='flex items-center justify-between gap-1 px-1 pt-1' aria-label='导入步骤'>
      {steps.map((label, i) => {
        const done = i < activeStep
        const active = i === activeStep
        return (
          <li key={label} className='flex min-w-0 flex-1 flex-col items-center gap-1'>
            <span
              aria-hidden='true'
              className={
                'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold leading-none transition-colors ' +
                (done
                  ? 'bg-d-accent text-white'
                  : active
                    ? 'border-2 border-d-accent text-d-accent-light'
                    : 'border border-d-border text-d-muted')
              }
            >
              {done ? <CheckIcon size={12} /> : i + 1}
            </span>
            <span
              className={
                'max-w-full truncate text-[10px] leading-3 ' +
                (active ? 'font-semibold text-d-accent-light' : 'text-d-muted')
              }
            >
              {label}
            </span>
          </li>
        )
      })}
    </ol>
  )
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

  const getConfidenceTone = () => {
    if (confidence >= 0.8) return 'border-d-success-ink/40 bg-d-success-soft text-d-success-ink'
    if (confidence >= 0.5) return 'border-d-warn-ink/40 bg-d-gold-soft text-d-warn-ink'
    return 'border-d-danger/40 bg-d-danger-soft text-d-danger-ink'
  }

  const getConfidenceLabel = () => {
    if (confidence >= 0.8) return '高'
    if (confidence >= 0.5) return '中'
    return '低'
  }

  // Step 1: Select card
  const renderStep1 = () => (
    <div className='pt-2'>
      <SelectField
        label='选择信用卡'
        required
        value={cardId}
        onChange={e => setCardId(e.target.value)}
        options={cards.map(c => ({ value: c.id, label: c.label }))}
      />
    </div>
  )

  // Step 2: Select source type
  const renderStep2 = () => (
    <div className='pt-2'>
      <SelectField
        label='导入来源'
        value={sourceType}
        onChange={e => setSourceType(e.target.value as SourceType)}
        options={[
          { value: 'text', label: '粘贴文本 (推荐)' },
          { value: 'image', label: '上传图片 (即将推出)', disabled: true },
          { value: 'pdf', label: '上传 PDF (即将推出)', disabled: true },
        ]}
      />

      {sourceType === 'text' && (
        <div className='mt-4'>
          <Alert severity='info'>
            支持粘贴银行短信或邮件内容，系统将自动识别账单信息
          </Alert>
        </div>
      )}
    </div>
  )

  // Step 3: Input content
  const renderStep3 = () => (
    <div className='pt-2'>
      {sourceType === 'text' ? (
        <TextArea
          label='粘贴账单内容'
          rows={12}
          placeholder={'例如：\n招商银行：您账户1234的03月账单金额¥1234.56，最低还款额¥123.45，到期还款日03月25日。\n交易明细：\n03月01日 星巴克咖啡 38.00\n03月03日 地铁出行 12.00'}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 13 }}
        />
      ) : (
        <div className='rounded-2xl border-2 border-dashed border-d-border p-10 text-center'>
          <div className='mb-2 flex justify-center text-d-text'>
            <UploadIcon size={48} />
          </div>
          <p className='text-[14px] leading-5 text-d-muted'>文件上传功能即将推出</p>
        </div>
      )}
    </div>
  )

  // Step 4: Preview and edit draft
  const renderStep4 = () => {
    if (!draft) return null

    const itemsTotal = (draft.items || []).reduce((sum, item) => sum + (item.amount || 0), 0)

    return (
      <div className='pt-2'>
        {/* Confidence indicator */}
        <div className='mb-4 flex items-center gap-2'>
          <p className='text-[14px] font-semibold leading-5 text-d-text'>识别置信度:</p>
          <span
            className={'inline-flex h-6 items-center rounded-full border px-2.5 text-[12px] font-semibold leading-none ' + getConfidenceTone()}
          >
            {getConfidenceLabel()}
          </span>
          <p className='text-[13px] leading-5 text-d-muted'>
            ({(confidence * 100).toFixed(0)}%)
          </p>
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className='mb-4'>
            <Alert severity='warning'>
              <div className='flex flex-col gap-1'>
                {warnings.map((warn, i) => (
                  <p key={i} className='flex items-start gap-1.5'>
                    <AlertIcon size={14} className='mt-0.5 shrink-0' />
                    <span>{warn}</span>
                  </p>
                ))}
              </div>
            </Alert>
          </div>
        )}

        {/* Bill fields */}
        <div className='flex flex-col gap-4'>
          <TextField
            label='账单月份'
            type='month'
            value={draft.bill_month || ''}
            onChange={e => updateDraftField('bill_month', e.target.value)}
          />
          <div className='flex gap-3'>
            <div className='min-w-0 flex-1'>
              <TextField
                label='账单金额'
                type='number'
                value={draft.bill_amount || ''}
                onChange={e => updateDraftField('bill_amount', Number(e.target.value))}
                step={0.01}
              />
            </div>
            <div className='min-w-0 flex-1'>
              <TextField
                label='最低还款额'
                type='number'
                value={draft.min_payment || ''}
                onChange={e => updateDraftField('min_payment', Number(e.target.value))}
                step={0.01}
              />
            </div>
          </div>
          <TextField
            label='还款截止日'
            type='date'
            value={draft.due_date || ''}
            onChange={e => updateDraftField('due_date', e.target.value)}
          />
        </div>

        {/* Items */}
        <div className='my-4 h-px bg-d-border' />
        <p className='mb-2 text-[17px] font-semibold leading-6 text-d-text'>
          交易明细 (合计: ¥{itemsTotal.toFixed(2)})
        </p>

        {draft.items && draft.items.length > 0 ? (
          <div className='flex flex-col gap-3'>
            {draft.items.map((item, index) => (
              <div key={index} className='rounded-2xl border border-d-border bg-d-surface p-3'>
                <div className='mb-2 flex items-center justify-between'>
                  <p className='text-[13px] leading-4 text-d-muted'>
                    #{index + 1}
                  </p>
                  <button
                    type='button'
                    onClick={() => removeDraftItem(index)}
                    aria-label='删除明细'
                    className='rounded-full p-1.5 text-d-muted transition-colors hover:text-d-danger'
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
                <div className='mb-2'>
                  <TextField
                    label='商户说明'
                    value={item.description}
                    onChange={e => updateDraftItem(index, 'description', e.target.value)}
                  />
                </div>
                <div className='flex gap-3'>
                  <div className='min-w-0 flex-1'>
                    <TextField
                      label='金额'
                      type='number'
                      value={item.amount}
                      onChange={e => updateDraftItem(index, 'amount', Number(e.target.value))}
                      step={0.01}
                    />
                  </div>
                  <div className='min-w-0 flex-1'>
                    <TextField
                      label='分类'
                      value={item.category || ''}
                      onChange={e => updateDraftItem(index, 'category', e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Alert severity='info'>未识别到交易明细，可手动添加</Alert>
        )}
      </div>
    )
  }

  // Step 5: Complete
  const renderStep5 = () => (
    <div className='pt-2 text-center'>
      {success ? (
        <>
          <div className='mb-4 flex justify-center text-d-success-ink'>
            <CheckIcon size={64} />
          </div>
          <p className='mb-1 text-[22px] font-semibold leading-7 text-d-text'>导入成功</p>
          <p className='text-[14px] leading-5 text-d-muted'>
            账单已创建完成
          </p>
        </>
      ) : (
        <>
          <p className='mb-1 text-[22px] font-semibold leading-7 text-d-text'>确认导入</p>
          <p className='mb-4 text-[14px] leading-5 text-d-muted'>
            草稿已保存，确认后将创建正式账单
          </p>
          <div className='flex justify-center gap-2'>
            <Button
              variant='danger'
              onClick={handleDiscard}
              disabled={loading}
            >
              放弃
            </Button>
            <Button
              onClick={handleConfirmImport}
              loading={loading}
            >
              确认导入
            </Button>
          </div>
        </>
      )}
    </div>
  )

  const isNextDisabled = () => {
    if (loading) return true
    if (activeStep === 0 && !cardId) return true
    if (activeStep === 2 && sourceType === 'text' && !inputText.trim()) return true
    return false
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      maxWidth='md'
      title='智能导入账单'
      footer={
        activeStep < 4 ? (
          <>
            <Button
              variant='ghost'
              onClick={handleBack}
              disabled={activeStep === 0 || loading}
            >
              <ChevronLeftIcon size={16} /> 上一步
            </Button>
            <Button
              onClick={handleNext}
              disabled={isNextDisabled()}
              loading={loading}
            >
              {loading ? '处理中...' : activeStep === 3 ? '保存草稿' : <>下一步 <ChevronRightIcon size={16} /></>}
            </Button>
          </>
        ) : success ? (
          <Button onClick={handleClose}>完成</Button>
        ) : undefined
      }
    >
      <StepBar activeStep={activeStep} />

      {error && (
        <div className='mt-4'>
          <Alert severity='error'>{error}</Alert>
        </div>
      )}

      <div className='mt-2'>
        {activeStep === 0 && renderStep1()}
        {activeStep === 1 && renderStep2()}
        {activeStep === 2 && renderStep3()}
        {activeStep === 3 && renderStep4()}
        {activeStep === 4 && renderStep5()}
      </div>
    </Modal>
  )
}
