'use client'

// components/opportunities/ManualProgressEditor.tsx — absolute manual
// progress snapshots (the server replaces the whole snapshot and audits
// before/after); “手动确认”语义明示，不代表自动核验消费。

import { useMemo, useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/obsidian/overlays'
import { updateManualTaskProgress } from '@/lib/api/opportunities'
import type { TaskView } from '@/lib/opportunities/tasks.server'

export function ManualProgressEditor({
  task,
  onClose,
  onSaved,
}: {
  task: TaskView | null
  onClose: () => void
  onSaved: () => void
}) {
  const [values, setValues] = useState<Record<string, string>>({})
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const keyRef = useRef<string | null>(null)

  const metrics = useMemo(() => {
    if (!task?.cycle) return []
    return task.cycle.groups.flatMap((g) => g.metrics)
  }, [task])

  if (!task || !task.cycle) return null

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (!keyRef.current) {
        keyRef.current =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? `progress-${crypto.randomUUID()}`
            : `progress-${Date.now()}`
      }
      const metricValues: Record<string, number | boolean> = {}
      for (const metric of metrics) {
        const raw = values[metric.id]
        if (metric.kind === 'check') {
          metricValues[metric.id] = raw === 'true'
        } else if (raw !== undefined && raw !== '') {
          const parsed = Number(raw)
          if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${metric.id} 必须是非负数值`)
          metricValues[metric.id] = parsed
        }
      }
      await updateManualTaskProgress({
        task_cycle_id: task.cycle!.id,
        progress: {
          as_of_on: new Date().toISOString().slice(0, 10),
          metric_values: metricValues,
          note: null,
        },
        reason,
        expected_revision: task.cycle!.revision,
        request_key: keyRef.current,
      })
      keyRef.current = null
      setValues({})
      setReason('')
      onSaved()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open
      title={`手动进度 · ${task.title}`}
      onClose={busy ? () => {} : onClose}
      actions={
        <>
          <button
            type='button'
            disabled={busy}
            onClick={onClose}
            className='h-10 rounded-xl px-5 text-sm font-semibold text-d-muted disabled:opacity-50'
          >
            取消
          </button>
          <button
            type='button'
            disabled={busy || reason.trim().length === 0}
            onClick={() => void submit()}
            className='h-10 rounded-xl bg-d-accent px-5 text-sm font-semibold text-white disabled:opacity-50'
          >
            {busy ? '提交中…' : '提交快照'}
          </button>
        </>
      }
    >
      <p className='text-[12px] leading-4 text-d-muted'>
        提交的是截至当日的完整进度快照（替换而非累加）；退款后下调同样在此录入。手动确认不代表银行自动核验。
      </p>
      <div className='mt-3 flex flex-col gap-2'>
        {metrics.map((metric) => (
          <label key={metric.id} className='flex items-center gap-2'>
            <span className='w-28 shrink-0 text-[12px] text-d-muted'>
              {metric.id}（{metric.kind === 'check' ? '确认' : metric.kind === 'amount' ? '金额' : '笔数'}）
            </span>
            {metric.kind === 'check' ? (
              <input
                type='checkbox'
                checked={values[metric.id] === 'true'}
                onChange={(e) => setValues((v) => ({ ...v, [metric.id]: e.target.checked ? 'true' : 'false' }))}
              />
            ) : (
              <input
                type='number'
                min={0}
                step='any'
                value={values[metric.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [metric.id]: e.target.value }))}
                className='h-10 flex-1 rounded-xl border border-d-border bg-d-bg px-3 text-[16px] text-d-text outline-none focus:border-d-accent'
              />
            )}
          </label>
        ))}
      </div>
      <label className='mt-3 block'>
        <span className='mb-1 block text-[12px] font-semibold text-d-muted'>录入依据（必填，写入审计）</span>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder='例如：银行 APP 消费页截图核对'
          className='w-full rounded-xl border border-d-border bg-d-bg px-3 py-2 text-[16px] text-d-text outline-none focus:border-d-accent'
        />
      </label>
      {error && (
        <p className='mt-2 rounded-lg bg-d-danger-soft px-3 py-2 text-[12px] text-d-danger-ink'>
          {error}（输入与请求键已保留，可直接重试）
        </p>
      )}
    </ConfirmDialog>
  )
}
