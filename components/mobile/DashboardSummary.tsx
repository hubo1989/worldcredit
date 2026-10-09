// components/mobile/DashboardSummary.tsx
'use client'

import { formatAmount } from '@/lib/utils'

interface BillWithPayments {
  id: string
  bill_amount: number
  status: string
  due_date: string
  card_id: string
  paid_amount?: number
}

interface Props {
  bills: BillWithPayments[]
  currency?: string
}

export function DashboardSummary({ bills, currency = 'CNY' }: Props) {
  const unpaidBills = bills.filter(b => b.status !== 'paid')
  const totalAmount = unpaidBills.reduce((sum, b) => sum + b.bill_amount, 0)
  const totalPaid = unpaidBills.reduce((sum, b) => sum + (b.paid_amount || 0), 0)
  const paidPercent = totalAmount > 0 ? (totalPaid / totalAmount) * 100 : 0
  const overdueCount = bills.filter(b => b.status === 'overdue').length

  return (
    // 大卡：18px 圆角 + 分层阴影，无边框（暗色视觉语言）
    <div className='mb-3 rounded-2xl bg-gradient-to-br from-[#3b6fe0] to-[#1d3f8f] p-3.5 text-white shadow-lg'>
      <p className='text-[14px] leading-[18px] opacity-80'>本月待还总额</p>
      <p className='num-tabular mt-0.5 text-[22px] font-semibold leading-7'>
        {formatAmount(totalAmount - totalPaid, currency)}
      </p>

      <div className='mt-3'>
        <div className='mb-1 flex justify-between text-[14px] leading-[18px] opacity-80'>
          <span>还款进度 {paidPercent.toFixed(0)}%</span>
          <span>
            {formatAmount(totalPaid, currency)} / {formatAmount(totalAmount, currency)}
          </span>
        </div>
        {/* 渐变卡面上的进度条：白色填充 + 半透明白轨道 */}
        <div className='h-2 w-full overflow-hidden rounded-full bg-white/20'>
          <div
            className='h-full rounded-full bg-white transition-[width] duration-300'
            style={{ width: `${Math.min(paidPercent, 100)}%` }}
          />
        </div>
      </div>

      {overdueCount > 0 && (
        // 语义逾期警示：红色半透明底
        <div className='mt-2 rounded-xl bg-red-500/30 p-1.5 text-center'>
          <p className='text-[14px] font-semibold leading-[18px]'>⚠️ {overdueCount} 笔账单已逾期</p>
        </div>
      )}
    </div>
  )
}
