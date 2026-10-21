'use client'

// components/opportunities/TaskList.tsx — manual task cycles with per-group
// gaps, expected reward windows and separated satisfaction vs delivery
// (达标 ≠ 到账). Manual progress editing lives in ManualProgressEditor.

import { useState } from 'react'
import type { TaskView } from '@/lib/opportunities/tasks.server'
import { ManualProgressEditor } from './ManualProgressEditor'

const TYPE_LABELS: Record<string, string> = {
  annual_fee: '年费任务',
  welcome: '新户任务',
  monthly_spend: '月度消费',
  custom: '自定义',
}

export function TaskList({ tasks, onReload }: { tasks: TaskView[]; onReload: () => void }) {
  const [editing, setEditing] = useState<TaskView | null>(null)

  if (tasks.length === 0) {
    return (
      <p className='rounded-2xl border border-dashed border-d-border bg-d-surface p-6 text-center text-[12px] text-d-muted'>
        暂无手动达标任务；到「我的权益」为权益初始化账户后可创建。
      </p>
    )
  }

  return (
    <>
      <div className='flex flex-col gap-3'>
        {tasks.map((task) => (
          <div key={task.task_id} className='rounded-2xl border border-d-border bg-d-surface p-4'>
            <div className='flex items-start justify-between gap-2'>
              <div className='min-w-0 flex-1'>
                <p className='truncate text-[15px] font-semibold text-d-text'>{task.title}</p>
                <p className='mt-0.5 text-[12px] text-d-muted'>
                  {TYPE_LABELS[task.task_type] ?? task.task_type} · {task.holder_name} ·
                  统计至 {task.cycle?.as_of_on ?? '未录入'}
                </p>
              </div>
              <span
                className={
                  'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ' +
                  (task.cycle?.satisfied ? 'bg-d-accent/15 text-d-accent-light' : 'bg-d-gold-soft text-d-warn-ink')
                }
              >
                {task.cycle?.satisfied ? '已达标' : '未达标'}
              </span>
            </div>

            {task.cycle && (
              <>
                <div className='mt-2 flex flex-col gap-1'>
                  {task.cycle.groups.map((group) => (
                    <div key={group.id} className='rounded-xl bg-d-subtle px-3 py-2'>
                      <p className='text-[11px] text-d-muted'>
                        {group.satisfied ? '✓ 任选一组满足' : '组内需全部满足（组间任一）'}
                      </p>
                      {group.metrics.map((metric) => (
                        <p key={metric.id} className='text-[12px] leading-5 text-d-text'>
                          · {metric.id}
                          {metric.kind === 'check' ? (metric.satisfied ? ' 已确认' : ' 未确认')
                            : metric.gap !== null && metric.gap > 0 ? ` 还差 ${metric.gap}` : ' 已完成'}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
                <p className='mt-2 text-[11px] leading-4 text-d-muted'>
                  预计发放窗口：{task.cycle.expected_from_on ?? '待补充'}
                  {task.cycle.expected_until_before ? ` 至 ${task.cycle.expected_until_before}` : ' 起'}
                  ；达标不等于到账，请在到账后记录。
                </p>
              </>
            )}

            <div className='mt-3 flex gap-2'>
              <button
                type='button'
                onClick={() => setEditing(task)}
                className='h-10 flex-1 rounded-full bg-d-accent text-[13px] font-semibold text-white'
              >
                录入 / 更正进度
              </button>
            </div>
          </div>
        ))}
      </div>
      <ManualProgressEditor task={editing} onClose={() => setEditing(null)} onSaved={onReload} />
    </>
  )
}
