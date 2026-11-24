'use client'

import { useState } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button, CheckRow } from '@/components/obsidian/controls'
import { SelectField, TextArea } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { currencySymbol } from '@/lib/fx'
import {
  inferCsvColumnMapping,
  parseCsvBillItems,
  parseCsvMatrix,
  parsePastedBillItems,
  signedItemAmount,
  type CsvColumnMapping,
  type ParsedImportPreviewRow,
} from '@/lib/direction3/pure'
import { batchImportBillItems } from '@/lib/direction3/rpc'
import {
  SPEND_CATEGORIES,
  SPEND_CATEGORY_LABELS,
  type BillItem,
  type SpendCategory,
} from '@/lib/direction3/types'

const MAX_IMPORT_ITEMS = 500

interface Props {
  open: boolean
  onClose: () => void
  billId: string
  billMonth: string
  billCurrency: string
  existingItems: BillItem[]
  userRulesMap?: Map<string, SpendCategory>
  onImported: () => Promise<void> | void
}

const CATEGORY_OPTIONS = [
  { value: '', label: '未分类' },
  ...SPEND_CATEGORIES.map((c) => ({ value: c, label: SPEND_CATEGORY_LABELS[c] })),
]

export function BillItemImportModal({
  open,
  onClose,
  billId,
  billMonth,
  billCurrency,
  existingItems,
  userRulesMap,
  onImported,
}: Props) {
  const [tab, setTab] = useState<'text' | 'csv'>('text')
  const [pastedText, setPastedText] = useState('')
  const [csvMatrix, setCsvMatrix] = useState<string[][]>([])
  const [csvHasHeader, setCsvHasHeader] = useState(true)
  const [csvMapping, setCsvMapping] = useState<CsvColumnMapping>({
    dateCol: null,
    descCol: null,
    amountCol: null,
    debitCreditCol: null,
    currencyCol: null,
    categoryCol: null,
  })
  const [previewRows, setPreviewRows] = useState<ParsedImportPreviewRow[] | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const sym = currencySymbol(billCurrency)

  const resetAll = () => {
    setPastedText('')
    setCsvMatrix([])
    setPreviewRows(null)
    setError(null)
  }

  const handleClose = () => {
    if (submitting) return
    resetAll()
    onClose()
  }

  const handleParseText = () => {
    setError(null)
    if (!pastedText.trim()) {
      setError('请粘贴至少一行交易明细文本')
      return
    }
    const rows = parsePastedBillItems(pastedText, {
      billMonth,
      defaultCurrency: billCurrency,
      userRulesMap,
      existingItems,
    })
    if (rows.length === 0) {
      setError('未能解析出有效交易行，请确认每行至少包含描述与金额（如：2026-11-01 星巴克 38.00 餐饮）')
      return
    }
    if (rows.length > MAX_IMPORT_ITEMS) {
      setError(`单次最多导入 ${MAX_IMPORT_ITEMS} 条明细（当前 ${rows.length} 条），请分批粘贴`)
      return
    }
    setPreviewRows(rows)
  }

  const handleCsvFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null)
    const file = e.target.files?.[0]
    if (!file) return
    try {
      const content = await file.text()
      const matrix = parseCsvMatrix(content)
      if (matrix.length === 0) {
        setError('CSV 文件为空')
        return
      }
      setCsvMatrix(matrix)
      setCsvMapping(inferCsvColumnMapping(matrix[0] ?? []))
      setPreviewRows(null)
    } catch {
      setError('读取 CSV 文件失败，请确认文件为 UTF-8 编码')
    }
  }

  const handleParseCsv = () => {
    setError(null)
    if (csvMatrix.length === 0) {
      setError('请先选择 CSV 文件')
      return
    }
    if (csvMapping.amountCol === null) {
      setError('请指定「金额」所在列')
      return
    }
    const rows = parseCsvBillItems(csvMatrix, csvMapping, {
      hasHeader: csvHasHeader,
      billMonth,
      defaultCurrency: billCurrency,
      userRulesMap,
      existingItems,
    })
    if (rows.length === 0) {
      setError('按当前列映射未解析出有效金额的交易行')
      return
    }
    if (rows.length > MAX_IMPORT_ITEMS) {
      setError(`单次最多导入 ${MAX_IMPORT_ITEMS} 条明细（当前 ${rows.length} 条），请拆分 CSV`)
      return
    }
    setPreviewRows(rows)
  }

  const toggleRow = (tempId: string) => {
    setPreviewRows((prev) =>
      prev ? prev.map((r) => (r.tempId === tempId ? { ...r, checked: !r.checked } : r)) : null,
    )
  }

  const updateRowCategory = (tempId: string, category: string) => {
    setPreviewRows((prev) =>
      prev
        ? prev.map((r) =>
            r.tempId === tempId
              ? {
                  ...r,
                  item: {
                    ...r.item,
                    category: category ? (category as SpendCategory) : null,
                  },
                }
              : r,
          )
        : null,
    )
  }

  const selectedRows = previewRows?.filter((r) => r.checked) ?? []
  const duplicateCount = previewRows?.filter((r) => r.isDuplicate).length ?? 0

  const handleConfirmImport = async () => {
    if (selectedRows.length === 0) {
      setError('请至少勾选 1 条待导入明细')
      return
    }
    if (selectedRows.length > MAX_IMPORT_ITEMS) {
      setError(`单次最多导入 ${MAX_IMPORT_ITEMS} 条明细`)
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await batchImportBillItems({
        bill_id: billId,
        items: selectedRows.map((r) => r.item),
      })
      resetAll()
      await onImported()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导入明细失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  const colOptions = [
    { value: '', label: '不映射' },
    ...(csvMatrix[0] ?? []).map((col, idx) => ({
      value: String(idx),
      label: csvHasHeader ? `列 ${idx + 1}: ${col}` : `第 ${idx + 1} 列 (${col})`,
    })),
  ]

  return (
    <Modal
      open={open}
      onClose={handleClose}
      dismissible={!submitting}
      maxWidth='md'
      title='批量导入交易明细'
      footer={
        previewRows ? (
          <>
            <Button
              variant='ghost'
              onClick={() => setPreviewRows(null)}
              disabled={submitting}
            >
              返回修改
            </Button>
            <Button
              onClick={handleConfirmImport}
              loading={submitting}
              disabled={selectedRows.length === 0}
            >
              确认导入 ({selectedRows.length})
            </Button>
          </>
        ) : (
          <>
            <Button variant='ghost' onClick={handleClose}>
              取消
            </Button>
            <Button onClick={tab === 'text' ? handleParseText : handleParseCsv}>
              解析并预览
            </Button>
          </>
        )
      }
    >
      {error && (
        <div className='mb-3'>
          <Alert severity='error'>{error}</Alert>
        </div>
      )}

      {!previewRows ? (
        <div className='flex flex-col gap-3'>
          <div className='grid grid-cols-2 gap-2 rounded-xl bg-d-subtle p-1'>
            <button
              type='button'
              onClick={() => {
                setTab('text')
                setError(null)
              }}
              className={
                'h-11 rounded-lg text-[13px] font-semibold transition-colors ' +
                (tab === 'text' ? 'bg-d-accent text-white' : 'text-d-muted')
              }
            >
              粘贴文本
            </button>
            <button
              type='button'
              onClick={() => {
                setTab('csv')
                setError(null)
              }}
              className={
                'h-11 rounded-lg text-[13px] font-semibold transition-colors ' +
                (tab === 'csv' ? 'bg-d-accent text-white' : 'text-d-muted')
              }
            >
              上传 CSV 文件
            </button>
          </div>

          {tab === 'text' ? (
            <>
              <TextArea
                label='交易明细文本'
                rows={6}
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder={'每行一笔，支持制表符/逗号/多空格分隔：\n2026-11-01 星巴克 38.00 餐饮\n11/03 淘宝退款 -100.00'}
              />
              <p className='text-[12px] leading-4 text-d-muted'>
                支持缺省年份日期（如 11/03 按账单月自动补齐），负数或含「退款/REFUND」自动识别为退款扣减。
              </p>
            </>
          ) : (
            <div className='flex flex-col gap-3'>
              <label className='flex min-h-[44px] cursor-pointer items-center justify-center rounded-xl border border-dashed border-d-border bg-d-subtle px-4 py-3 text-[14px] font-semibold text-d-accent-light'>
                <span>{csvMatrix.length > 0 ? `已读取 ${csvMatrix.length} 行 · 点击重新选择` : '选择银行账单 CSV 文件'}</span>
                <input
                  type='file'
                  accept='.csv,text/csv'
                  onChange={handleCsvFileChange}
                  className='sr-only'
                />
              </label>

              {csvMatrix.length > 0 && (
                <>
                  <CheckRow checked={csvHasHeader} onChange={setCsvHasHeader}>
                    <span>首行为表头</span>
                  </CheckRow>

                  <div className='grid grid-cols-2 gap-2.5'>
                    <SelectField
                      label='交易日期列'
                      value={csvMapping.dateCol !== null ? String(csvMapping.dateCol) : ''}
                      onChange={(e) =>
                        setCsvMapping((m) => ({
                          ...m,
                          dateCol: e.target.value === '' ? null : Number(e.target.value),
                        }))
                      }
                      options={colOptions}
                    />
                    <SelectField
                      label='摘要/商户列'
                      value={csvMapping.descCol !== null ? String(csvMapping.descCol) : ''}
                      onChange={(e) =>
                        setCsvMapping((m) => ({
                          ...m,
                          descCol: e.target.value === '' ? null : Number(e.target.value),
                        }))
                      }
                      options={colOptions}
                    />
                    <SelectField
                      label='金额列'
                      required
                      value={csvMapping.amountCol !== null ? String(csvMapping.amountCol) : ''}
                      onChange={(e) =>
                        setCsvMapping((m) => ({
                          ...m,
                          amountCol: e.target.value === '' ? null : Number(e.target.value),
                        }))
                      }
                      options={colOptions}
                    />
                    <SelectField
                      label='借贷/类型列 (可选)'
                      value={csvMapping.debitCreditCol !== null ? String(csvMapping.debitCreditCol) : ''}
                      onChange={(e) =>
                        setCsvMapping((m) => ({
                          ...m,
                          debitCreditCol: e.target.value === '' ? null : Number(e.target.value),
                        }))
                      }
                      options={colOptions}
                    />
                    <SelectField
                      label='币种列 (可选)'
                      value={csvMapping.currencyCol !== null ? String(csvMapping.currencyCol) : ''}
                      onChange={(e) =>
                        setCsvMapping((m) => ({
                          ...m,
                          currencyCol: e.target.value === '' ? null : Number(e.target.value),
                        }))
                      }
                      options={colOptions}
                    />
                    <SelectField
                      label='分类列 (可选)'
                      value={csvMapping.categoryCol !== null ? String(csvMapping.categoryCol) : ''}
                      onChange={(e) =>
                        setCsvMapping((m) => ({
                          ...m,
                          categoryCol: e.target.value === '' ? null : Number(e.target.value),
                        }))
                      }
                      options={colOptions}
                    />
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className='flex flex-col gap-2.5'>
          {duplicateCount > 0 && (
            <Alert severity='warning'>
              检测到 {duplicateCount} 条疑似与本账单已有明细重复的记录，已默认取消勾选；如需保留请手动勾选。
            </Alert>
          )}
          <div className='max-h-[340px] space-y-2 overflow-y-auto pr-0.5'>
            {previewRows.map((row) => {
              const signed = signedItemAmount({
                item_type: row.item.item_type ?? 'purchase',
                amount: row.item.amount,
              })
              const isRefund = row.item.item_type === 'refund' || signed < 0
              const rowSym = currencySymbol(row.item.currency || billCurrency)
              return (
                <div
                  key={row.tempId}
                  className={
                    'rounded-xl border p-2.5 ' +
                    (row.isDuplicate
                      ? 'border-d-warn-ink/50 bg-d-gold-soft/40'
                      : 'border-d-border bg-d-subtle')
                  }
                >
                  <div className='flex items-start justify-between gap-2'>
                    <button
                      type='button'
                      role='checkbox'
                      aria-checked={row.checked}
                      onClick={() => toggleRow(row.tempId)}
                      className='flex min-h-[44px] min-w-0 flex-1 items-center gap-2 text-left'
                    >
                      <span
                        className={
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded border text-[11px] font-bold ' +
                          (row.checked
                            ? 'border-d-accent bg-d-accent text-white'
                            : 'border-d-border bg-transparent')
                        }
                      >
                        {row.checked ? '✓' : ''}
                      </span>
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate text-[13px] font-semibold text-d-text'>
                          {row.item.description}
                        </span>
                        <span className='mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-d-muted'>
                          <span>{row.item.transaction_date || '无日期'}</span>
                          <span>·</span>
                          <span>{isRefund ? '退款' : row.item.item_type === 'fee' ? '费用' : row.item.item_type === 'interest' ? '利息' : '消费'}</span>
                          {row.isDuplicate && (
                            <span className='rounded bg-d-gold-soft px-1.5 py-0.5 text-[10px] font-semibold text-d-warn-ink'>
                              疑似重复
                            </span>
                          )}
                        </span>
                      </span>
                    </button>
                    <span
                      className={
                        'num-tabular shrink-0 pt-2 text-[14px] font-bold ' +
                        (isRefund ? 'text-d-success-ink' : 'text-d-text')
                      }
                    >
                      {signed < 0 ? `-${rowSym}${Math.abs(signed).toFixed(2)}` : `${rowSym}${signed.toFixed(2)}`}
                    </span>
                  </div>

                  <div className='mt-2'>
                    <SelectField
                      aria-label={`${row.item.description} 消费分类`}
                      value={row.item.category ?? ''}
                      onChange={(e) => updateRowCategory(row.tempId, e.target.value)}
                      options={CATEGORY_OPTIONS}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          <p className='text-[12px] text-d-muted'>
            将导入 {selectedRows.length} 条明细至当前账单（{sym}，绝不自动改写账单主金额）。
          </p>
        </div>
      )}
    </Modal>
  )
}
