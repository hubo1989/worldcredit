'use client'

import { useState, useEffect } from 'react'
import { Button, Toggle } from '@/components/obsidian/controls'
import { TextField, TextArea, SelectField } from '@/components/obsidian/fields'
import { Modal, Toast } from '@/components/obsidian/overlays'
import { Spinner } from '@/components/obsidian/feedback'
import { AdminPagination, AdminCheckbox } from '@/components/admin/AdminShell'
import { PlusIcon, SearchIcon, NoteIcon, TrashIcon, SyncIcon } from '@/components/icons/WcIcon'
import {
  getAdminCardProducts,
  createCardProduct,
  updateCardProduct,
  deleteCardProduct,
  getAdminBanks
} from '@/lib/api/admin'
import { CardProduct, Bank } from '@/lib/types'
import { COUNTRIES } from '@/lib/constants'
import AiCompleteButton from '@/components/admin/AiCompleteButton'
import { aiComplete } from '@/lib/api/ai'

export default function CardProductsPage() {
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState<(CardProduct & { is_active: boolean })[]>([])
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentProduct, setCurrentProduct] = useState<Partial<CardProduct & { is_active: boolean }> | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [banks, setBanks] = useState<Bank[]>([])
  const [filterBank, setFilterBank] = useState<string>('all')
  const [filterCountry, setFilterCountry] = useState<string>('all')
  // 批量选择：选中的卡产品 id
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  const fetchData = async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const [productsData, banksData] = await Promise.all([
        getAdminCardProducts(),
        getAdminBanks()
      ])
      setProducts(productsData || [])
      setBanks(banksData || [])
    } catch (error) {
      console.error('Failed to fetch data:', error)
      setFetchError(error instanceof Error ? error.message : 'Unknown fetching error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  useEffect(() => {
    setPage(0)
  }, [search, filterBank, filterCountry])

  const filteredProducts = products.filter(p => {
    const matchesSearch = p.bank_name.toLowerCase().includes(search.toLowerCase()) ||
      p.card_name.toLowerCase().includes(search.toLowerCase())
    const matchesBank = filterBank === 'all' || p.bank_id === filterBank || p.bank_name === filterBank
    const matchesCountry = filterCountry === 'all' || p.country === filterCountry
    return matchesSearch && matchesBank && matchesCountry
  })

  const paginatedProducts = filteredProducts.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  const handleOpenDialog = (product?: CardProduct & { is_active: boolean }) => {
    if (product) {
      setCurrentProduct(product)
    } else {
      setCurrentProduct({
        country: 'CN',
        currency: 'CNY',
        payment_due_type: 'after_billing',
        payment_due_value: 20,
        annual_fee: 0,
        is_active: true
      })
    }
    setDialogOpen(true)
  }

  const handleToggleStatus = async (product: CardProduct & { is_active: boolean }) => {
    try {
      await updateCardProduct(product.id, { is_active: !product.is_active })
      setProducts(products.map(p => p.id === product.id ? { ...p, is_active: !product.is_active } : p))
    } catch (error) {
      console.error('Failed to toggle status:', error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个卡产品吗？此操作不可撤销且会影响关联的用户信用卡。')) return
    try {
      await deleteCardProduct(id)
      setProducts(products.filter(p => p.id !== id))
    } catch (error) {
      console.error('Failed to delete product:', error)
    }
  }

  // ── 批量操作 ──────────────────────────────────────────────────────────────
  // 逐条调用既有单条接口而不是新增批量 RPC：单条接口已经带了全部校验与级联语义
  // （例如删除会影响关联用户信用卡），批量版很容易漏掉其中一条变成静默不一致。
  // 顺序执行并在结束时汇总成败，避免「部分成功」被当成全成功。
  const runBatch = async (ids: string[], label: string, fn: (id: string) => Promise<unknown>) => {
    if (ids.length === 0) return
    setSubmitting(true)
    let ok = 0
    const failed: string[] = []
    try {
      for (const id of ids) {
        try {
          await fn(id)
          ok++
        } catch (err) {
          const name = products.find(p => p.id === id)?.card_name || id
          failed.push(`${name}（${err instanceof Error ? err.message : '失败'}）`)
        }
      }
      await fetchData()
      setSelectedIds([])
      if (failed.length === 0) {
        setNotice(`已${label} ${ok} 项`)
      } else {
        setSaveError(`${label}完成 ${ok} 项，${failed.length} 项失败：${failed.slice(0, 3).join('；')}${failed.length > 3 ? ' …' : ''}`)
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleBatchEnable = () => runBatch(selectedIds, '启用', id => updateCardProduct(id, { is_active: true }))
  const handleBatchDisable = () => runBatch(selectedIds, '禁用', id => updateCardProduct(id, { is_active: false }))

  /**
   * 批量 AI 补全：逐条调 aiComplete 再把结果写回。
   *
   * 不盲目覆盖：只写入 AI 返回且当前为空/缺失的字段，已有值保持不动——批量操作
   * 最危险的失败模式就是把人工精心维护过的字段批量冲掉。
   */
  const handleBatchAI = async () => {
    if (selectedIds.length === 0) return
    setSubmitting(true)
    let ok = 0
    const failed: string[] = []
    try {
      for (const id of selectedIds) {
        const product = products.find(p => p.id === id)
        if (!product) continue
        try {
          const result = await aiComplete({
            type: 'card_product',
            data: {
              bank_name: product.bank_name,
              card_name: product.card_name,
              currency: product.currency,
              country: product.country,
            },
          }) as Record<string, unknown>

          const patch: Record<string, unknown> = {}
          const fillable = ['annual_fee', 'annual_fee_waiver', 'rewards_summary', 'description_md', 'apply_url', 'payment_due_type', 'payment_due_value'] as const
          for (const key of fillable) {
            const current = (product as unknown as Record<string, unknown>)[key]
            const next = result?.[key]
            if ((current === null || current === undefined || current === '') && next !== null && next !== undefined) {
              patch[key] = next
            }
          }
          if (Object.keys(patch).length > 0) {
            await updateCardProduct(id, patch as Partial<CardProduct>)
            ok++
          }
        } catch (err) {
          failed.push(`${product.card_name}（${err instanceof Error ? err.message : '失败'}）`)
        }
      }
      await fetchData()
      setSelectedIds([])
      if (failed.length === 0) {
        setNotice(ok > 0 ? `AI 补全完成 ${ok} 项（仅填充空白字段）` : '选中项没有可补全的空白字段')
      } else {
        setSaveError(`AI 补全完成 ${ok} 项，${failed.length} 项失败：${failed.slice(0, 3).join('；')}${failed.length > 3 ? ' …' : ''}`)
      }
    } finally {
      setSubmitting(false)
    }
  }
  const handleBatchDelete = () => {
    if (!confirm(`确定删除选中的 ${selectedIds.length} 个卡产品？此操作不可撤销且会影响关联的用户信用卡。`)) return
    return runBatch(selectedIds, '删除', id => deleteCardProduct(id))
  }

  const handleSubmit = async () => {
    if (!currentProduct?.bank_name || !currentProduct?.card_name) {
      alert('请填写必填项（银行名称、卡片名称）')
      return
    }

    setSubmitting(true)
    try {
      if (currentProduct.id) {
        const updated = await updateCardProduct(currentProduct.id, currentProduct)
        setProducts(products.map(p => p.id === currentProduct.id ? { ...p, ...updated } : p))
      } else {
        const created = await createCardProduct(currentProduct) as unknown as CardProduct & { is_active: boolean }
        setProducts([created, ...products])
      }
      setDialogOpen(false)
    } catch (error) {
      console.error('Failed to save product:', error)
      alert('保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className='mb-8 flex items-center justify-between gap-4'>
        <div>
          <h1 className='mb-1 text-[26px] font-bold'>卡产品管理</h1>
          <p className='text-[13px] text-d-muted'>管理全平台信用卡产品目录、年费政策及账期规则</p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <PlusIcon size={16} />
          新增卡产品
        </Button>
      </div>

      {/* 过滤器 */}
      <div className='mb-6 rounded-2xl border border-d-border bg-d-surface p-4'>
        <div className='grid grid-cols-1 items-center gap-4 md:grid-cols-2 lg:grid-cols-4'>
          <TextField
            placeholder="搜索银行或卡片名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            startAdornment={<SearchIcon size={18} />}
          />
          <SelectField
            label="按银行筛选"
            value={filterBank}
            onChange={(e) => setFilterBank(e.target.value)}
            options={[
              { value: 'all', label: '全部银行' },
              ...banks.map(bank => ({ value: bank.id, label: bank.name })),
            ]}
          />
          <SelectField
            label="按国家筛选"
            value={filterCountry}
            onChange={(e) => setFilterCountry(e.target.value)}
            options={[
              { value: 'all', label: '全部国家' },
              ...COUNTRIES.map(c => ({ value: c.code, label: c.label })),
            ]}
          />
          <div className='flex items-center justify-end gap-3'>
            <p className='text-[13px] text-d-muted'>共 {filteredProducts.length} 项</p>
            <button
              type='button'
              aria-label="刷新"
              onClick={fetchData}
              className='rounded-xl p-2 text-d-muted hover:bg-d-subtle'
            >
              <SyncIcon size={18} />
            </button>
          </div>
        </div>
      </div>

      {/* 数据表格 */}
      <div className='overflow-hidden rounded-2xl border border-d-border bg-d-surface'>
        {/* 批量操作条：只在有选中项时出现，免得平时占位 */}
        {selectedIds.length > 0 && (
          <div className='flex flex-wrap items-center gap-2 border-b border-d-border bg-d-accent/10 px-3 py-2'>
            <span className='mr-1 text-[13px] font-semibold text-d-accent-light'>
              已选 {selectedIds.length} 项
            </span>
            <Button size='sm' variant='secondary' disabled={submitting} onClick={handleBatchAI}>
              AI 补全
            </Button>
            <Button size='sm' variant='secondary' disabled={submitting} onClick={handleBatchEnable}>
              启用
            </Button>
            <Button size='sm' variant='secondary' disabled={submitting} onClick={handleBatchDisable}>
              禁用
            </Button>
            <Button size='sm' variant='danger' disabled={submitting} onClick={handleBatchDelete}>
              删除
            </Button>
            <div className='flex-1' />
            <button
              type='button'
              onClick={() => setSelectedIds([])}
              className='text-[13px] text-d-muted hover:text-d-text'
            >
              取消选择
            </button>
          </div>
        )}
        <div className='overflow-x-auto'>
          <table className='w-full min-w-[650px] border-collapse text-[13px]'>
            <thead className='bg-d-subtle/50'>
              <tr className='[&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-semibold [&>th]:text-d-muted'>
                <th className='w-12'>
                  <AdminCheckbox
                    ariaLabel='全选本页'
                    indeterminate={selectedIds.length > 0 && selectedIds.length < paginatedProducts.length}
                    checked={paginatedProducts.length > 0 && paginatedProducts.every(p => selectedIds.includes(p.id))}
                    onChange={(checked) => {
                      const pageIds = paginatedProducts.map(p => p.id)
                      setSelectedIds(checked
                        ? [...new Set([...selectedIds, ...pageIds])]
                        : selectedIds.filter(id => !pageIds.includes(id)))
                    }}
                  />
                </th>
                <th>银行名称</th>
                <th>卡片名称</th>
                <th>年费</th>
                <th>还款宽限</th>
                <th>状态</th>
                <th className='text-right'>操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className='px-3 py-10 text-center'>
                    <Spinner size={24} />
                  </td>
                </tr>
              ) : filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={7} className='px-3 py-10 text-center text-d-muted'>
                    {fetchError ? `加载失败: ${fetchError}` : '未检索到卡产品数据'}
                  </td>
                </tr>
              ) : (
                paginatedProducts.map((product) => (
                  <tr key={product.id} className='border-t border-d-border/60 transition-colors hover:bg-d-subtle/40'>
                    <td className='px-3 py-2'>
                      <AdminCheckbox
                        ariaLabel={`选择 ${product.card_name}`}
                        checked={selectedIds.includes(product.id)}
                        onChange={(checked) => setSelectedIds(checked
                          ? [...selectedIds, product.id]
                          : selectedIds.filter(id => id !== product.id))}
                      />
                    </td>
                    <td className='px-3 py-2 font-medium'>{product.bank_name}</td>
                    <td className='px-3 py-2'>{product.card_name}</td>
                    <td className='px-3 py-2 tabular-nums'>
                      {product.annual_fee ? `${product.currency} ${product.annual_fee}` : '免费'}
                    </td>
                    <td className='px-3 py-2 text-d-muted'>
                      {product.payment_due_type === 'after_billing' ? `账单日后 ${product.payment_due_value} 天` : `每月固定 ${product.payment_due_value} 日`}
                    </td>
                    <td className='px-3 py-2'>
                      <div className='flex items-center gap-2'>
                        <Toggle
                          checked={product.is_active}
                          onChange={() => handleToggleStatus(product)}
                          ariaLabel={`启用 ${product.card_name}`}
                        />
                        <span
                          className={
                            'rounded-md px-2 py-1 text-[11px] font-semibold ' +
                            (product.is_active
                              ? 'bg-d-success-soft text-d-success-ink'
                              : 'bg-d-danger-soft text-d-danger-ink')
                          }
                        >
                          {product.is_active ? '启用中' : '已禁用'}
                        </span>
                      </div>
                    </td>
                    <td className='px-3 py-2 text-right'>
                      <button
                        type='button'
                        aria-label="编辑"
                        onClick={() => handleOpenDialog(product)}
                        className='rounded-lg p-1.5 text-d-muted hover:bg-d-subtle hover:text-d-text'
                      >
                        <NoteIcon size={16} />
                      </button>
                      <button
                        type='button'
                        aria-label="删除"
                        onClick={() => handleDelete(product.id)}
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
          count={filteredProducts.length}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={setPage}
          onRowsPerPageChange={(n) => { setRowsPerPage(n); setPage(0) }}
        />
      </div>

      {/* 新增/编辑对话框 */}
      <Modal
        open={dialogOpen}
        onClose={() => !submitting && setDialogOpen(false)}
        maxWidth='md'
        title={currentProduct?.id ? '编辑卡产品' : '新增卡产品'}
        footer={
          <>
            <Button variant='ghost' onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit} loading={submitting}>
              {submitting ? '保存中...' : '确定'}
            </Button>
          </>
        }
      >
        <div className='mb-4 flex justify-end'>
          <AiCompleteButton
            type="card_product"
            formData={currentProduct || {}}
            onComplete={(data) => setCurrentProduct({ ...currentProduct, ...data })}
            availableFields={[
              { key: 'description_md', label: '详细介绍 (Markdown)' },
              { key: 'apply_url', label: '申请链接' },
              { key: 'rewards_summary', label: '积分/返现规则' },
              { key: 'annual_fee', label: '年费金额' },
              { key: 'annual_fee_waiver', label: '年费减免政策' }
            ]}
          />
        </div>
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <SelectField
              label="银行名称"
              required
              placeholder="选择银行"
              value={currentProduct?.bank_id || ''}
              onChange={(e) => {
                const bank = banks.find(b => b.id === e.target.value)
                setCurrentProduct({
                  ...currentProduct,
                  bank_id: e.target.value,
                  bank_name: bank?.name || '',
                })
              }}
              options={banks.map(b => ({ value: b.id, label: b.name }))}
            />
            <TextField
              label="卡片全称"
              required
              value={currentProduct?.card_name || ''}
              onChange={(e) => setCurrentProduct({ ...currentProduct, card_name: e.target.value })}
            />
          </div>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <SelectField
              label="币种"
              value={currentProduct?.currency || 'CNY'}
              onChange={(e) => setCurrentProduct({ ...currentProduct, currency: e.target.value })}
              options={[
                { value: 'CNY', label: 'CNY - 人民币' },
                { value: 'USD', label: 'USD - 美元' },
                { value: 'HKD', label: 'HKD - 港币' },
              ]}
            />
            <TextField
              label="年费"
              type="number"
              value={currentProduct?.annual_fee || 0}
              onChange={(e) => setCurrentProduct({ ...currentProduct, annual_fee: Number(e.target.value) })}
            />
          </div>
          <TextField
            label="申请链接"
            value={currentProduct?.apply_url || ''}
            onChange={(e) => setCurrentProduct({ ...currentProduct, apply_url: e.target.value })}
          />
          <TextArea
            label="积分/返现规则摘要"
            rows={2}
            value={currentProduct?.rewards_summary || ''}
            onChange={(e) => setCurrentProduct({ ...currentProduct, rewards_summary: e.target.value })}
          />
          <SelectField
            label="国家"
            value={currentProduct?.country || 'CN'}
            onChange={(e) => setCurrentProduct({ ...currentProduct, country: e.target.value })}
            options={COUNTRIES.map(c => ({ value: c.code, label: c.label }))}
          />
          <TextArea
            label="卡片详细介绍 (Markdown)"
            rows={4}
            placeholder="支持 Markdown 格式..."
            value={currentProduct?.description_md || ''}
            onChange={(e) => setCurrentProduct({ ...currentProduct, description_md: e.target.value })}
          />
          <TextArea
            label="年费减免政策"
            rows={2}
            placeholder="例如：刷卡 5 次免次年年费"
            value={currentProduct?.annual_fee_waiver || ''}
            onChange={(e) => setCurrentProduct({ ...currentProduct, annual_fee_waiver: e.target.value })}
          />
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <SelectField
              label="还款日规则"
              value={currentProduct?.payment_due_type || 'after_billing'}
              onChange={(e) => setCurrentProduct({ ...currentProduct, payment_due_type: e.target.value as 'after_billing' | 'fixed' })}
              options={[
                { value: 'after_billing', label: '账单日后 N 天' },
                { value: 'fixed', label: '每月固定日期' },
              ]}
            />
            <TextField
              label="规则数值 (天/日)"
              type="number"
              value={currentProduct?.payment_due_value || 20}
              onChange={(e) => setCurrentProduct({ ...currentProduct, payment_due_value: Number(e.target.value) })}
            />
          </div>
        </div>
      </Modal>

      {/* 批量结果反馈：部分成功必须说清楚，不能静默 */}
      <Toast
        open={Boolean(notice)}
        message={notice ?? ''}
        severity='success'
        autoHideMs={6000}
        onClose={() => setNotice(null)}
      />
      <Toast
        open={Boolean(saveError)}
        message={saveError ?? ''}
        severity='error'
        autoHideMs={10000}
        onClose={() => setSaveError(null)}
      />
    </div>
  )
}
