'use client'

import type { CardProductStat } from '@/lib/api/dashboard'

interface CardProductOverviewProps {
  data: CardProductStat[]
}

const TH_CLS =
  'border-b border-d-border px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-wide text-d-muted'
const TD_CLS = 'border-b border-d-border/60 px-3 py-2.5 text-[13px] text-d-muted'

export function CardProductOverview({ data }: CardProductOverviewProps) {
  return (
    <div className='overflow-hidden rounded-2xl border border-d-border bg-d-surface'>
      <div className='px-6 pb-1 pt-6'>
        <p className='text-[15px] font-semibold'>信用卡产品目录</p>
        <p className='text-[12px] text-d-muted'>共 {data.length} 个在册产品</p>
      </div>

      <div className='overflow-x-auto'>
        <table className='w-full border-collapse'>
          <thead>
            <tr>
              <th className={TH_CLS}>银行</th>
              <th className={TH_CLS}>卡片名称</th>
              <th className={TH_CLS}>币种</th>
              <th className={`${TH_CLS} text-right`}>年费</th>
              <th className={TH_CLS}>年费减免</th>
              <th className={`${TH_CLS} text-right`}>开卡数</th>
            </tr>
          </thead>
          <tbody>
            {data.length === 0 ? (
              <tr>
                <td colSpan={6} className={`${TD_CLS} py-8 text-center text-d-muted`}>
                  暂无卡产品数据
                </td>
              </tr>
            ) : (
              data.map((p) => (
                <tr key={p.id} className='transition-colors hover:bg-d-subtle/50'>
                  <td className={TD_CLS}>
                    <span className='rounded-md bg-d-accent/15 px-2 py-1 text-[12px] font-semibold text-d-accent-light'>
                      {p.bank_name}
                    </span>
                  </td>
                  <td className={`${TD_CLS} font-medium text-d-text`}>{p.card_name}</td>
                  <td className={TD_CLS}>{p.currency}</td>
                  <td className={`${TD_CLS} text-right tabular-nums`}>
                    {p.annual_fee ? `¥${Number(p.annual_fee).toLocaleString()}` : '免年费'}
                  </td>
                  <td className={`${TD_CLS} text-[12px]`}>{p.annual_fee_waiver || '—'}</td>
                  <td className={`${TD_CLS} text-right`}>
                    <span className='text-[14px] font-bold tabular-nums text-d-success-ink'>{p.card_count}</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
