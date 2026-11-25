// components/mobile/BillImportDialog.tsx
'use client'

import { useState, useEffect, useMemo } from 'react'
import { Modal, ConfirmDialog } from '@/components/obsidian/overlays'
import { Button, CheckRow } from '@/components/obsidian/controls'
import { TextField, TextArea, SelectField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CheckIcon,
  UploadIcon,
  AlertIcon,
  LockIcon,
  TrashIcon,
  FileIcon,
} from '@/components/icons/WcIcon'
import { confirmBillImportDraft, discardBillImportDraft, updateBillImportDraft } from '@/lib/api/billDrafts'
import { deleteRecordAttachment, uploadRecordAttachment, type RecordAttachment } from '@/lib/api/attachments'
import { normalizeCurrencyOrDefault } from '@/lib/fx'
import type { CreditCard } from '@/lib/types'
import {
  importAndParseBill,
  unlockEncryptedDraft,
  retryParseDraft,
  confirmBillImportDraftWithOptions,
  createClientUuid,
  extractDuplicateBillDetails,
  formatAttributionLabel,
  formatDraftAmount,
  getDraftCurrencySymbol,
  suggestBankPasswordHint,
  type BillImportDraftOmnibus,
  type BillDraftPayload,
  type DuplicateBillDetails,
} from './omnibusApi'

export interface CardOption {
  id: string
  label: string
  card: CreditCard & { card_product?: { bank_name?: string; currency?: string } }
}

type SourceType = 'text' | 'image' | 'pdf'

interface Props {
  open: boolean
  onClose: () => void
  onImportSuccess: () => void
  cards: CardOption[]
  userId: string
  initialSourceType?: SourceType
  initialCardId?: string | null
}

const MAX_TEXT_LENGTH = 50_000
const MAX_SINGLE_FILE_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_COUNT = 3

const STEP_LABELS = ['提交来源', '预览核对', '完成入账']

function StepBar({ activeStep }: { activeStep: number }) {
  return (
    <ol className='flex items-center justify-between gap-1 px-1 pt-1' aria-label='导入步骤'>
      {STEP_LABELS.map((label, i) => {
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

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function isAcceptedImage(file: File): boolean {
  const mime = (file.type || '').toLowerCase()
  const name = file.name.toLowerCase()
  return (
    mime === 'image/png' ||
    mime === 'image/jpeg' ||
    mime === 'image/webp' ||
    mime === 'image/heic' ||
    mime === 'image/heif' ||
    /\.(png|jpe?g|webp|heic|heif)$/.test(name)
  )
}

function isAcceptedPdf(file: File): boolean {
  const mime = (file.type || '').toLowerCase()
  const name = file.name.toLowerCase()
  return mime === 'application/pdf' || name.endsWith('.pdf')
}

function confidenceBadge(confidence: number | null): { label: string; cls: string } {
  const score = confidence ?? 0
  if (score >= 0.85) {
    return {
      label: `高 ${(score * 100).toFixed(0)}%`,
      cls: 'border-d-success-ink/40 bg-d-success-soft text-d-success-ink',
    }
  }
  if (score >= 0.5) {
    return {
      label: `中 ${(score * 100).toFixed(0)}%`,
      cls: 'border-d-warn-ink/40 bg-d-gold-soft text-d-warn-ink',
    }
  }
  return {
    label: `低 ${(score * 100).toFixed(0)}%`,
    cls: 'border-d-danger/40 bg-d-danger-soft text-d-danger-ink',
  }
}

export function BillImportDialog({
  open,
  onClose,
  onImportSuccess,
  cards,
  userId,
  initialSourceType = 'text',
  initialCardId = null,
}: Props) {
  const [activeStep, setActiveStep] = useState(0)
  const [selectedCardId, setSelectedCardId] = useState(initialCardId ?? '')
  const [sourceType, setSourceType] = useState<SourceType>(initialSourceType)
  const [inputText, setInputText] = useState('')
  const [imageFiles, setImageFiles] = useState<File[]>([])
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [showAdvancedPdfPw, setShowAdvancedPdfPw] = useState(false)
  const [pdfPassword, setPdfPassword] = useState('')
  const [savePasswordToVault, setSavePasswordToVault] = useState(true)
  const [passwordLabel, setPasswordLabel] = useState('')
  const [passwordHint, setPasswordHint] = useState('')

  const [drafts, setDrafts] = useState<BillImportDraftOmnibus[]>([])
  const [activeDraftIdx, setActiveDraftIdx] = useState(0)
  const [unlockPassword, setUnlockPassword] = useState('')
  const [unlockSaveToVault, setUnlockSaveToVault] = useState(true)
  const [unlockLabel, setUnlockLabel] = useState('')
  const [unlockHint, setUnlockHint] = useState('')

  const [nonBillMessage, setNonBillMessage] = useState<string | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<RecordAttachment[] | null>(null)
  const [duplicateConflict, setDuplicateConflict] = useState<DuplicateBillDetails | null>(null)
  const [editedDraftIds, setEditedDraftIds] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [infoNotice, setInfoNotice] = useState('')
  const [confirmedCount, setConfirmedCount] = useState(0)

  useEffect(() => {
    if (!open) return
    setActiveStep(0)
    setSelectedCardId(initialCardId ?? '')
    setSourceType(initialSourceType)
    setInputText('')
    setImageFiles([])
    setPdfFile(null)
    setShowAdvancedPdfPw(false)
    setPdfPassword('')
    setSavePasswordToVault(true)
    setPasswordLabel('')
    setPasswordHint('')
    setDrafts([])
    setActiveDraftIdx(0)
    setUnlockPassword('')
    setUnlockSaveToVault(true)
    setUnlockLabel('')
    setUnlockHint('')
    setNonBillMessage(null)
    setPendingAttachments(null)
    setDuplicateConflict(null)
    setEditedDraftIds(new Set())
    setLoading(false)
    setError('')
    setInfoNotice('')
    setConfirmedCount(0)
  }, [open, initialSourceType, initialCardId])

  const currentDraft = drafts[activeDraftIdx] ?? null

  const activeCurrency = useMemo(() => {
    const matchedCard = cards.find(c => c.id === currentDraft?.card_id)
    return normalizeCurrencyOrDefault(
      currentDraft?.parsed_payload?.currency ?? matchedCard?.card.card_product?.currency,
      'CNY'
    )
  }, [cards, currentDraft])

  const currencySym = getDraftCurrencySymbol(activeCurrency)

  const handleClose = () => {
    if (confirmedCount > 0 || drafts.length > 0) {
      onImportSuccess()
    }
    onClose()
  }

  const handleImagePick = (fileList: FileList | null) => {
    setError('')
    setNonBillMessage(null)
    setPendingAttachments(null)
    if (!fileList || fileList.length === 0) return
    const next = [...imageFiles]
    for (const f of Array.from(fileList)) {
      if (!isAcceptedImage(f)) {
        setError(`不支持的图片格式：${f.name}（仅支持 PNG / JPEG / WebP / HEIC）`)
        return
      }
      if (f.size > MAX_SINGLE_FILE_BYTES) {
        setError(`图片「${f.name}」超过 10MB 上限`)
        return
      }
      if (next.length >= MAX_IMAGE_COUNT) {
        setError(`单次最多上传 ${MAX_IMAGE_COUNT} 张账单截图`)
        return
      }
      next.push(f)
    }
    const totalBytes = next.reduce((sum, f) => sum + f.size, 0)
    if (totalBytes > MAX_TOTAL_IMAGE_BYTES) {
      setError('单次上传图片合计不能超过 20MB')
      return
    }
    setImageFiles(next)
  }

  const handlePdfPick = (fileList: FileList | null) => {
    setError('')
    setNonBillMessage(null)
    setPendingAttachments(null)
    if (!fileList || fileList.length === 0) return
    const file = fileList[0]
    if (!isAcceptedPdf(file)) {
      setError('请选择 .pdf 格式的月结单文件')
      return
    }
    if (file.size > MAX_SINGLE_FILE_BYTES) {
      setError('单个 PDF 文件不能超过 10MB')
      return
    }
    setPdfFile(file)
  }

  const rollbackAttachments = async (attachments: RecordAttachment[]) => {
    if (attachments.length === 0) return
    await Promise.allSettled(attachments.map(att => deleteRecordAttachment(att)))
  }

  const runImportAndParse = async (forceSaveNonBill = false) => {
    setError('')
    setInfoNotice('')
    setNonBillMessage(null)

    if (sourceType === 'text') {
      const trimmed = inputText.trim()
      if (!trimmed) {
        setError('请输入账单文本内容')
        return
      }
      if (trimmed.length > MAX_TEXT_LENGTH) {
        setError('账单文本不能超过 50,000 字符')
        return
      }
    } else if (sourceType === 'image') {
      if (imageFiles.length === 0) {
        setError('请至少选择 1 张账单截图')
        return
      }
    } else if (sourceType === 'pdf') {
      if (!pdfFile) {
        setError('请选择需要导入的 PDF 月结单')
        return
      }
    }

    setLoading(true)
    const newlyUploaded: RecordAttachment[] = []
    try {
      const preDraftId = createClientUuid()
      const clientRequestId = createClientUuid()
      let attachmentsForRun: RecordAttachment[] =
        forceSaveNonBill && pendingAttachments ? pendingAttachments : []

      if (attachmentsForRun.length === 0) {
        if (sourceType === 'image') {
          for (const file of imageFiles) {
            const uploaded = await uploadRecordAttachment('draft', preDraftId, file, userId)
            newlyUploaded.push(uploaded)
          }
          attachmentsForRun = newlyUploaded
        } else if (sourceType === 'pdf' && pdfFile) {
          const uploaded = await uploadRecordAttachment('draft', preDraftId, pdfFile, userId)
          newlyUploaded.push(uploaded)
          attachmentsForRun = newlyUploaded
        }
      }

      const attachmentIds = attachmentsForRun.length > 0 ? attachmentsForRun.map(a => a.id) : undefined

      const res = await importAndParseBill({
        source_type: sourceType,
        raw_text: sourceType === 'text' ? inputText.trim() : undefined,
        attachment_ids: attachmentIds,
        card_id: selectedCardId || null,
        pdf_password: sourceType === 'pdf' && pdfPassword ? pdfPassword : undefined,
        save_password_to_vault:
          sourceType === 'pdf' && pdfPassword ? savePasswordToVault : undefined,
        password_label: passwordLabel.trim() || undefined,
        password_hint: passwordHint.trim() || undefined,
        force_save_non_bill: forceSaveNonBill || undefined,
        client_request_id: clientRequestId,
      })

      if (res.outcome === 'non_bill_warning') {
        if (attachmentsForRun.length > 0) {
          setPendingAttachments(attachmentsForRun)
        }
        setNonBillMessage(res.message || '识别内容疑似非信用卡账单或自动扣款通知，请确认是否继续保存为草稿')
        return
      }

      if (res.outcome === 'duplicate_file') {
        const orphanAttachments = pendingAttachments ?? newlyUploaded
        await rollbackAttachments(orphanAttachments)
        setInfoNotice(res.message || '该文件已存在一份待确认草稿，已为你定位到既有草稿')
      }

      setPendingAttachments(null)
      setPdfPassword('')
      setPasswordLabel('')
      setPasswordHint('')
      setDrafts(res.drafts)
      setActiveDraftIdx(0)
      setEditedDraftIds(new Set())
      setActiveStep(1)
    } catch (err) {
      const toRollback = forceSaveNonBill && pendingAttachments ? pendingAttachments : newlyUploaded
      await rollbackAttachments(toRollback)
      if (forceSaveNonBill) setPendingAttachments(null)
      setError(err instanceof Error ? err.message : '导入解析失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const handleUnlockCurrentDraft = async () => {
    if (!currentDraft) return
    if (!unlockPassword) {
      setError('请输入 PDF 解密密码')
      return
    }
    setError('')
    setLoading(true)
    try {
      const res = await unlockEncryptedDraft(currentDraft.id, {
        password: unlockPassword,
        save_to_vault: unlockSaveToVault,
        vault_label:
          unlockLabel.trim() ||
          `${currentDraft.parsed_payload.bank_name || '月结单'}密码`,
        vault_holder_id: currentDraft.holder_id ?? null,
        vault_bank_keyword: currentDraft.parsed_payload.bank_name ?? null,
        vault_hint: unlockHint.trim() || null,
      })
      setDrafts(res.drafts)
      setActiveDraftIdx(0)
      setUnlockPassword('')
      setEditedDraftIds(new Set())
      if (res.vault_rule_saved) {
        setInfoNotice('PDF 已解密并保存到家庭月结单密码本')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '密码错误或解密失败')
    } finally {
      setLoading(false)
    }
  }

  const handleRetryParse = async (manualMode = false) => {
    if (!currentDraft) return
    setError('')
    setLoading(true)
    try {
      const updated = await retryParseDraft(currentDraft.id, manualMode ? { manual_mode: true } : undefined)
      setDrafts(prev => prev.map((d, i) => (i === activeDraftIdx ? updated : d)))
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败')
    } finally {
      setLoading(false)
    }
  }

  const updateCurrentDraft = (
    updater: (prev: BillImportDraftOmnibus) => BillImportDraftOmnibus
  ) => {
    if (currentDraft) {
      setEditedDraftIds(prev => {
        const next = new Set(prev)
        next.add(currentDraft.id)
        return next
      })
    }
    setDrafts(prev => prev.map((d, i) => (i === activeDraftIdx ? updater(d) : d)))
  }

  const updateCurrentPayload = <K extends keyof BillDraftPayload>(
    key: K,
    value: BillDraftPayload[K]
  ) => {
    updateCurrentDraft(d => ({
      ...d,
      parsed_payload: { ...d.parsed_payload, [key]: value },
    }))
  }

  const persistDraftEdits = async (target: BillImportDraftOmnibus) => {
    if (!editedDraftIds.has(target.id)) return
    await updateBillImportDraft(target.id, {
      card_id: target.card_id ?? undefined,
      parsed_payload: target.parsed_payload as Record<string, unknown>,
    })
    setEditedDraftIds(prev => {
      const next = new Set(prev)
      next.delete(target.id)
      return next
    })
  }

  const persistAllEditedDrafts = async () => {
    for (const draft of drafts) {
      if (editedDraftIds.has(draft.id)) {
        await persistDraftEdits(draft)
      }
    }
  }

  const canConfirmCurrentDraft = useMemo(() => {
    if (!currentDraft) return false
    if (currentDraft.parse_status && currentDraft.parse_status !== 'ready') return false
    if (!currentDraft.card_id) return false
    const p = currentDraft.parsed_payload
    if (p.bill_amount == null || !Number.isFinite(Number(p.bill_amount)) || Number(p.bill_amount) < 0) {
      return false
    }
    if (!p.bill_month || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.bill_month)) return false
    if (Number(p.bill_amount) > 0 && !p.due_date) return false
    return true
  }, [currentDraft])

  const handleConfirmCurrentDraft = async (forceMerge = false) => {
    if (!currentDraft) return
    setError('')
    setLoading(true)
    try {
      await persistDraftEdits(currentDraft)
      if (forceMerge) {
        await confirmBillImportDraftWithOptions(currentDraft.id, {
          conflict_resolution: 'merge_update',
        })
      } else {
        await confirmBillImportDraft(currentDraft.id)
      }
      setDuplicateConflict(null)
      setConfirmedCount(c => c + 1)

      if (drafts.length > 1) {
        const remaining = drafts.filter((_, idx) => idx !== activeDraftIdx)
        setDrafts(remaining)
        setActiveDraftIdx(0)
        setInfoNotice(`已入账 1 份账单，还剩 ${remaining.length} 份待核对`)
      } else {
        setActiveStep(2)
      }
    } catch (err) {
      const dup = extractDuplicateBillDetails(err)
      if (dup) {
        setDuplicateConflict(dup)
      } else {
        setError(err instanceof Error ? err.message : '确认入账失败')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleSaveToDraftBox = async () => {
    setError('')
    setLoading(true)
    try {
      await persistAllEditedDrafts()
      onImportSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存草稿失败')
    } finally {
      setLoading(false)
    }
  }

  const handleDiscardCurrentDraft = async () => {
    if (!currentDraft) return
    setError('')
    setLoading(true)
    try {
      await discardBillImportDraft(currentDraft.id)
      setDuplicateConflict(null)
      if (drafts.length > 1) {
        const remaining = drafts.filter((_, idx) => idx !== activeDraftIdx)
        setDrafts(remaining)
        setActiveDraftIdx(0)
      } else {
        onImportSuccess()
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '丢弃草稿失败')
    } finally {
      setLoading(false)
    }
  }

  const renderStep0 = () => (
    <div className='flex flex-col gap-3.5 pt-2'>
      <SelectField
        label='预选信用卡（选填，不选则由 AI 自动匹配）'
        value={selectedCardId}
        onChange={e => setSelectedCardId(e.target.value)}
        options={[
          { value: '', label: '自动识别并匹配信用卡（推荐）' },
          ...cards.map(c => ({ value: c.id, label: c.label })),
        ]}
      />

      {/* 来源分段切换 */}
      <div>
        <p className='mb-1.5 text-[13px] font-semibold leading-5 text-d-muted'>导入方式</p>
        <div className='grid grid-cols-3 gap-1.5 rounded-xl border border-d-border bg-d-bg p-1'>
          {([
            ['text', '粘贴文本'],
            ['image', '上传截图'],
            ['pdf', '上传 PDF'],
          ] as Array<[SourceType, string]>).map(([val, label]) => {
            const active = sourceType === val
            return (
              <button
                key={val}
                type='button'
                onClick={() => {
                  setSourceType(val)
                  setError('')
                  setNonBillMessage(null)
                }}
                className={
                  'min-h-[40px] rounded-lg px-2 text-[13px] font-semibold transition-colors ' +
                  (active ? 'bg-d-accent text-white' : 'text-d-muted hover:text-d-text')
                }
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>

      {sourceType === 'text' && (
        <TextArea
          label='账单短信 / 邮件内容'
          rows={7}
          maxLength={MAX_TEXT_LENGTH}
          placeholder={'粘贴银行短信或邮件正文，例如：\n招商银行：您账户1234的03月账单金额¥1234.56，最低还款额¥123.45，到期还款日03月25日。'}
          value={inputText}
          onChange={e => setInputText(e.target.value)}
          helperText={`支持中/港/美多币种账单文本，最多 ${MAX_TEXT_LENGTH.toLocaleString()} 字`}
        />
      )}

      {sourceType === 'image' && (
        <div className='flex flex-col gap-2.5'>
          <label className='flex min-h-[112px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-d-border bg-d-bg/60 p-4 text-center transition-colors hover:border-d-accent'>
            <UploadIcon size={28} className='text-d-accent-light' />
            <span className='text-[14px] font-semibold text-d-text'>
              点击选择账单截图（最多 3 张）
            </span>
            <span className='text-[12px] text-d-muted'>
              支持 PNG / JPEG / WebP / HEIC，单张 ≤ 10MB，合计 ≤ 20MB
            </span>
            <input
              type='file'
              aria-label='选择账单截图'
              accept='image/png,image/jpeg,image/webp,image/heic,.png,.jpg,.jpeg,.webp,.heic'
              multiple
              className='sr-only'
              onChange={e => {
                handleImagePick(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          {imageFiles.length > 0 && (
            <div className='flex flex-col gap-1.5'>
              {imageFiles.map((file, idx) => (
                <div
                  key={`${file.name}-${idx}`}
                  className='flex items-center justify-between rounded-xl border border-d-border bg-d-surface px-3 py-2'
                >
                  <div className='min-w-0 flex-1'>
                    <p className='truncate text-[13px] font-medium text-d-text'>{file.name}</p>
                    <p className='text-[11px] text-d-muted'>{formatFileSize(file.size)}</p>
                  </div>
                  <button
                    type='button'
                    aria-label={`移除 ${file.name}`}
                    onClick={() => setImageFiles(prev => prev.filter((_, i) => i !== idx))}
                    className='flex h-9 w-9 items-center justify-center rounded-lg text-d-muted hover:text-d-danger-ink'
                  >
                    <TrashIcon size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {sourceType === 'pdf' && (
        <div className='flex flex-col gap-3'>
          <label className='flex min-h-[112px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-d-border bg-d-bg/60 p-4 text-center transition-colors hover:border-d-accent'>
            <FileIcon size={28} className='text-d-accent-light' />
            <span className='text-[14px] font-semibold text-d-text'>
              {pdfFile ? pdfFile.name : '点击选择 PDF 月结单'}
            </span>
            <span className='text-[12px] text-d-muted'>
              {pdfFile
                ? `${formatFileSize(pdfFile.size)} · 支持明文或加密月结单`
                : '支持加密 PDF（自动尝试密码本）· 单个文件 ≤ 10MB'}
            </span>
            <input
              type='file'
              aria-label='选择 PDF 月结单'
              accept='application/pdf,.pdf'
              className='sr-only'
              onChange={e => {
                handlePdfPick(e.target.files)
                e.target.value = ''
              }}
            />
          </label>

          <button
            type='button'
            onClick={() => setShowAdvancedPdfPw(v => !v)}
            className='flex min-h-[36px] items-center justify-between rounded-xl border border-d-border bg-d-subtle/60 px-3 text-[12px] font-semibold text-d-muted'
          >
            <span className='flex items-center gap-1.5'>
              <LockIcon size={14} />
              如已知加密密码可提前填写（选填）
            </span>
            <span>{showAdvancedPdfPw ? '收起' : '展开'}</span>
          </button>

          {showAdvancedPdfPw && (
            <div className='flex flex-col gap-2.5 rounded-xl border border-d-border bg-d-bg/40 p-3'>
              <TextField
                label='PDF 打开密码（选填）'
                type='password'
                placeholder='若不填，将先尝试家庭密码本自动解密'
                value={pdfPassword}
                onChange={e => setPdfPassword(e.target.value)}
              />
              {pdfPassword && (
                <>
                  <CheckRow checked={savePasswordToVault} onChange={setSavePasswordToVault}>
                    同时保存到家庭月结单密码本（AES-GCM 加密存储）
                  </CheckRow>
                  {savePasswordToVault && (
                    <div className='grid grid-cols-2 gap-2'>
                      <TextField
                        label='规则名称（选填）'
                        placeholder='如：本人建行身份证'
                        value={passwordLabel}
                        onChange={e => setPasswordLabel(e.target.value)}
                      />
                      <TextField
                        label='密码提示（选填）'
                        placeholder='如：身份证后6位'
                        value={passwordHint}
                        onChange={e => setPasswordHint(e.target.value)}
                      />
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}

      {nonBillMessage && (
        <Alert severity='warning'>
          <div className='flex flex-col gap-2'>
            <p className='text-[13px]'>{nonBillMessage}</p>
            <div className='flex gap-2'>
              <Button
                size='sm'
                variant='secondary'
                onClick={() => setNonBillMessage(null)}
                disabled={loading}
              >
                重新选择
              </Button>
              <Button
                size='sm'
                onClick={() => void runImportAndParse(true)}
                loading={loading}
              >
                仍转为草稿手动填写
              </Button>
            </div>
          </div>
        </Alert>
      )}
    </div>
  )

  const renderStep1 = () => {
    if (!currentDraft) return null
    const p = currentDraft.parsed_payload
    const parseStatus = currentDraft.parse_status ?? 'ready'
    const badge = confidenceBadge(currentDraft.confidence)
    const attributionText = formatAttributionLabel(currentDraft.attribution_source)
    const suggestedHint =
      currentDraft.password_hint ||
      suggestBankPasswordHint(`${p.bank_name || ''} ${pdfFile?.name || ''}`)

    if (parseStatus === 'needs_password') {
      return (
        <div className='flex flex-col gap-3.5 pt-2'>
          <Alert severity='warning'>
            <div className='flex flex-col gap-1'>
              <p className='font-semibold'>该 PDF 月结单受密码保护，原件已安全留存</p>
              {suggestedHint && <p className='text-[12px]'>提示：{suggestedHint}</p>}
            </div>
          </Alert>
          <TextField
            label='请输入 PDF 解密密码'
            type='password'
            placeholder='输入密码后原地解密并解析'
            value={unlockPassword}
            onChange={e => setUnlockPassword(e.target.value)}
          />
          <CheckRow checked={unlockSaveToVault} onChange={setUnlockSaveToVault}>
            保存到月结单密码本（下次同银行自动解密）
          </CheckRow>
          {unlockSaveToVault && (
            <div className='grid grid-cols-2 gap-2'>
              <TextField
                label='规则名称（选填）'
                placeholder='如：招行月结单'
                value={unlockLabel}
                onChange={e => setUnlockLabel(e.target.value)}
              />
              <TextField
                label='密码提示词（选填）'
                placeholder='如：身份证后6位'
                value={unlockHint}
                onChange={e => setUnlockHint(e.target.value)}
              />
            </div>
          )}
          <Button onClick={() => void handleUnlockCurrentDraft()} loading={loading}>
            解锁并解析
          </Button>
        </div>
      )
    }

    if (parseStatus === 'parse_failed') {
      return (
        <div className='flex flex-col gap-3.5 pt-2'>
          <Alert severity='error'>
            {currentDraft.error_message || '智能解析失败或超时，原件已保留'}
          </Alert>
          <div className='flex gap-2'>
            <Button variant='secondary' onClick={() => void handleRetryParse(false)} loading={loading}>
              重试解析
            </Button>
            <Button onClick={() => void handleRetryParse(true)} loading={loading}>
              转为手动填写
            </Button>
          </div>
        </div>
      )
    }

    const candidateIds = new Set(p.candidate_card_ids || [])
    const orderedCards =
      candidateIds.size > 0
        ? [
            ...cards.filter(c => candidateIds.has(c.id)),
            ...cards.filter(c => !candidateIds.has(c.id)),
          ]
        : cards

    return (
      <div className='flex flex-col gap-3.5 pt-2'>
        {drafts.length > 1 && (
          <div className='rounded-xl border border-d-accent/30 bg-d-subtle p-3'>
            <p className='text-[12px] font-semibold text-d-accent-light'>
              该多币种月结单已拆分为 {drafts.length} 份独立账单草稿，请分别核对入账：
            </p>
            <div className='mt-2 flex flex-wrap gap-1.5'>
              {drafts.map((d, idx) => (
                <button
                  key={d.id}
                  type='button'
                  onClick={() => {
                    setActiveDraftIdx(idx)
                  }}
                  className={
                    'rounded-full px-3 py-1 text-[12px] font-semibold ' +
                    (idx === activeDraftIdx
                      ? 'bg-d-accent text-white'
                      : 'border border-d-border bg-d-surface text-d-muted')
                  }
                >
                  {d.parsed_payload.currency || 'CNY'} ·{' '}
                  {formatDraftAmount(d.parsed_payload.bill_amount, d.parsed_payload.currency)}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className='flex flex-wrap items-center gap-2'>
          <span className='text-[13px] font-semibold text-d-text'>识别置信度</span>
          <span
            className={`inline-flex h-6 items-center rounded-full border px-2.5 text-[11px] font-semibold ${badge.cls}`}
          >
            {badge.label}
          </span>
          {attributionText && (
            <span className='rounded-full border border-d-border bg-d-subtle px-2.5 py-0.5 text-[11px] text-d-muted'>
              归属：{attributionText}
            </span>
          )}
          <span className='rounded-full border border-d-border bg-d-subtle px-2.5 py-0.5 text-[11px] text-d-muted'>
            币种：{activeCurrency}
          </span>
        </div>

        {(p.warnings?.length ?? 0) > 0 && (
          <Alert severity='warning'>
            <div className='flex flex-col gap-1'>
              {p.warnings?.map((warn, i) => (
                <p key={i} className='flex items-start gap-1.5 text-[12px]'>
                  <AlertIcon size={14} className='mt-0.5 shrink-0' />
                  <span>{warn}</span>
                </p>
              ))}
            </div>
          </Alert>
        )}

        <SelectField
          label='归属信用卡'
          required
          value={currentDraft.card_id ?? ''}
          onChange={e => updateCurrentDraft(d => ({ ...d, card_id: e.target.value || null }))}
          placeholder='请选择信用卡'
          options={orderedCards.map(c => ({
            value: c.id,
            label: candidateIds.has(c.id) ? `★ 候选 · ${c.label}` : c.label,
          }))}
          helperText={
            !currentDraft.card_id
              ? `识别到 ${p.bank_name || '银行'} ${p.card_last4 ? `尾号 ${p.card_last4}` : ''}，请选择对应信用卡后入账`
              : undefined
          }
        />

        <div className='grid grid-cols-2 gap-3'>
          <TextField
            label='账单月份'
            required
            type='month'
            value={p.bill_month || ''}
            onChange={e => updateCurrentPayload('bill_month', e.target.value)}
          />
          <SelectField
            label='账单币种'
            value={activeCurrency}
            onChange={e => updateCurrentPayload('currency', e.target.value)}
            options={[
              { value: 'CNY', label: '人民币 CNY (¥)' },
              { value: 'USD', label: '美元 USD (US$)' },
              { value: 'HKD', label: '港币 HKD (HK$)' },
              { value: 'JPY', label: '日元 JPY (¥)' },
              { value: 'EUR', label: '欧元 EUR (€)' },
              { value: 'GBP', label: '英镑 GBP (£)' },
            ]}
          />
        </div>

        <div className='grid grid-cols-2 gap-3'>
          <TextField
            label='本期应还金额'
            required
            type='number'
            min={0}
            step={0.01}
            startAdornment={<span className='text-[13px] font-semibold'>{currencySym}</span>}
            value={p.bill_amount ?? ''}
            onChange={e =>
              updateCurrentPayload(
                'bill_amount',
                e.target.value === '' ? null : Number(e.target.value)
              )
            }
          />
          <TextField
            label='最低还款额'
            type='number'
            min={0}
            step={0.01}
            startAdornment={<span className='text-[13px] font-semibold'>{currencySym}</span>}
            value={p.min_payment ?? ''}
            onChange={e =>
              updateCurrentPayload(
                'min_payment',
                e.target.value === '' ? null : Number(e.target.value)
              )
            }
          />
        </div>

        <div className='grid grid-cols-2 gap-3'>
          <TextField
            label='出账日（选填）'
            type='date'
            value={p.statement_date || ''}
            onChange={e => updateCurrentPayload('statement_date', e.target.value || undefined)}
          />
          <TextField
            label='还款截止日'
            required={Number(p.bill_amount ?? 0) > 0}
            type='date'
            value={p.due_date || ''}
            onChange={e => updateCurrentPayload('due_date', e.target.value || null)}
          />
        </div>

        {(p.card_subtotals?.length ?? 0) > 0 && (
          <div className='rounded-xl border border-d-border bg-d-bg/60 p-3'>
            <p className='mb-1.5 text-[12px] font-semibold text-d-muted'>合并账户分卡小计</p>
            <div className='flex flex-col gap-1'>
              {p.card_subtotals?.map((sub, i) => (
                <div key={i} className='flex items-center justify-between text-[12px]'>
                  <span className='text-d-text'>
                    {sub.card_name || '卡'} · 尾号 {sub.card_last4}
                  </span>
                  <span className='num-tabular font-semibold text-d-text'>
                    {formatDraftAmount(sub.amount, sub.currency || activeCurrency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {(p.items?.length ?? 0) > 0 && (
          <div className='rounded-xl border border-d-border bg-d-bg/60 p-3'>
            <p className='mb-1.5 text-[12px] font-semibold text-d-muted'>
              识别交易明细 ({p.items?.length} 笔)
            </p>
            <div className='max-h-32 space-y-1 overflow-y-auto'>
              {p.items?.slice(0, 20).map((item, i) => (
                <div key={i} className='flex items-center justify-between gap-2 text-[12px]'>
                  <span className='min-w-0 flex-1 truncate text-d-text'>
                    {item.transaction_date ? `${item.transaction_date} · ` : ''}
                    {item.description}
                  </span>
                  <span className='num-tabular shrink-0 font-semibold text-d-text'>
                    {formatDraftAmount(item.amount, activeCurrency)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    )
  }

  const renderStep2 = () => (
    <div className='pt-4 text-center'>
      <div className='mb-3 flex justify-center text-d-success-ink'>
        <CheckIcon size={56} />
      </div>
      <p className='mb-1 text-[20px] font-bold text-d-text'>确认入账成功</p>
      <p className='text-[13px] text-d-muted'>
        已完成 {confirmedCount} 笔账单入账并保留原件溯源
      </p>
    </div>
  )

  const renderFooter = () => {
    if (activeStep === 0) {
      return (
        <>
          <Button variant='ghost' onClick={handleClose} disabled={loading}>
            取消
          </Button>
          <Button onClick={() => void runImportAndParse(false)} loading={loading}>
            {loading ? '上传并解析中…' : <>开始解析 <ChevronRightIcon size={16} /></>}
          </Button>
        </>
      )
    }
    if (activeStep === 1) {
      return (
        <>
          <Button
            variant='ghost'
            onClick={() => {
              setError('')
              setActiveStep(0)
            }}
            disabled={loading}
          >
            <ChevronLeftIcon size={16} /> 重新导入
          </Button>
          <Button variant='secondary' onClick={() => void handleSaveToDraftBox()} disabled={loading}>
            暂存草稿箱
          </Button>
          <Button
            onClick={() => void handleConfirmCurrentDraft(false)}
            disabled={!canConfirmCurrentDraft || loading}
            loading={loading}
          >
            确认入账
          </Button>
        </>
      )
    }
    return <Button onClick={handleClose}>完成</Button>
  }

  return (
    <>
      <Modal
        open={open}
        onClose={handleClose}
        maxWidth='md'
        dismissible={!loading}
        title='智能导入账单'
        footer={renderFooter()}
      >
        <StepBar activeStep={activeStep} />

        {infoNotice && (
          <div className='mt-3'>
            <Alert severity='info'>{infoNotice}</Alert>
          </div>
        )}

        {error && (
          <div className='mt-3'>
            <Alert severity='error'>{error}</Alert>
          </div>
        )}

        <div className='mt-2'>
          {activeStep === 0 && renderStep0()}
          {activeStep === 1 && renderStep1()}
          {activeStep === 2 && renderStep2()}
        </div>
      </Modal>

      <ConfirmDialog
        open={duplicateConflict !== null}
        title='检测到同卡同月重复账单'
        onClose={() => !loading && setDuplicateConflict(null)}
        actions={
          <>
            <Button
              variant='ghost'
              size='sm'
              disabled={loading}
              onClick={() => void handleDiscardCurrentDraft()}
            >
              丢弃草稿
            </Button>
            <Button
              size='sm'
              loading={loading}
              onClick={() => void handleConfirmCurrentDraft(true)}
            >
              合并更新原账单
            </Button>
          </>
        }
      >
        {duplicateConflict && (
          <div className='flex flex-col gap-2 text-[13px]'>
            <p className='text-d-muted'>
              该卡在 {duplicateConflict.existing_bill.bill_month} 已存在正式账单，请核对后选择处理方式：
            </p>
            <div className='grid grid-cols-2 gap-2 rounded-xl border border-d-border bg-d-bg p-3'>
              <div>
                <p className='text-[11px] text-d-muted'>现有账单</p>
                <p className='mt-0.5 font-bold text-d-text'>
                  {formatDraftAmount(
                    duplicateConflict.existing_bill.bill_amount,
                    duplicateConflict.draft_bill.currency
                  )}
                </p>
                <p className='text-[11px] text-d-muted'>
                  状态：{duplicateConflict.existing_bill.status}
                  {duplicateConflict.existing_bill.paid_amount
                    ? ` · 已还 ${formatDraftAmount(duplicateConflict.existing_bill.paid_amount, duplicateConflict.draft_bill.currency)}`
                    : ''}
                </p>
              </div>
              <div>
                <p className='text-[11px] text-d-muted'>新导入草稿</p>
                <p className='mt-0.5 font-bold text-d-accent-light'>
                  {formatDraftAmount(
                    duplicateConflict.draft_bill.bill_amount,
                    duplicateConflict.draft_bill.currency
                  )}
                </p>
                <p className='text-[11px] text-d-muted'>
                  到期：{duplicateConflict.draft_bill.due_date || '—'}
                </p>
              </div>
            </div>
          </div>
        )}
      </ConfirmDialog>
    </>
  )
}
