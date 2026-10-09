'use client'

import { useState, useEffect } from 'react'
import { Button, Toggle } from '@/components/obsidian/controls'
import { TextField, TextArea, SelectField } from '@/components/obsidian/fields'
import { Modal, Toast } from '@/components/obsidian/overlays'
import { Alert, Spinner } from '@/components/obsidian/feedback'
import { AdminPagination, AdminCheckbox } from '@/components/admin/AdminShell'
import { PlusIcon, SearchIcon, NoteIcon, TrashIcon, SyncIcon, AiSparkleIcon } from '@/components/icons/WcIcon'
import { getAdminPromos, createPromo, updatePromo, deletePromo, getAdminCardProducts } from '@/lib/api/admin'
import { Promo, CardProduct } from '@/lib/types'
import { suggestPromosFromWeb, type PromoSuggestion } from '@/lib/api/ai'

/** 优惠列表行：promos 字段 + 关联卡产品联查字段 */
type AdminPromoRow = Promo & {
  is_active: boolean
  // The admin RPC returns flat joined columns (product_bank_name/product_card_name),
  // not a nested card_products object.
  product_bank_name?: string
  product_card_name?: string
}

export default function PromosPage() {
  const [loading, setLoading] = useState(true)
  const [promos, setPromos] = useState<AdminPromoRow[]>([])
  const [cardProducts, setCardProducts] = useState<CardProduct[]>([])
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentPromo, setCurrentPromo] = useState<Partial<AdminPromoRow> | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)
  // AI 拉取活动：候选先复核再落库
  const [aiOpen, setAiOpen] = useState(false)
  const [aiBank, setAiBank] = useState('')
  const [aiCardName, setAiCardName] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiRows, setAiRows] = useState<PromoSuggestion[]>([])
  const [aiChecked, setAiChecked] = useState<boolean[]>([])
  const [aiSaving, setAiSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const fetchData = async () => {
    setLoading(true)
    try {
      const [pData, cpData] = await Promise.all([
        getAdminPromos(),
        getAdminCardProducts()
      ])
      setPromos(pData as unknown as AdminPromoRow[])
      setCardProducts(cpData)
    } catch (error) {
      console.error('Failed to fetch promos:', error)
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

  const filteredPromos = promos.filter(p =>
    p.bank_name.toLowerCase().includes(search.toLowerCase()) ||
    p.title.toLowerCase().includes(search.toLowerCase())
  )

  const paginatedPromos = filteredPromos.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  const handleOpenDialog = (promo?: AdminPromoRow) => {
    if (promo) {
      setCurrentPromo(promo)
    } else {
      setCurrentPromo({
        bank_name: '',
        title: '',
        discount_type: '满减',
        is_active: true,
        start_date: new Date().toISOString().slice(0, 10)
      })
    }
    setDialogOpen(true)
  }

  const handleToggleStatus = async (promo: AdminPromoRow) => {
    try {
      await updatePromo(promo.id, { is_active: !promo.is_active })
      setPromos(promos.map(p => p.id === promo.id ? { ...p, is_active: !promo.is_active } : p))
    } catch (error) {
      console.error('Failed to toggle status:', error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个优惠活动吗？')) return
    try {
      await deletePromo(id)
      setPromos(promos.filter(p => p.id !== id))
    } catch (error) {
      console.error('Failed to delete promo:', error)
    }
  }

  const handleSubmit = async () => {
    if (!currentPromo?.bank_name || !currentPromo?.title) {
      alert('请填写必填项（银行名称、活动名称）')
      return
    }

    setSubmitting(true)
    try {
      if (currentPromo.id) {
        const { product_bank_name, product_card_name, ...payload } = currentPromo
        void product_bank_name
        void product_card_name
        const updated = await updatePromo(currentPromo.id, payload)
        setPromos(promos.map(p => p.id === currentPromo.id ? { ...p, ...updated } as AdminPromoRow : p))
      } else {
        const created = await createPromo(currentPromo)
        setPromos([created as unknown as AdminPromoRow, ...promos])
      }
      setDialogOpen(false)
      fetchData() // Refresh to get relations
    } catch (error) {
      console.error('Failed to save promo:', error)
      alert('保存失败，请重试')
    } finally {
      setSubmitting(false)
    }
  }

  /** 拉取 AI 候选。不写库——活动时效性强，先复核再落库。 */
  const handleFetchSuggestions = async () => {
    if (!aiBank.trim()) {
      setAiError('请先填写银行名称')
      return
    }
    setAiLoading(true)
    setAiError(null)
    setAiRows([])
    setAiChecked([])
    try {
      const rows = await suggestPromosFromWeb({
        bankName: aiBank.trim(),
        cardName: aiCardName.trim() || null,
        websiteUrl: null,
      })
      if (rows.length === 0) {
        setAiError('未查到可用的活动信息，可换一个银行名称或稍后再试')
      }
      setAiRows(rows)
      // 默认只勾选「官网页面能对上」的候选；模型记忆的留给人工判断
      setAiChecked(rows.map(r => r.provenance === 'site'))
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI 获取失败')
    } finally {
      setAiLoading(false)
    }
  }

  /** 把勾选的候选写入 promos。逐条创建并在结束时汇总成败。 */
  const handleImportSuggestions = async () => {
    const picked = aiRows.filter((_, i) => aiChecked[i])
    if (picked.length === 0) {
      setAiError('请先勾选要写入的活动')
      return
    }
    setAiSaving(true)
    let ok = 0
    const failed: string[] = []
    try {
      for (const row of picked) {
        try {
          await createPromo({
            bank_name: aiBank.trim(),
            title: row.title,
            description: row.description || undefined,
            discount_type: row.discount_type || undefined,
            start_date: row.start_date || undefined,
            end_date: row.end_date || undefined,
            conditions: row.conditions || undefined,
            is_active: true,
          } as Partial<Promo & { is_active: boolean }>)
          ok++
        } catch (err) {
          failed.push(`${row.title}（${err instanceof Error ? err.message : '失败'}）`)
        }
      }
      await fetchData()
      setAiOpen(false)
      setAiRows([])
      setAiChecked([])
      setNotice(
        failed.length === 0
          ? `已导入 ${ok} 条优惠活动`
          : `已导入 ${ok} 条，${failed.length} 条失败：${failed.slice(0, 3).join('；')}`
      )
    } finally {
      setAiSaving(false)
    }
  }

  return (
    <div>
      <div className='mb-8 flex items-center justify-between gap-4'>
        <div>
          <h1 className='mb-1 text-[26px] font-bold'>优惠活动管理</h1>
          <p className='text-[13px] text-d-muted'>管理全平台银行优惠活动，支持设置满减、返现、折扣等活动细节</p>
        </div>
        <div className='flex gap-2'>
          <Button
            variant='secondary'
            onClick={() => { setAiOpen(true); setAiError(null); setAiRows([]); setAiChecked([]) }}
          >
            <AiSparkleIcon size={16} />
            AI 获取活动
          </Button>
          <Button onClick={() => handleOpenDialog()}>
            <PlusIcon size={16} />
            发布新活动
          </Button>
        </div>
      </div>

      {/* 搜索 */}
      <div className='mb-6 rounded-2xl border border-d-border bg-d-surface p-4'>
        <div className='flex items-center justify-between gap-4'>
          <div className='w-full sm:max-w-sm'>
            <TextField
              placeholder="搜索银行或活动..."
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
                <th>银行</th>
                <th>活动名称</th>
                <th>关联产品</th>
                <th>折扣类型</th>
                <th>有效期</th>
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
              ) : filteredPromos.length === 0 ? (
                <tr>
                  <td colSpan={7} className='px-3 py-10 text-center text-d-muted'>未找到优惠活动</td>
                </tr>
              ) : (
                paginatedPromos.map((promo) => (
                  <tr key={promo.id} className='border-t border-d-border/60 transition-colors hover:bg-d-subtle/40'>
                    <td className='px-3 py-2 font-medium'>{promo.bank_name}</td>
                    <td className='px-3 py-2'>{promo.title}</td>
                    <td className='px-3 py-2 text-d-muted'>{promo.product_card_name || '全门类'}</td>
                    <td className='px-3 py-2'>
                      <span className='rounded-md border border-d-accent-light/60 px-2 py-0.5 text-[11px] text-d-accent-light'>
                        {promo.discount_type}
                      </span>
                    </td>
                    <td className='px-3 py-2 whitespace-nowrap text-d-muted'>
                      {promo.start_date || '即日起'} 至 {promo.end_date || '长期'}
                    </td>
                    <td className='px-3 py-2'>
                      <Toggle
                        checked={promo.is_active}
                        onChange={() => handleToggleStatus(promo)}
                        ariaLabel={`启用 ${promo.title}`}
                      />
                    </td>
                    <td className='px-3 py-2 text-right'>
                      <button
                        type='button'
                        aria-label="编辑"
                        onClick={() => handleOpenDialog(promo)}
                        className='rounded-lg p-1.5 text-d-muted hover:bg-d-subtle hover:text-d-text'
                      >
                        <NoteIcon size={16} />
                      </button>
                      <button
                        type='button'
                        aria-label="删除"
                        onClick={() => handleDelete(promo.id)}
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
          count={filteredPromos.length}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={setPage}
          onRowsPerPageChange={(n) => { setRowsPerPage(n); setPage(0) }}
        />
      </div>

      {/* AI 获取活动：先复核再落库 */}
      <Modal
        open={aiOpen}
        onClose={() => !aiSaving && setAiOpen(false)}
        maxWidth='md'
        title='AI 获取活动'
        footer={
          <>
            <Button variant='ghost' onClick={() => setAiOpen(false)} disabled={aiSaving}>取消</Button>
            <Button onClick={handleImportSuggestions} disabled={aiSaving || aiRows.length === 0}>
              {aiSaving ? '写入中...' : `写入勾选 (${aiChecked.filter(Boolean).length})`}
            </Button>
          </>
        }
      >
        <p className='mb-4 text-[13px] leading-5 text-d-muted'>
          按银行（可选指定卡片）检索当前可查到的优惠活动。抓得到官网活动页时以页面正文为准，
          标为「官网」；仅来自模型记忆的标为「待确认」。默认只勾选「官网」项，写入前请自行核对。
        </p>
        <div className='mb-4 grid grid-cols-1 gap-4 md:grid-cols-5'>
          <div className='md:col-span-2'>
            <TextField
              label="银行名称"
              required
              value={aiBank}
              onChange={e => setAiBank(e.target.value)}
            />
          </div>
          <div className='md:col-span-2'>
            <TextField
              label="卡片名称（可选）"
              value={aiCardName}
              onChange={e => setAiCardName(e.target.value)}
            />
          </div>
          <div className='flex items-end'>
            <Button onClick={handleFetchSuggestions} loading={aiLoading} className='w-full'>
              {aiLoading ? '获取中' : '获取'}
            </Button>
          </div>
        </div>

        {aiError && (
          <div className='mb-4'>
            <Alert severity="warning">{aiError}</Alert>
          </div>
        )}

        {aiRows.length > 0 && (
          <div className='overflow-hidden rounded-xl border border-d-border'>
            <div className='overflow-x-auto'>
              <table className='w-full border-collapse text-[12px]'>
                <thead className='bg-d-subtle/50'>
                  <tr className='[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold [&>th]:text-d-muted'>
                    <th className='w-10'>
                      <AdminCheckbox
                        ariaLabel='全选活动'
                        checked={aiChecked.length > 0 && aiChecked.every(Boolean)}
                        indeterminate={aiChecked.some(Boolean) && !aiChecked.every(Boolean)}
                        onChange={checked => setAiChecked(aiRows.map(() => checked))}
                      />
                    </th>
                    <th>活动名称</th>
                    <th>类型</th>
                    <th>有效期</th>
                    <th>依据</th>
                  </tr>
                </thead>
                <tbody>
                  {aiRows.map((row, i) => (
                    <tr key={i} className='border-t border-d-border/60 align-top'>
                      <td className='px-3 py-2'>
                        <AdminCheckbox
                          ariaLabel={`选择 ${row.title}`}
                          checked={aiChecked[i] || false}
                          onChange={checked => setAiChecked(aiChecked.map((v, j) => j === i ? checked : v))}
                        />
                      </td>
                      <td className='px-3 py-2 text-[13px]'>
                        {row.title}
                        {row.description && (
                          <span className='block text-[12px] text-d-muted'>{row.description}</span>
                        )}
                      </td>
                      <td className='px-3 py-2'>{row.discount_type || '—'}</td>
                      <td className='px-3 py-2 text-d-muted'>
                        {row.start_date || '即日起'} 至 {row.end_date || '长期'}
                      </td>
                      <td className='px-3 py-2'>
                        <span
                          className={
                            'rounded px-1.5 py-0.5 text-[11px] font-semibold ' +
                            (row.provenance === 'site'
                              ? 'bg-d-success-soft text-d-success-ink'
                              : 'bg-d-warn-ink/15 text-d-warn-ink')
                          }
                        >
                          {row.provenance === 'site' ? '官网' : '待确认'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Toast
        open={Boolean(notice)}
        message={notice ?? ''}
        severity='success'
        autoHideMs={6000}
        onClose={() => setNotice(null)}
      />

      {/* 对话框 */}
      <Modal
        open={dialogOpen}
        onClose={() => !submitting && setDialogOpen(false)}
        maxWidth='md'
        title={currentPromo?.id ? '编辑优惠活动' : '发布新优惠活动'}
        footer={
          <>
            <Button variant='ghost' onClick={() => setDialogOpen(false)}>取消</Button>
            <Button onClick={handleSubmit} loading={submitting}>确定</Button>
          </>
        }
      >
        <div className='flex flex-col gap-4'>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <TextField
              label="银行名称"
              required
              value={currentPromo?.bank_name || ''}
              onChange={(e) => setCurrentPromo({ ...currentPromo, bank_name: e.target.value })}
            />
            <TextField
              label="活动标题"
              required
              value={currentPromo?.title || ''}
              onChange={(e) => setCurrentPromo({ ...currentPromo, title: e.target.value })}
            />
          </div>
          <SelectField
            label="关联卡产品 (可选)"
            value={currentPromo?.card_product_id || ''}
            placeholder="不关联（全门类）"
            onChange={(e) => {
              const product = cardProducts.find(cp => cp.id === e.target.value)
              setCurrentPromo({
                ...currentPromo,
                card_product_id: product?.id,
                bank_name: product?.bank_name || currentPromo?.bank_name,
              })
            }}
            options={cardProducts.map(cp => ({
              value: cp.id,
              label: `${cp.bank_name} - ${cp.card_name}`,
            }))}
          />
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <TextField
              label="开始日期"
              type="date"
              value={currentPromo?.start_date || ''}
              onChange={(e) => setCurrentPromo({ ...currentPromo, start_date: e.target.value })}
            />
            <TextField
              label="结束日期"
              type="date"
              value={currentPromo?.end_date || ''}
              onChange={(e) => setCurrentPromo({ ...currentPromo, end_date: e.target.value })}
            />
          </div>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <SelectField
              label="折扣类型"
              value={currentPromo?.discount_type || '满减'}
              onChange={(e) => setCurrentPromo({ ...currentPromo, discount_type: e.target.value })}
              options={[
                { value: '满减', label: '满减' },
                { value: '折扣', label: '折扣' },
                { value: '积分', label: '积分' },
                { value: '返现', label: '返现' },
              ]}
            />
            <TextField
              label="最大使用次数"
              type="number"
              value={currentPromo?.max_uses || ''}
              onChange={(e) => setCurrentPromo({ ...currentPromo, max_uses: Number(e.target.value) })}
            />
          </div>
          <TextArea
            label="详细描述/条件"
            rows={3}
            value={currentPromo?.description || ''}
            onChange={(e) => setCurrentPromo({ ...currentPromo, description: e.target.value })}
          />
        </div>
      </Modal>
    </div>
  )
}
