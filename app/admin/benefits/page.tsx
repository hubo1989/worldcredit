'use client'

import { useState, useEffect } from 'react'
import { Button, Toggle } from '@/components/obsidian/controls'
import { TextField, TextArea, SelectField } from '@/components/obsidian/fields'
import { Modal } from '@/components/obsidian/overlays'
import { Spinner } from '@/components/obsidian/feedback'
import { AdminPagination } from '@/components/admin/AdminShell'
import { PlusIcon, SearchIcon, NoteIcon, TrashIcon, SyncIcon } from '@/components/icons/WcIcon'
import { getAdminBenefits, createBenefit, updateBenefit, deleteBenefit, getAdminCardProducts } from '@/lib/api/admin'
import { Benefit, CardProduct } from '@/lib/types'

/** 权益列表行： benefits 字段 + 关联卡产品联查字段 */
type AdminBenefitRow = Benefit & {
  is_active: boolean
  // The admin RPC returns flat joined columns (product_bank_name/product_card_name),
  // not a nested card_products object.
  product_bank_name?: string
  product_card_name?: string
}

export default function BenefitsPage() {
  const [loading, setLoading] = useState(true)
  const [benefits, setBenefits] = useState<AdminBenefitRow[]>([])
  const [cardProducts, setCardProducts] = useState<CardProduct[]>([])
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentBenefit, setCurrentBenefit] = useState<Partial<AdminBenefitRow> | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [bData, cpData] = await Promise.all([
        getAdminBenefits(),
        getAdminCardProducts()
      ])
      setBenefits(bData as unknown as AdminBenefitRow[])
      setCardProducts(cpData)
    } catch (error) {
      console.error('Failed to fetch benefits:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    setPage(0)
  }, [search])

  const filteredBenefits = benefits.filter(b =>
    b.name.toLowerCase().includes(search.toLowerCase()) ||
    (b.product_card_name || '').toLowerCase().includes(search.toLowerCase())
  )

  const paginatedBenefits = filteredBenefits.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  const handleOpenDialog = (benefit?: AdminBenefitRow) => {
    if (benefit) {
      setCurrentBenefit(benefit)
    } else {
      setCurrentBenefit({
        name: '',
        quota: 1,
        period: 'yearly',
        is_active: true
      })
    }
    setDialogOpen(true)
  }

  const handleToggleStatus = async (benefit: AdminBenefitRow) => {
    try {
      await updateBenefit(benefit.id, { is_active: !benefit.is_active } as unknown as Partial<Benefit>)
      setBenefits(benefits.map(b => b.id === benefit.id ? { ...b, is_active: !benefit.is_active } : b))
    } catch (error) {
      console.error('Failed to toggle status:', error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个权益配置吗？这将影响所有持有此卡的用户。')) return
    try {
      await deleteBenefit(id)
      setBenefits(benefits.filter(b => b.id !== id))
    } catch (error) {
      console.error('Failed to delete benefit:', error)
    }
  }

  const handleSubmit = async () => {
    if (!currentBenefit?.card_product_id || !currentBenefit?.name) {
      alert('请选择卡产品并填写权益名称')
      return
    }

    setSubmitting(true)
    try {
      if (currentBenefit.id) {
        const { product_bank_name, product_card_name, ...payload } = currentBenefit
        void product_bank_name
        void product_card_name
        const updated = await updateBenefit(currentBenefit.id, payload)
        setBenefits(benefits.map(b => b.id === currentBenefit.id ? { ...b, ...updated } as AdminBenefitRow : b))
      } else {
        const created = await createBenefit(currentBenefit)
        setBenefits([created as unknown as AdminBenefitRow, ...benefits])
      }
      setDialogOpen(false)
      fetchData()
    } catch (error) {
      console.error('Failed to save benefit:', error)
      alert('保存失败')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className='mb-8 flex items-center justify-between gap-4'>
        <div>
          <h1 className='mb-1 text-[26px] font-bold'>卡产品权益管理</h1>
          <p className='text-[13px] text-d-muted'>配置信用卡的各类权益（如接送机、贵宾厅、酒店积分等）及其使用限额</p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <PlusIcon size={16} />
          添加权益
        </Button>
      </div>

      {/* 搜索 */}
      <div className='mb-6 rounded-2xl border border-d-border bg-d-surface p-4'>
        <div className='flex items-center justify-between gap-4'>
          <div className='w-full sm:max-w-sm'>
            <TextField
              placeholder="搜索权益名称或所属卡片..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              startAdornment={<SearchIcon size={18} />}
            />
          </div>
          <button
            type='button'
            aria-label="刷新"
            onClick={fetchData}
            className='shrink-0 rounded-xl p-2 text-d-muted hover:bg-d-subtle'
          >
            <SyncIcon size={18} />
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className='overflow-hidden rounded-2xl border border-d-border bg-d-surface'>
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[650px] border-collapse text-[13px]'>
            <thead className='bg-d-subtle/50'>
              <tr className='[&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-semibold [&>th]:text-d-muted'>
                <th>所属卡产品</th>
                <th>权益名称</th>
                <th>配额/频率</th>
                <th>重置规则</th>
                <th>状态</th>
                <th className='text-right'>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={6} className='px-3 py-10 text-center'>
                    <Spinner size={24} />
                  </td>
                </tr>
              ) : filteredBenefits.length === 0 ? (
                <tr>
                  <td colSpan={6} className='px-3 py-10 text-center text-d-muted'>当前暂无权益数据</td>
                </tr>
              ) : (
                paginatedBenefits.map((benefit) => (
                  <tr key={benefit.id} className='border-t border-d-border/60 transition-colors hover:bg-d-subtle/40'>
                    <td className='px-3 py-2 font-medium'>
                      {benefit.product_bank_name} - {benefit.product_card_name}
                    </td>
                    <td className='px-3 py-2'>{benefit.name}</td>
                    <td className='px-3 py-2'>
                      <span className='rounded-md bg-d-accent/10 px-2 py-1 text-[11px] text-d-accent-light'>
                        {benefit.quota} 次 / {benefit.period === 'yearly' ? '年' : benefit.period === 'monthly' ? '月' : '终身'}
                      </span>
                    </td>
                    <td className='px-3 py-2 text-d-muted'>
                      {benefit.period === 'yearly' ? `${benefit.reset_month || 1} 月重置` : benefit.period === 'monthly' ? '每月末重置' : '不重置'}
                    </td>
                    <td className='px-3 py-2'>
                      <Toggle
                        checked={benefit.is_active}
                        onChange={() => handleToggleStatus(benefit)}
                        ariaLabel={`启用 ${benefit.name}`}
                      />
                    </td>
                    <td className='px-3 py-2 text-right'>
                      <button
                        type='button'
                        aria-label="编辑"
                        onClick={() => handleOpenDialog(benefit)}
                        className='rounded-lg p-1.5 text-d-muted hover:bg-d-subtle hover:text-d-text'
                      >
                        <NoteIcon size={16} />
                      </button>
                      <button
                        type='button'
                        aria-label="删除"
                        onClick={() => handleDelete(benefit.id)}
                        className='ml-1 rounded-lg p-1.5 text-d-danger-ink hover:bg-d-danger-soft'
                      >
                        <TrashIcon size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <AdminPagination
          count={filteredBenefits.length}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={setPage}
          onRowsPerPageChange={(n) => { setRowsPerPage(n); setPage(0) }}
        />
      </div>

      {/* 对话框 */}
      <Modal
        open={dialogOpen}
        onClose={() => !submitting && setDialogOpen(false)}
        maxWidth='md'
        title={currentBenefit?.id ? '编辑权益配置' : '添加新权益'}
        footer={
          <>
            <Button variant='ghost' onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit} loading={submitting}>确认添加</Button>
          </>
        }
      >
        <div className='flex flex-col gap-4'>
          <SelectField
            label="所属卡产品"
            required
            placeholder="选择卡产品"
            value={currentBenefit?.card_product_id || ''}
            onChange={(e) => setCurrentBenefit({ ...currentBenefit, card_product_id: e.target.value })}
            options={cardProducts.map(cp => ({
              value: cp.id,
              label: `${cp.bank_name} - ${cp.card_name}`,
            }))}
          />
          <TextField
            label="权益名称"
            placeholder="例如：机场贵宾厅服务"
            required
            value={currentBenefit?.name || ''}
            onChange={(e) => setCurrentBenefit({ ...currentBenefit, name: e.target.value })}
          />
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <TextField
              label="权益配额 (次)"
              type="number"
              value={currentBenefit?.quota || 1}
              onChange={(e) => setCurrentBenefit({ ...currentBenefit, quota: Number(e.target.value) })}
            />
            <SelectField
              label="重置周期"
              value={currentBenefit?.period || 'yearly'}
              onChange={(e) => setCurrentBenefit({ ...currentBenefit, period: e.target.value as Benefit['period'] })}
              options={[
                { value: 'yearly', label: '按年重置' },
                { value: 'monthly', label: '按月重置' },
                { value: 'one_time', label: '终身一次性' },
              ]}
            />
          </div>
          {currentBenefit?.period === 'yearly' && (
            <TextField
              label="重置月份 (1-12)"
              type="number"
              value={currentBenefit?.reset_month || 1}
              onChange={(e) => setCurrentBenefit({ ...currentBenefit, reset_month: Number(e.target.value) })}
            />
          )}
          <TextField
            label="到期日期 (可选)"
            type="date"
            value={currentBenefit?.expiry_date || ''}
            onChange={(e) => setCurrentBenefit({ ...currentBenefit, expiry_date: e.target.value })}
          />
          <TextArea
            label="权益说明"
            rows={3}
            value={currentBenefit?.description || ''}
            onChange={(e) => setCurrentBenefit({ ...currentBenefit, description: e.target.value })}
          />
        </div>
      </Modal>
    </div>
  )
}
