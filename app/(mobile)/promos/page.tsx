'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'
import { ConfirmDialog, Toast } from '@/components/obsidian/overlays'
import {
  PromoIcon, PlusIcon, ClockIcon, CardIcon,
} from '@/components/icons/WcIcon'
import { getPromosWithBanks, createUserPromo } from '@/lib/api/promos'
import type { Promo } from '@/lib/types'

// P0（WC-BEN-12 spec）：不再合并硬编码的“热门活动”。列表只展示数据库中
// 服务端初筛后的真实活动；没有真实活动时呈现空态，不用示例数据充数。

export default function PromosPage() {
  const [promos, setPromos] = useState<Promo[]>([])
  const [userBanks, setUserBanks] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

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

  // 加载服务端初筛后的有效活动与用户本人持有的银行
  const loadData = useCallback(async () => {
    try {
      setLoading(true)
      setLoadError(null)
      const { promos: livePromos, userBanks: banks } = await getPromosWithBanks()
      setPromos(livePromos || [])
      setUserBanks(banks)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
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

  // P0：本页不产生任何“关注/报名”状态。按钮只做参与方式说明，
  // 真实的关注状态到 Task 11（setOpportunityFollowed）接入后才反馈成功。
  const handleShowChannel = (promo: Promo) => {
    setToast({
      open: true,
      message: `请通过 ${promo.bank_name}官方渠道（手机银行 App / 微信公众号）参与「${promo.title}」，具体规则以银行页面为准。`,
      severity: 'info'
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
            当前进行中的银行活动（按持卡情况初筛）
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
          { v: 'all', label: '全部活动' },
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
      ) : loadError ? (
        <div className='rounded-2xl border border-dashed border-d-border bg-d-surface p-8 text-center'>
          <PromoIcon size={48} className='mx-auto mb-4 text-d-muted' />
          <p className='text-[13px] font-semibold leading-5 text-d-text'>活动加载失败</p>
          <p className='mb-4 mt-1 block break-all text-[12px] leading-4 text-d-muted'>{loadError}</p>
          <button
            type='button'
            onClick={loadData}
            className='mx-auto flex h-10 items-center rounded-full border border-d-accent px-4 text-[12px] font-semibold text-d-accent-light'
          >
            重新加载
          </button>
        </div>
      ) : filteredPromos.length === 0 ? (
        <div className='rounded-2xl border border-dashed border-d-border bg-d-surface p-8 text-center'>
          <PromoIcon size={48} className='mx-auto mb-4 text-d-muted' />
          <p className='text-[13px] font-semibold leading-5 text-d-text'>该分类下暂无进行中的活动</p>
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
          {filteredPromos.map(p => (
            <div
              key={p.id}
              className='rounded-2xl border border-d-border bg-d-surface'
            >
              <div className='p-4'>
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
                        onClick={() => handleShowChannel(p)}
                        className='h-9 shrink-0 whitespace-nowrap rounded-full border border-d-accent px-3.5 text-[12px] font-bold text-d-accent-light'
                      >
                        查看参与方式
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
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
        autoHideMs={3500}
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
