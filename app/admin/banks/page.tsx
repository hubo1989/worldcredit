'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/obsidian/controls'
import { Toggle } from '@/components/obsidian/controls'
import { TextField, SelectField } from '@/components/obsidian/fields'
import { Toast, Modal } from '@/components/obsidian/overlays'
import { Spinner } from '@/components/obsidian/feedback'
import { AdminPagination } from '@/components/admin/AdminShell'
import { PlusIcon, SearchIcon, NoteIcon, TrashIcon, SyncIcon } from '@/components/icons/WcIcon'
import { getAdminBanks, createBank, updateBank, deleteBank } from '@/lib/api/admin'
import { Bank } from '@/lib/types'
import { COUNTRIES } from '@/lib/constants'
import AiCompleteButton from '@/components/admin/AiCompleteButton'
import { enrichBankFromWeb, type BankEnrichment } from '@/lib/api/ai'

/** 银行图标：有 logo 用图，加载失败回退首字。 */
function BankLogo({ logoUrl, name }: { logoUrl?: string | null; name: string }) {
  const [failed, setFailed] = useState(false)
  if (logoUrl && !failed) {
    return (
      <img
        src={logoUrl}
        alt={name}
        onError={() => setFailed(true)}
        className='h-9 w-9 rounded-lg bg-d-subtle object-cover'
      />
    )
  }
  return (
    <span className='flex h-9 w-9 items-center justify-center rounded-lg bg-d-subtle text-[14px] text-d-muted'>
      {name?.charAt(0)}
    </span>
  )
}

export default function BanksPage() {
  const [loading, setLoading] = useState(true)
  const [banks, setBanks] = useState<Bank[]>([])
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentBank, setCurrentBank] = useState<Partial<Bank> | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [filterCountry, setFilterCountry] = useState<string>('all')
  const [page, setPage] = useState(0)
  const [rowsPerPage, setRowsPerPage] = useState(10)

  // 「按真实内容补全」：抓官网页面为证，结果先在弹窗里审阅再决定写不写
  const [enriching, setEnriching] = useState(false)
  const [enrichProgress, setEnrichProgress] = useState({ done: 0, total: 0 })
  const [enrichRows, setEnrichRows] = useState<BankEnrichment[]>([])
  const [enrichOpen, setEnrichOpen] = useState(false)

  /** 只补「缺字段」的银行；全部有值就没必要打外网。 */
  const banksMissingFields = (list: Bank[]) =>
    list.filter(b => !b.full_name || !b.customer_service_phone || !b.website_url)

  // 单次「按真实内容补全」最多处理几家。
  //
  // 每家要调一次模型提名域名 + 最多抓 7 个页面（每个 10s 超时），实测平均 3–11s。
  // 此前一次把 69 家全部串行跑完，整轮要几分钟，请求会在中途被掐断——于是
  // 「点了没反应、什么都没变」。分批处理、每批立刻落库，才能有可见进展。
  const ENRICH_BATCH_SIZE = 8

  const handleEnrich = async (targets: Bank[]) => {
    if (enriching || targets.length === 0) return
    setEnriching(true)
    // 分批：只跑前 N 家。跑完整列表会超时，而超时后前端既拿不到结果、库里也没写入。
    const batch = targets.slice(0, ENRICH_BATCH_SIZE)
    setEnrichProgress({ done: 0, total: batch.length })
    const acc: BankEnrichment[] = []
    try {
      // 串行：每次都打外网 + 调模型，并发会把第三方站点打急眼，也更容易触发限流
      for (const bank of batch) {
        try {
          acc.push(await enrichBankFromWeb({
            id: bank.id,
            name: bank.name,
            country: bank.country,
            website_url: bank.website_url,
          }))
        } catch (err) {
          acc.push({
            id: bank.id,
            name: bank.name,
            full_name: null,
            customer_service_phone: null,
            website_url: null,
            fetched: [],
            fetchErrors: [err instanceof Error ? err.message : '补全失败'],
            provenance: { full_name: 'none', customer_service_phone: 'none', website_url: 'none' },
            thirdPartySources: [],
            domainConsistent: false,
          })
        }
        setEnrichProgress({ done: acc.length, total: batch.length })
      }
      setEnrichRows(acc)
      setEnrichOpen(true)
    } finally {
      setEnriching(false)
    }
  }

  /**
   * 写入有依据的字段：`site`（官网页面直接读到）与 `thirdparty`（权威第三方来源）。
   * 两者都在弹窗里标出来源并由人确认后写入；`model`（纯模型记忆）一律不自动写。
   */
  const groundedProvenance = (p: string) => p === 'site' || p === 'thirdparty'

  const handleApplyEnrichment = async () => {
    setSubmitting(true)
    try {
      let applied = 0
      for (const row of enrichRows) {
        const patch: Partial<Bank> = {}
        // 此前只认 `site`，结果是官网拒绝抓取的银行（民泰 412、建行/交行空壳页）
        // 永远补不上——而它们的全称在维基条目里是明确可查的。
        if (groundedProvenance(row.provenance.full_name) && row.full_name) patch.full_name = row.full_name
        if (groundedProvenance(row.provenance.customer_service_phone) && row.customer_service_phone) {
          patch.customer_service_phone = row.customer_service_phone
        }
        if (groundedProvenance(row.provenance.website_url) && row.website_url) patch.website_url = row.website_url
        if (Object.keys(patch).length === 0) continue
        await updateBank(row.id, patch)
        applied++
      }
      // 先统计再清空 enrichRows（清空后这份数据就没了）
      const skipped = enrichRows.filter(r =>
        !groundedProvenance(r.provenance.full_name) &&
        !groundedProvenance(r.provenance.customer_service_phone) &&
        !groundedProvenance(r.provenance.website_url)).length
      setEnrichOpen(false)
      setEnrichRows([])
      // 用 fetchData 返回的新列表算「还剩多少」，不能读闭包里的 banks —— 那是写入前的旧值。
      const fresh = await fetchData()
      // 说清「还剩多少家」，否则用户不知道要不要再点一次（这正是上次「什么都没变」的困惑来源）
      const remaining = banksMissingFields(fresh ?? []).length
      setNotice(
        `已写入 ${applied} 家；本批 ${skipped} 家未从官网读到可写字段` +
        (remaining > 0 ? `；仍有 ${remaining} 家缺字段，可再次点击继续` : '')
      )
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '写入失败')
    } finally {
      setSubmitting(false)
    }
  }

  const fetchData = async () => {
    setLoading(true)
    setFetchError(null)
    try {
      const data = await getAdminBanks()
      setBanks(data || [])
      return data || []
    } catch (error) {
      console.error('Failed to fetch banks:', error)
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
  }, [search, filterCountry])

  const filteredBanks = banks.filter(b => {
    const matchesSearch = b.name.toLowerCase().includes(search.toLowerCase())
    const matchesCountry = filterCountry === 'all' || b.country === filterCountry
    return matchesSearch && matchesCountry
  })

  const paginatedBanks = filteredBanks.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage)

  const handleOpenDialog = (bank?: Bank) => {
    if (bank) {
      setCurrentBank(bank)
    } else {
      setCurrentBank({
        name: '',
        country: 'CN',
        is_active: true
      })
    }
    setDialogOpen(true)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个银行吗？')) return
    try {
      await deleteBank(id)
      setBanks(banks.filter(b => b.id !== id))
    } catch (error) {
      console.error('Failed to delete bank:', error)
    }
  }

  const handleToggleStatus = async (bank: Bank) => {
    try {
      await updateBank(bank.id, { is_active: !bank.is_active })
      setBanks(banks.map(b => b.id === bank.id ? { ...b, is_active: !b.is_active } : b))
    } catch (error) {
      console.error('Failed to toggle status:', error)
    }
  }

  const [saveError, setSaveError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const handleSubmit = async () => {
    if (!currentBank?.name) {
      setSaveError('请填写银行名称')
      return
    }

    setSubmitting(true)
    setSaveError(null)
    try {
      // 清理只读字段，只保留可写字段
      const { id, created_at, ...payload } = currentBank
      void id
      void created_at

      if (currentBank.id) {
        const updated = await updateBank(currentBank.id, payload)
        setBanks(banks.map(b => b.id === currentBank.id ? { ...b, ...updated } : b))
      } else {
        const created = await createBank(payload)
        setBanks([created, ...banks])
      }
      setDialogOpen(false)
    } catch (error) {
      console.error('Failed to save bank:', error)
      setSaveError(`保存失败: ${error instanceof Error ? error.message : '可能由于名称重复或其他错误'}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className='mb-8 flex items-center justify-between gap-4'>
        <div>
          <h1 className='mb-1 text-[26px] font-bold'>银行管理</h1>
          <p className='text-[13px] text-d-muted'>维护系统中支持的银行列表及所属国家</p>
        </div>
        <Button onClick={() => handleOpenDialog()}>
          <PlusIcon size={16} />
          新增银行
        </Button>
      </div>

      <div className='mb-6 rounded-2xl border border-d-border bg-d-surface p-4'>
        <div className='grid grid-cols-1 items-center gap-4 md:grid-cols-3'>
          <TextField
            placeholder="搜索银行名称..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            startAdornment={<SearchIcon size={18} />}
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
          <div className='flex items-center justify-end gap-2'>
            {/* 明确这是「一次一批」，否则点完只补了 8 家会被当成没生效 */}
            <button
              type='button'
              title={`每次最多补 ${ENRICH_BATCH_SIZE} 家（每家要抓官网，全部一起跑会超时）。补完可再次点击继续。`}
              disabled={enriching || banksMissingFields(filteredBanks).length === 0}
              onClick={() => handleEnrich(banksMissingFields(filteredBanks))}
              className='flex h-9 items-center gap-1.5 rounded-xl border border-d-accent-light/40 px-3.5 text-[13px] font-semibold text-d-accent-light disabled:opacity-50'
            >
              {enriching ? <Spinner size={14} className='border-d-border/50 border-t-d-accent-light' /> : <SyncIcon size={14} />}
              {enriching
                ? `补全中 ${enrichProgress.done}/${enrichProgress.total}`
                : `按真实内容补全 (${Math.min(ENRICH_BATCH_SIZE, banksMissingFields(filteredBanks).length)}/${banksMissingFields(filteredBanks).length})`}
            </button>
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

      <div className='overflow-hidden rounded-2xl border border-d-border bg-d-surface'>
        <div className='overflow-x-auto'>
          <table className='w-full border-collapse text-[13px]'>
            <thead className='bg-d-subtle/50'>
              <tr className='[&>th]:px-3 [&>th]:py-2.5 [&>th]:text-left [&>th]:font-semibold [&>th]:text-d-muted'>
                <th className='w-[60px]'>图标</th>
                <th>银行名称</th>
                <th className='w-[100px]'>简称</th>
                <th>国家</th>
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
              ) : filteredBanks.length === 0 ? (
                <tr>
                  <td colSpan={6} className='px-3 py-10 text-center text-d-muted'>
                    {fetchError ? `加载失败: ${fetchError}` : '暂无银行数据'}
                  </td>
                </tr>
              ) : (
                paginatedBanks.map((bank) => (
                  <tr key={bank.id} className='border-t border-d-border/60 transition-colors hover:bg-d-subtle/40'>
                    <td className='px-3 py-2'>
                      <BankLogo logoUrl={bank.logo_url} name={bank.name} />
                    </td>
                    <td className='px-3 py-2 font-medium'>{bank.name}</td>
                    <td className={'px-3 py-2 ' + (bank.short_name ? '' : 'text-d-muted/60')}>
                      {bank.short_name || '—'}
                    </td>
                    <td className='px-3 py-2'>
                      {COUNTRIES.find(c => c.code === bank.country)?.label || bank.country}
                    </td>
                    <td className='px-3 py-2'>
                      <Toggle
                        checked={bank.is_active}
                        onChange={() => handleToggleStatus(bank)}
                        ariaLabel={`启用 ${bank.name}`}
                      />
                    </td>
                    <td className='px-3 py-2 text-right'>
                      <button
                        type='button'
                        aria-label="编辑"
                        onClick={() => handleOpenDialog(bank)}
                        className='rounded-lg p-1.5 text-d-muted hover:bg-d-subtle hover:text-d-text'
                      >
                        <NoteIcon size={16} />
                      </button>
                      <button
                        type='button'
                        aria-label="删除"
                        onClick={() => handleDelete(bank.id)}
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
          count={filteredBanks.length}
          page={page}
          rowsPerPage={rowsPerPage}
          onPageChange={setPage}
          onRowsPerPageChange={(n) => { setRowsPerPage(n); setPage(0) }}
        />
      </div>

      <Modal
        open={dialogOpen}
        onClose={() => !submitting && setDialogOpen(false)}
        title={currentBank?.id ? '编辑银行' : '新增银行'}
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
            type="bank"
            formData={currentBank || {}}
            onComplete={(data) => setCurrentBank({ ...currentBank, ...data })}
            availableFields={[
              { key: 'full_name', label: '银行全称' },
              { key: 'customer_service_phone', label: '客服电话' },
              { key: 'website_url', label: '官方网站' }
            ]}
          />
        </div>
        <div className='flex flex-col gap-4'>
          <TextField
            label="银行名称 (如 招商银行)"
            required
            value={currentBank?.name || ''}
            onChange={(e) => setCurrentBank({ ...currentBank, name: e.target.value })}
          />
          <TextField
            label="简称 (如 招行)"
            value={currentBank?.short_name || ''}
            onChange={(e) => setCurrentBank({ ...currentBank, short_name: e.target.value })}
            helperText="用于列表窄栏与卡片标题"
          />
          <TextField
            label="银行全称"
            value={currentBank?.full_name || ''}
            onChange={(e) => setCurrentBank({ ...currentBank, full_name: e.target.value })}
          />
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
            <TextField
              label="客服电话"
              value={currentBank?.customer_service_phone || ''}
              onChange={(e) => setCurrentBank({ ...currentBank, customer_service_phone: e.target.value })}
            />
            <TextField
              label="官网地址"
              value={currentBank?.website_url || ''}
              onChange={(e) => setCurrentBank({ ...currentBank, website_url: e.target.value })}
            />
          </div>
          <TextField
            label="Logo URL"
            value={currentBank?.logo_url || ''}
            onChange={(e) => setCurrentBank({ ...currentBank, logo_url: e.target.value })}
          />
          <SelectField
            label="国家"
            value={currentBank?.country || 'CN'}
            onChange={(e) => setCurrentBank({ ...currentBank, country: e.target.value })}
            options={COUNTRIES.map(c => ({ value: c.code, label: c.label }))}
          />
        </div>
      </Modal>

      <Toast
        open={Boolean(saveError)}
        message={saveError ?? ''}
        severity='error'
        autoHideMs={8000}
        onClose={() => setSaveError(null)}
      />

      <Toast
        open={Boolean(notice)}
        message={notice ?? ''}
        severity='success'
        autoHideMs={6000}
        onClose={() => setNotice(null)}
      />

      {/* 审阅弹窗：只有官网页面上直接读到的字段会被写入，模型凭记忆给的候选只展示不落库 */}
      <Modal
        open={enrichOpen}
        onClose={() => !submitting && setEnrichOpen(false)}
        maxWidth='md'
        title='按真实内容补全（以官网页面为证）'
        footer={
          <>
            <Button variant='ghost' onClick={() => setEnrichOpen(false)} disabled={submitting}>取消</Button>
            <Button onClick={handleApplyEnrichment} loading={submitting}>
              {submitting ? '写入中...' : '写入已确认字段'}
            </Button>
          </>
        }
      >
        <p className='mb-4 text-[13px] leading-5 text-d-muted'>
          来源标记：「官网」= 在该行官网页面上直接读到；「第三方」= 取自权威第三方来源
          （Wikidata / 维基百科条目，用于官网拒绝抓取的银行）；「待确认」= 仅模型记忆，不写入，
          需你核对后手动填写。写入时只取前两类。
        </p>
        <div className='overflow-hidden rounded-xl border border-d-border'>
          <div className='overflow-x-auto'>
            <table className='w-full border-collapse text-[12px]'>
              <thead className='bg-d-subtle/50'>
                <tr className='[&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-semibold [&>th]:text-d-muted'>
                  <th>银行</th>
                  <th>全称</th>
                  <th>客服电话</th>
                  <th>官网</th>
                  <th>依据</th>
                </tr>
              </thead>
              <tbody>
                {enrichRows.map(row => {
                  const tag = (p: 'site' | 'thirdparty' | 'model' | 'none') =>
                    p === 'site' ? (
                      <span className='ml-1 rounded bg-d-success-soft px-1.5 py-0.5 text-[11px] text-d-success-ink'>官网</span>
                    ) : p === 'thirdparty' ? (
                      <span className='ml-1 rounded bg-d-accent/15 px-1.5 py-0.5 text-[11px] text-d-accent-light'>第三方</span>
                    ) : p === 'model' ? (
                      <span className='ml-1 rounded bg-d-warn-ink/15 px-1.5 py-0.5 text-[11px] text-d-warn-ink'>待确认</span>
                    ) : null
                  return (
                    <tr key={row.id} className='border-t border-d-border/60 align-top'>
                      <td className='px-3 py-2'>{row.name}</td>
                      <td className='px-3 py-2'>
                        {row.full_name || '—'} {tag(row.provenance.full_name)}
                      </td>
                      <td className='px-3 py-2'>
                        {row.customer_service_phone || '—'} {tag(row.provenance.customer_service_phone)}
                      </td>
                      <td className='px-3 py-2 text-d-accent-light'>
                        {row.website_url || '—'} {tag(row.provenance.website_url)}
                      </td>
                      <td className='px-3 py-2 text-[11px] text-d-muted'>
                        {row.fetched.length > 0
                          ? `已抓 ${row.fetched.length} 页${row.domainConsistent ? '' : '（域名未能对上，请留意）'}`
                          : row.thirdPartySources.length > 0
                            ? '官网抓取失败，改用第三方来源'
                            : row.fetchErrors.length > 0
                              ? `未抓到：${row.fetchErrors[0]}`.slice(0, 60)
                              : '无依据'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </Modal>
    </div>
  )
}
