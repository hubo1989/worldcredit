'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { DownloadIcon } from '@/components/icons/WcIcon'
import { useAuth } from '@/lib/auth'
import { downloadCsv } from '@/lib/export'
import {
  buildSafeCsv,
  sanitizeFilenameSegment,
  statementReportToCsv,
} from '@/lib/direction3/pure'
import { exportFamilyCsvRows, getStatementReport } from '@/lib/direction3/rpc'
import type { FamilyExportType } from '@/lib/direction3/types'
import type { CardHolder, CreditCard } from '@/lib/types'

interface CardOption {
  id: string
  label: string
  card: CreditCard
}

interface Props {
  open: boolean
  onClose: () => void
  holderId: string
  holders: CardHolder[]
  cards: CardOption[]
  isAdmin?: boolean
  displayCurrency?: string
}

type ExportMode = 'data' | 'monthly_report' | 'annual_report'

const TYPE_LABELS: Record<FamilyExportType, string> = {
  bills: '账单',
  payments: '还款',
  bill_items: '账单明细',
  installments: '分期计划',
  benefit_usages: '权益使用',
  promo_usages: '优惠使用',
  opportunity_usages: '机会台账使用',
}

export function ExportDialog({
  open,
  onClose,
  holderId,
  holders,
  cards,
  isAdmin: isAdminProp,
  displayCurrency = 'CNY',
}: Props) {
  const router = useRouter()
  const { user } = useAuth()
  const isAdmin = isAdminProp ?? user?.role === 'admin'

  const [mode, setMode] = useState<ExportMode>('data')
  const [exportType, setExportType] = useState<FamilyExportType>('bills')
  const [selectedScope, setSelectedScope] = useState<string>(
    isAdmin && !holderId ? 'family' : holderId || holders[0]?.id || '',
  )
  const [selectedCardId, setSelectedCardId] = useState<string>('')
  const [dateRange, setDateRange] = useState<'current_month' | 'last_month' | 'custom'>('current_month')
  const [startDate, setStartDate] = useState(format(startOfMonth(new Date()), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(endOfMonth(new Date()), 'yyyy-MM-dd'))
  const [reportPeriod, setReportPeriod] = useState(format(new Date(), 'yyyy-MM'))
  const [reportYear, setReportYear] = useState(format(new Date(), 'yyyy'))

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      if (isAdmin) {
        setSelectedScope(holderId || 'family')
      } else {
        setSelectedScope(holderId || holders[0]?.id || '')
      }
      setSelectedCardId('')
      setError('')
    }
  }, [open, holderId, holders, isAdmin])

  const effectiveScope: 'family' | 'holder' =
    isAdmin && selectedScope === 'family' ? 'family' : 'holder'
  const effectiveHolderId =
    effectiveScope === 'holder' ? selectedScope || holders[0]?.id || undefined : undefined

  const handleDateRangeChange = (value: 'current_month' | 'last_month' | 'custom') => {
    setDateRange(value)
    const now = new Date()

    if (value === 'current_month') {
      setStartDate(format(startOfMonth(now), 'yyyy-MM-dd'))
      setEndDate(format(endOfMonth(now), 'yyyy-MM-dd'))
    } else if (value === 'last_month') {
      const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      setStartDate(format(startOfMonth(lastMonth), 'yyyy-MM-dd'))
      setEndDate(format(endOfMonth(lastMonth), 'yyyy-MM-dd'))
    }
  }

  const scopePrefix = () => {
    if (effectiveScope === 'family') return '全家'
    const h = holders.find((item) => item.id === effectiveHolderId)
    return h ? sanitizeFilenameSegment(h.name) : '个人'
  }

  const handleExportData = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await exportFamilyCsvRows({
        type: exportType,
        scope: effectiveScope,
        holder_id: effectiveHolderId,
        card_id: selectedCardId || undefined,
        start_date: startDate,
        end_date: endDate,
        display_currency: displayCurrency,
      })

      if (!res || res.rows.length === 0) {
        setError('所选时间段内无数据')
        setLoading(false)
        return
      }

      const headers = res.headers.length > 0 ? res.headers : Object.keys(res.rows[0])
      const csvContent = buildSafeCsv(headers, res.rows)
      const fallbackName = `worldcredit-${scopePrefix()}${TYPE_LABELS[exportType]}-${startDate}_${endDate}.csv`
      downloadCsv(res.filename || fallbackName, csvContent)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setLoading(false)
    }
  }

  const handleExportStatementCsv = async (statementMode: 'monthly' | 'annual') => {
    setLoading(true)
    setError('')
    const period = statementMode === 'monthly' ? reportPeriod : reportYear
    try {
      const report = await getStatementReport({
        mode: statementMode,
        period,
        scope: effectiveScope,
        holder_id: effectiveHolderId,
        card_id: selectedCardId || undefined,
        display_currency: displayCurrency,
      })

      if (
        report.currency_summary.length === 0 &&
        report.card_rows.length === 0 &&
        (!report.payable_summary || report.payable_summary.length === 0)
      ) {
        setError('所选范围暂无数据')
        setLoading(false)
        return
      }

      const csvContent = statementReportToCsv(report)
      const label = statementMode === 'monthly' ? '月度对账单' : '年度对账单'
      const filename = `worldcredit-${scopePrefix()}${label}-${period}.csv`
      downloadCsv(filename, csvContent)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setLoading(false)
    }
  }

  const handleOpenPrintableStatement = () => {
    const statementMode = mode === 'annual_report' ? 'annual' : 'monthly'
    const period = statementMode === 'monthly' ? reportPeriod : reportYear
    const params = new URLSearchParams({
      mode: statementMode,
      period,
      scope: effectiveScope,
      currency: displayCurrency,
    })
    if (effectiveHolderId) params.set('holderId', effectiveHolderId)
    if (selectedCardId) params.set('cardId', selectedCardId)
    onClose()
    router.push(`/analytics/statement?${params.toString()}`)
  }

  const handleExport = () => {
    if (mode === 'data') {
      void handleExportData()
    } else if (mode === 'monthly_report') {
      void handleExportStatementCsv('monthly')
    } else {
      void handleExportStatementCsv('annual')
    }
  }

  const holderSelectOptions = [
    ...(isAdmin ? [{ value: 'family', label: '全部家庭成员（全家庭合并）' }] : []),
    ...holders.map((h) => ({ value: h.id, label: h.name })),
  ]

  const filteredCards = cards.filter((c) => {
    if (effectiveScope === 'family') return true
    if (!effectiveHolderId) return false
    return c.card.holder_id === effectiveHolderId
  })

  return (
    <Modal
      open={open}
      onClose={onClose}
      dismissible={!loading}
      maxWidth='md'
      title='导出数据与对账单'
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={loading}>
            取消
          </Button>
          {mode !== 'data' && (
            <Button
              variant='secondary'
              onClick={handleOpenPrintableStatement}
              disabled={loading}
            >
              生成可打印对账单
            </Button>
          )}
          <Button onClick={handleExport} loading={loading}>
            {loading ? (
              '导出中...'
            ) : (
              <>
                <DownloadIcon size={16} /> 导出 CSV
              </>
            )}
          </Button>
        </>
      }
    >
      {error && (
        <div className='mb-4'>
          <Alert severity='error'>{error}</Alert>
        </div>
      )}

      <div className='flex flex-col gap-4'>
        <SelectField
          label='导出模式'
          value={mode}
          onChange={(e) => setMode(e.target.value as ExportMode)}
          options={[
            { value: 'data', label: '明细数据 (CSV)' },
            { value: 'monthly_report', label: '合并月度对账单 (CSV / 打印)' },
            { value: 'annual_report', label: '合并年度对账单 (CSV / 打印)' },
          ]}
        />

        {(isAdmin || holders.length > 1) && (
          <SelectField
            label='导出范围 / 持卡人'
            value={selectedScope}
            onChange={(e) => {
              setSelectedScope(e.target.value)
              setSelectedCardId('')
            }}
            options={holderSelectOptions}
          />
        )}

        <SelectField
          label='卡片筛选 (可选)'
          value={selectedCardId}
          onChange={(e) => setSelectedCardId(e.target.value)}
          options={[
            { value: '', label: '全部卡片' },
            ...filteredCards.map((c) => ({ value: c.id, label: c.label })),
          ]}
        />

        {mode === 'data' && (
          <>
            <SelectField
              label='数据类型'
              value={exportType}
              onChange={(e) => setExportType(e.target.value as FamilyExportType)}
              options={[
                { value: 'bills', label: '账单（含原币种与持卡人）' },
                { value: 'payments', label: '还款（含实际锁定汇率）' },
                { value: 'bill_items', label: '交易明细 (bill_items)' },
                { value: 'installments', label: '分期计划 (installments)' },
                { value: 'benefit_usages', label: '权益使用' },
                { value: 'promo_usages', label: '优惠使用' },
                { value: 'opportunity_usages', label: '机会台账使用' },
              ]}
            />

            <SelectField
              label='时间范围'
              value={dateRange}
              onChange={(e) =>
                handleDateRangeChange(e.target.value as 'current_month' | 'last_month' | 'custom')
              }
              options={[
                { value: 'current_month', label: '本月' },
                { value: 'last_month', label: '上月' },
                { value: 'custom', label: '自定义' },
              ]}
            />

            {dateRange === 'custom' && (
              <div className='flex gap-3'>
                <div className='min-w-0 flex-1'>
                  <TextField
                    label='开始日期'
                    type='date'
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                </div>
                <div className='min-w-0 flex-1'>
                  <TextField
                    label='结束日期'
                    type='date'
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            )}

            <Alert severity='info'>
              将导出「{scopePrefix()}」的 {TYPE_LABELS[exportType]} CSV（UTF-8 BOM + 公式安全转义）
            </Alert>
          </>
        )}

        {mode === 'monthly_report' && (
          <>
            <TextField
              label='报表月份'
              type='month'
              value={reportPeriod}
              onChange={(e) => setReportPeriod(e.target.value)}
            />
            <Alert severity='info'>
              将按原币种分列并折算导出 {reportPeriod} 月度对账单，或点击「生成可打印对账单」排版打印/存为 PDF
            </Alert>
          </>
        )}

        {mode === 'annual_report' && (
          <>
            <TextField
              label='报表年份'
              type='number'
              value={reportYear}
              onChange={(e) => setReportYear(e.target.value)}
              min={2020}
              max={2035}
            />
            <Alert severity='info'>
              将按原币种分列汇总 {reportYear} 年度对账单（含 12 个月度对照与分类汇总）
            </Alert>
          </>
        )}
      </div>
    </Modal>
  )
}
