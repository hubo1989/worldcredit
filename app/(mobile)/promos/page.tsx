'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { ConfirmDialog, Toast } from '@/components/obsidian/overlays'
import {
  PromoIcon, PlusIcon, ClockIcon, CardIcon,
} from '@/components/icons/WcIcon'
import { getPromosWithBanks, createUserPromo } from '@/lib/api/promos'
import type { Promo } from '@/lib/types'

// 热门活动初始数据源 (若云端数据库活动较少时自动合并展现)
const POPULAR_PROMOS: Array<Omit<Promo, 'id' | 'created_at' | 'updated_at'>> = [
  {
    bank_name: '招商银行',
    title: '掌上生活 · 周三 5 折美食日',
    discount_type: '5折立减',
    description: '每周三上午 10:00 掌上生活 App 抢购大牌餐饮 5 折代金券（海底捞、西贝、星巴克等）。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'food', quota: '每周 1 次', channel: '掌上生活 App' }
  },
  {
    bank_name: '工商银行',
    title: '爱购周末 · 超市满 50 减 10 元',
    discount_type: '满50减10',
    description: '每周六、周日在指定商超（永辉、大润发、盒马）使用工行信用卡微信/银联支付立减 10 元。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'shopping', quota: '每日限 1 次', channel: '微信支付/云闪付' }
  },
  {
    bank_name: '建设银行',
    title: '龙卡加油惠 · 中石化中石油立减 20',
    discount_type: '加油返现',
    description: '建行龙卡信用卡持卡人通过建行手机银行或中石化钱包加油充值满 200 减 20 元。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'gas', quota: '每月 2 次', channel: '建行手机银行 App' }
  },
  {
    bank_name: '广发银行',
    title: '发现精彩 · 超级发发发买一送一',
    discount_type: '买一送一',
    description: '喜茶、奈雪、瑞幸等指定咖啡茶饮品牌使用广发信用卡买一送一，周五专属。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'drink', quota: '每周五限 1 次', channel: '发现精彩 App' }
  },
  {
    bank_name: '交通银行',
    title: '最红星期五 · 餐饮商超 5% 秒减',
    discount_type: '5%返现',
    description: '每周五在全国指定超市、加油站、外卖平台消费享 5% 秒减立减金。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'food', quota: '每月最高返 100 元', channel: '买单吧 App' }
  },
  {
    bank_name: '中信银行',
    title: '9 积分精彩兑 · 星巴克/电影票',
    discount_type: '积分兑换',
    description: '当月消费满 3 笔 399 元即可获得 1 个 9 分权益，可兑换大杯星巴克或淘票票电影代金券。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'entertainment', quota: '每月限兑 2 次', channel: '动卡空间 App' }
  },
  {
    bank_name: '浦发银行',
    title: '境外消费享最高 10% 返现',
    discount_type: '境外返现',
    description: '报名后使用浦发万事达/Visa 信用卡在境外线上及线下消费，笔笔返现高达 10%。',
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    rules: { category: 'travel', quota: '活动期间最高 1000 元', channel: '浦大喜奔 App' }
  }
]

export default function PromosPage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [userBanks, setUserBanks] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  // 筛选状态
  const [categoryTab, setCategoryTab] = useState<string>('all')
  const [selectedBank, setSelectedBank] = useState<string>('all')

  // 新增活动弹窗
  const [addOpen, setAddOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [newBank, setNewBank] = useState('招商银行')
  const [newType, setNewType] = useState('满减')
  const [newDesc, setNewDesc] = useState('')
  const [newEndDate, setNewEndDate] = useState('2026-12-31')

  const [toast, setToast] = useState<{ open: boolean; message: string; severity: 'success' | 'info' | 'error' }>({
    open: false, message: '', severity: 'success'
  })

  // 加载优惠与用户卡包所属银行
  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      
      // 1. 获取 DB 中的优惠列表与用户卡包银行
      const { promos: dbPromos, userBanks: banks } = await getPromosWithBanks()

      // 合并热门精选与 DB 优惠
      const existingTitles = new Set((dbPromos || []).map(p => p.title))
      const combined: Promo[] = [...(dbPromos || [])]
      
      POPULAR_PROMOS.forEach((p, idx) => {
        if (!existingTitles.has(p.title)) {
          combined.push({
            id: `popular-${idx}`,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            ...p,
          } as Promo)
        }
      })
      setPromos(combined)
      setUserBanks(banks)
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  // 分类与银行筛选计算
  const filteredPromos = useMemo(() => {
    return promos.filter(p => {
      // 分类筛选
      if (categoryTab !== 'all') {
        const title = (p.title + ' ' + (p.description || '')).toLowerCase()
        if (categoryTab === 'food' && !(title.includes('餐') || title.includes('美食') || title.includes('吃') || title.includes('5折') || title.includes('外卖'))) return false
        if (categoryTab === 'shopping' && !(title.includes('超市') || title.includes('商超') || title.includes('购物') || title.includes('买'))) return false
        if (categoryTab === 'gas' && !(title.includes('加油') || title.includes('车') || title.includes('出行'))) return false
        if (categoryTab === 'drink' && !(title.includes('咖啡') || title.includes('茶') || title.includes('饮品') || title.includes('星巴克'))) return false
        if (categoryTab === 'travel' && !(title.includes('境外') || title.includes('机票') || title.includes('酒店') || title.includes('商旅') || title.includes('返现'))) return false
      }

      // 银行筛选
      if (selectedBank !== 'all' && selectedBank !== 'my_cards') {
        if (!p.bank_name.includes(selectedBank)) return false
      } else if (selectedBank === 'my_cards') {
        if (!userBanks.some(b => p.bank_name.includes(b))) return false
      }

      return true
    })
  }, [promos, categoryTab, selectedBank, userBanks])

  // 获取所有出现的银行列表
  const allBanks = useMemo(() => {
    const set = new Set<string>()
    promos.forEach(p => {
      if (p.bank_name) set.add(p.bank_name.trim())
    })
    return Array.from(set)
  }, [promos])

  const handleRegister = (promo: Promo) => {
    const channel = promo.rules?.channel || `${promo.bank_name}手机银行 App`
    setToast({
      open: true,
      message: `✨ 已为您记录关注！请在 ${channel} 报名或使用对应银行卡支付享优惠。`,
      severity: 'success'
    })
  }

  const handleAddPromo = async () => {
    if (!newTitle.trim()) {
      setToast({ open: true, message: '请输入活动名称', severity: 'error' })
      return
    }
    setSubmitting(true)
    try {
      await createUserPromo({
        bank_name: newBank,
        title: newTitle.trim(),
        discount_type: newType,
        description: newDesc.trim() || '用户自定义记录的银行优惠活动',
        start_date: new Date().toISOString().split('T')[0],
        end_date: newEndDate,
      })
      
      setAddOpen(false)
      setNewTitle('')
      setNewDesc('')
      setToast({ open: true, message: '优惠活动添加成功！', severity: 'success' })
      loadData()
    } catch (err) {
      setToast({ open: true, message: '添加失败: ' + (err instanceof Error ? err.message : String(err)), severity: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  // WcIcon 暂无分类图标族，先统一用 PromoIcon 表达
  const getPromoIcon = (_title: string, _desc: string = '') => <PromoIcon size={24} />

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-4 text-d-text'>
      {/* 顶部标题栏 */}
      <div className='mb-2.5 flex items-start justify-between gap-2.5'>
        <div className='min-w-0'>
          <p className='text-[20px] font-bold leading-7 text-d-text'>优惠活动</p>
          <p className='mt-0.5 text-[12px] leading-4 text-d-muted'>
            精选各行当期热门活动与信用卡专属羊毛
          </p>
        </div>
        <button
          type='button'
          onClick={() => setAddOpen(true)}
          className='flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-d-accent px-3.5 text-[12px] font-bold text-white'
        >
          <PlusIcon size={14} />
          添加活动
        </button>
      </div>

      {/* 分类筛选 pills */}
      <div className='mb-3 flex gap-2 overflow-x-auto pb-1'>
        {[
          { v: 'all', label: '全部精选' },
          { v: 'food', label: '餐饮美食' },
          { v: 'shopping', label: '超市便利' },
          { v: 'gas', label: '加油车主' },
          { v: 'drink', label: '咖啡茶饮' },
          { v: 'travel', label: '商旅海淘' },
        ].map(t => {
          const active = categoryTab === t.v
          return (
            <button
              key={t.v}
              type='button'
              onClick={() => setCategoryTab(t.v)}
              className={
                'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-bold transition-colors ' +
                (active
                  ? 'bg-d-accent text-white'
                  : 'border border-d-border bg-d-surface text-d-muted')
              }
            >
              {t.label}
            </button>
          )
        })}
      </div>

      {/* 银行快速筛选 pills */}
      <div className='mb-3 flex gap-2 overflow-x-auto pb-1'>
        <button
          type='button'
          onClick={() => setSelectedBank('all')}
          className={
            'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-semibold ' +
            (selectedBank === 'all'
              ? 'bg-d-accent text-white'
              : 'border border-d-border bg-d-surface text-d-muted')
          }
        >
          全部银行
        </button>
        {userBanks.length > 0 && (
          <button
            type='button'
            onClick={() => setSelectedBank('my_cards')}
            className={
              'flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-semibold ' +
              (selectedBank === 'my_cards'
                ? 'bg-d-accent text-white'
                : 'border border-d-border bg-d-surface text-d-muted')
            }
          >
            <CardIcon size={14} />
            我持有的银行 ({userBanks.length})
          </button>
        )}
        {allBanks.map(b => (
          <button
            key={b}
            type='button'
            onClick={() => setSelectedBank(b)}
            className={
              'shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-semibold ' +
              (selectedBank === b
                ? 'bg-d-accent text-white'
                : 'border border-d-border bg-d-surface text-d-muted')
            }
          >
            {b}
          </button>
        ))}
      </div>

      {/* 列表渲染 */}
      {loading ? (
        <div className='flex flex-col gap-3'>
          {[1, 2, 3].map(i => (
            <div key={i} className='wc-skeleton h-[140px] w-full rounded-2xl' />
          ))}
        </div>
      ) : filteredPromos.length === 0 ? (
        <div className='rounded-2xl border border-dashed border-d-border bg-d-surface p-8 text-center'>
          <PromoIcon size={48} className='mx-auto mb-4 text-d-muted' />
          <p className='text-[13px] font-semibold leading-5 text-d-text'>该分类下暂无活动</p>
          <p className='mb-4 mt-1 block text-[12px] leading-4 text-d-muted'>
            您可以切换银行分类或手动添加您关注的信用卡优惠
          </p>
          <button
            type='button'
            onClick={() => { setCategoryTab('all'); setSelectedBank('all') }}
            className='mx-auto flex h-10 items-center rounded-full border border-d-accent px-4 text-[12px] font-semibold text-d-accent-light'
          >
            查看全部活动
          </button>
        </div>
      ) : (
        <div className='flex flex-col gap-3'>
          {filteredPromos.map(p => {
            const hasCard = userBanks.some(b => p.bank_name.includes(b))

            return (
              <div
                key={p.id}
                className={
                  'relative overflow-hidden rounded-2xl bg-d-surface transition-transform ' +
                  (hasCard ? 'border border-d-accent' : 'border border-d-border')
                }
              >
                {/* 我已持卡可享 顶部角标 */}
                {hasCard && (
                  <span className='absolute right-0 top-0 rounded-bl-xl bg-d-accent px-2 py-0.5 text-[11px] font-semibold leading-5 text-white'>
                    💳 我已持卡可享
                  </span>
                )}

                <div className={'p-4' + (hasCard ? ' pt-9' : '')}>
                  <div className='flex gap-3'>
                    <div className='flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-xl bg-d-subtle text-d-accent-light'>
                      {getPromoIcon(p.title, p.description || '')}
                    </div>

                    <div className='min-w-0 flex-1'>
                      <div className='mb-0.5 flex items-center justify-between gap-2'>
                        <p className='min-w-0 truncate text-[13px] font-semibold leading-4 text-d-accent-light'>
                          {p.bank_name}
                        </p>
                        <span className='shrink-0 rounded-md bg-d-danger-soft px-1.5 py-0.5 text-[11px] font-semibold leading-4 text-d-danger-ink'>
                          {p.discount_type || '优惠'}
                        </span>
                      </div>

                      <p className='mb-1.5 text-[15px] font-semibold leading-5 text-d-text'>{p.title}</p>

                      {p.description && (
                        <p className='mb-1.5 line-clamp-2 text-[12px] leading-4 text-d-muted'>
                          {p.description}
                        </p>
                      )}

                      {/* 截止日期与操作按钮都是不可拆语义单元：够宽并排，装不下按钮整颗换行 */}
                      <div className='flex flex-wrap items-center justify-between gap-2 border-t border-dashed border-d-border pt-2'>
                        <p className='flex items-center gap-1 whitespace-nowrap text-[12px] leading-4 text-d-muted'>
                          <ClockIcon size={13} />
                          截止至 {p.end_date || '长期有效'}
                        </p>
                        <button
                          type='button'
                          onClick={() => handleRegister(p)}
                          className={
                            'h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-[12px] font-bold ' +
                            (hasCard
                              ? 'bg-d-accent text-white'
                              : 'border border-d-accent text-d-accent-light')
                          }
                        >
                          {hasCard ? '一键享用' : '关注活动'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={addOpen}
        title='添加信用卡优惠活动'
        onClose={submitting ? () => {} : () => setAddOpen(false)}
        actions={
          <>
            <button
              type='button'
              onClick={() => setAddOpen(false)}
              disabled={submitting}
              className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
            >
              取消
            </button>
            <button
              type='button'
              onClick={handleAddPromo}
              disabled={submitting}
              className='h-10 rounded-full bg-d-accent px-5 text-sm font-bold text-white disabled:opacity-50'
            >
              {submitting ? '保存中...' : '确认添加'}
            </button>
          </>
        }
      >
        <div className='flex max-h-[60vh] flex-col gap-3 overflow-y-auto'>
          <Field label='发卡银行 *' value={newBank} onChange={setNewBank} placeholder='例如 招商银行 / 工商银行' />
          <Field label='活动名称 *' value={newTitle} onChange={setNewTitle} placeholder='例如 周三 5 折美食日' />
          <Field label='优惠标签' value={newType} onChange={setNewType} placeholder='例如 5折立减 / 满50减10 / 积分兑换' />
          <Field label='活动截止日期' type='date' value={newEndDate} onChange={setNewEndDate} />
          <Field label='活动说明与规则' value={newDesc} onChange={setNewDesc} placeholder='描述参与方式、达标条件及使用渠道等' multiline />
        </div>
      </ConfirmDialog>

      <Toast
        open={toast.open}
        message={toast.message}
        severity={toast.severity}
        autoHideMs={3000}
        onClose={() => setToast(prev => ({ ...prev, open: false }))}
      />
    </div>
  )
}

const fieldClass = 'h-11 w-full rounded-xl border border-d-border bg-d-bg px-3 text-[16px] text-d-text outline-none placeholder:text-d-muted focus:border-d-accent'

function Field({
  label, value, onChange, placeholder, type = 'text', multiline = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  type?: string
  multiline?: boolean
}) {
  return (
    <label className='block'>
      <span className='mb-1 block text-[12px] font-semibold text-d-muted'>{label}</span>
      {multiline ? (
        <textarea
          value={value}
          rows={3}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none placeholder:text-d-muted focus:border-d-accent'
        />
      ) : (
        <input
          type={type}
          value={value}
          placeholder={placeholder}
          onChange={e => onChange(e.target.value)}
          className={fieldClass}
        />
      )}
    </label>
  )
}
