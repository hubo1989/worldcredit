// components/mobile/ExportDialog.tsx
'use client'

import { useEffect, useState } from 'react'
import { Modal } from '@/components/obsidian/overlays'
import { Button } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { Alert } from '@/components/obsidian/feedback'
import { DownloadIcon } from '@/components/icons/WcIcon'
import { format, startOfMonth, endOfMonth } from 'date-fns'
import {
  getExportData,
  buildCsv,
  downloadCsv,
  generateFilename,
  generateMonthlyReport,
  generateAnnualReport,
  type ExportType,
  type ExportFilters,
} from '@/lib/export'
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
}

type ExportMode = 'data' | 'monthly_report' | 'annual_report'

export function ExportDialog({ open, onClose, holderId, holders, cards }: Props) {
  const [mode, setMode] = useState<ExportMode>('data')
  const [exportType, setExportType] = useState<ExportType>('bills')
  const [selectedHolderId, setSelectedHolderId] = useState(holderId)
  const [selectedCardId, setSelectedCardId] = useState<string>('')
  const [dateRange, setDateRange] = useState<'current_month' | 'last_month' | 'custom'>('current_month')
  const [startDate, setStartDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [endDate, setEndDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [reportPeriod, setReportPeriod] = useState(format(new Date(), 'yyyy-MM'))
  const [reportYear, setReportYear] = useState(format(new Date(), 'yyyy'))

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open) {
      setSelectedHolderId(holderId)
      setSelectedCardId('')
      setError('')
    }
  }, [open, holderId])

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

  const handleExportData = async () => {
    setLoading(true)
    setError('')

    try {
      const filters: ExportFilters = {
        holderId: selectedHolderId,
        cardId: selectedCardId || undefined,
        startDate,
        endDate,
      }

      const data = await getExportData(exportType, filters)

      if (data.length === 0) {
        setError('所选时间段内无数据')
        setLoading(false)
        return
      }

      const headers = Object.keys(data[0])
      const csvContent = buildCsv(headers, data)
      const filename = generateFilename(exportType, startDate, endDate)

      downloadCsv(filename, csvContent)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setLoading(false)
    }
  }

  const handleExportMonthlyReport = async () => {
    setLoading(true)
    setError('')

    try {
      const report = await generateMonthlyReport(selectedHolderId, reportPeriod)

      // Convert report to CSV
      const csvData = [
        {
          '指标': '账单月份',
          '值': report.month,
        },
        {
          '指标': '统计周期',
          '值': `${report.period_start} 至 ${report.period_end}`,
        },
        {
          '指标': '账单总额',
          '值': `¥${report.total_billed.toFixed(2)}`,
        },
        {
          '指标': '已还金额',
          '值': `¥${report.total_paid.toFixed(2)}`,
        },
        {
          '指标': '待还金额',
          '值': `¥${report.outstanding.toFixed(2)}`,
        },
        {
          '指标': '逾期账单数',
          '值': report.overdue_count.toString(),
        },
      ]

      const csvContent = buildCsv(['指标', '值'], csvData)
      const filename = `worldcredit-月报-${reportPeriod}.csv`

      downloadCsv(filename, csvContent)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setLoading(false)
    }
  }

  const handleExportAnnualReport = async () => {
    setLoading(true)
    setError('')

    try {
      const report = await generateAnnualReport(selectedHolderId, reportYear)

      // Convert report to CSV with monthly breakdown
      const csvData = [
        {
          '指标': '年份',
          '值': report.year,
        },
        {
          '指标': '全年账单总额',
          '值': `¥${report.total_billed.toFixed(2)}`,
        },
        {
          '指标': '全年还款总额',
          '值': `¥${report.total_paid.toFixed(2)}`,
        },
        {
          '指标': '待还金额',
          '值': `¥${report.outstanding.toFixed(2)}`,
        },
        {
          '指标': '逾期次数',
          '值': report.overdue_count.toString(),
        },
        {
          '指标': '最高消费月份',
          '值': report.highest_spending_month,
        },
        {
          '指标': '最高消费金额',
          '值': `¥${report.highest_spending_amount.toFixed(2)}`,
        },
        {}, // Empty row separator
        ...report.monthly_breakdown.flatMap(m => [
          { '指标': `${m.month} 账单总额`, '值': `¥${m.total_billed.toFixed(2)}` },
          { '指标': `${m.month} 已还金额`, '值': `¥${m.total_paid.toFixed(2)}` },
          { '指标': `${m.month} 待还金额`, '值': `¥${m.outstanding.toFixed(2)}` },
          {}, // Empty row separator
        ]),
      ]

      const csvContent = buildCsv(['指标', '值'], csvData)
      const filename = `worldcredit-年报-${reportYear}.csv`

      downloadCsv(filename, csvContent)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败')
    } finally {
      setLoading(false)
    }
  }

  const handleExport = () => {
    if (mode === 'data') {
      handleExportData()
    } else if (mode === 'monthly_report') {
      handleExportMonthlyReport()
    } else if (mode === 'annual_report') {
      handleExportAnnualReport()
    }
  }

  const getExportTypeLabel = (type: ExportType): string => {
    const labels: Record<ExportType, string> = {
      bills: '账单',
      payments: '还款',
      benefit_usages: '权益使用',
      promo_usages: '优惠使用',
      opportunity_usages: '机会台账使用',
    }
    return labels[type]
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      maxWidth='md'
      title='导出数据'
      footer={
        <>
          <Button variant='ghost' onClick={onClose} disabled={loading}>取消</Button>
          <Button onClick={handleExport} loading={loading}>
            {loading ? '导出中...' : <><DownloadIcon size={16} /> 导出</>}
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
        {/* Export Mode */}
        <SelectField
          label='导出类型'
          value={mode}
          onChange={e => setMode(e.target.value as ExportMode)}
          options={[
            { value: 'data', label: '明细数据 (CSV)' },
            { value: 'monthly_report', label: '月报摘要' },
            { value: 'annual_report', label: '年报摘要' },
          ]}
        />

        {/* Holder Selection */}
        {holders.length > 1 && (
          <SelectField
            label='持卡人'
            value={selectedHolderId}
            onChange={e => setSelectedHolderId(e.target.value)}
            options={holders.map(h => ({ value: h.id, label: h.name }))}
          />
        )}

        {/* Card Filter */}
        <SelectField
          label='卡片筛选 (可选)'
          value={selectedCardId}
          onChange={e => setSelectedCardId(e.target.value)}
          options={[
            { value: '', label: '全部卡片' },
            ...cards
              .filter(c => {
                if (!selectedHolderId) return false
                return c.card.holder_id === selectedHolderId
              })
              .map(c => ({ value: c.id, label: c.label })),
          ]}
        />

        {/* Data Export Options */}
        {mode === 'data' && (
          <>
            <SelectField
              label='数据类型'
              value={exportType}
              onChange={e => setExportType(e.target.value as ExportType)}
              options={[
                { value: 'bills', label: '账单' },
                { value: 'payments', label: '还款' },
                { value: 'benefit_usages', label: '权益使用' },
                { value: 'promo_usages', label: '优惠使用' },
              ]}
            />

            <SelectField
              label='时间范围'
              value={dateRange}
              onChange={e => handleDateRangeChange(e.target.value as 'current_month' | 'last_month' | 'custom')}
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
                    onChange={e => setStartDate(e.target.value)}
                  />
                </div>
                <div className='min-w-0 flex-1'>
                  <TextField
                    label='结束日期'
                    type='date'
                    value={endDate}
                    onChange={e => setEndDate(e.target.value)}
                  />
                </div>
              </div>
            )}

            <Alert severity='info'>
              将导出 {getExportTypeLabel(exportType)} 数据为 CSV 文件
            </Alert>
          </>
        )}

        {/* Monthly Report Options */}
        {mode === 'monthly_report' && (
          <>
            <TextField
              label='报表月份'
              type='month'
              value={reportPeriod}
              onChange={e => setReportPeriod(e.target.value)}
            />

            <Alert severity='info'>
              将导出 {reportPeriod} 月度摘要报告
            </Alert>
          </>
        )}

        {/* Annual Report Options */}
        {mode === 'annual_report' && (
          <>
            <TextField
              label='报表年份'
              type='number'
              value={reportYear}
              onChange={e => setReportYear(e.target.value)}
              min={2020}
              max={2030}
            />

            <Alert severity='info'>
              将导出 {reportYear} 年度摘要报告（含月度分解）
            </Alert>
          </>
        )}
      </div>
    </Modal>
  )
}
