'use client'

// app/(mobile)/benefits/tasks/page.tsx — P2 手动任务与领取/到账（Task 21）。
// 数据走 getOpportunityTasks / getOpportunityPage；达标、到账、预约的语义
// 在文案中显式区分，不互相冒充。

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeftIcon } from '@/components/icons/WcIcon'
import { getOpportunityTasks, getOpportunityPage } from '@/lib/api/opportunities'
import { TaskList } from '@/components/opportunities/TaskList'
import { RewardReceivedDialog } from '@/components/opportunities/ClaimDialog'
import type { TaskView } from '@/lib/opportunities/tasks.server'
import type { OpportunityDto } from '@/lib/opportunities/queries.server'

export default function OpportunityTasksPage() {
  const [tasks, setTasks] = useState<TaskView[]>([])
  const [pendingClaims, setPendingClaims] = useState<OpportunityDto[]>([])
  const [rewardTarget, setRewardTarget] = useState<TaskView | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const [taskViews, claimable] = await Promise.all([
        getOpportunityTasks({}),
        getOpportunityPage({ status: 'claimable' }),
      ])
      setTasks(taskViews)
      setPendingClaims(claimable.items)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className='obsidian-dashboard min-h-dvh bg-d-bg px-5 pb-24 pt-4 text-d-text'>
      <div className='mb-3 flex items-center gap-2.5'>
        <a
          href='/benefits'
          aria-label='返回权益'
          className='flex h-9 w-9 items-center justify-center rounded-full border border-d-border'
        >
          <ChevronLeftIcon size={16} />
        </a>
        <div className='min-w-0 flex-1'>
          <p className='text-[18px] font-bold leading-6 text-d-text'>达标任务</p>
          <p className='text-[12px] leading-4 text-d-muted'>手动确认进度；达标与到账分别记录</p>
        </div>
      </div>

      {loading ? (
        [1, 2].map((i) => <div key={i} className='wc-skeleton mb-3 h-32 w-full rounded-2xl' />)
      ) : error ? (
        <div className='rounded-2xl border border-dashed border-d-border bg-d-surface p-6 text-center'>
          <p className='break-all px-2 text-[12px] text-d-danger-ink'>{error}</p>
          <button
            type='button'
            onClick={() => void load()}
            className='mx-auto mt-3 flex h-10 items-center rounded-full border border-d-accent px-4 text-[12px] font-semibold text-d-accent-light'
          >
            重新加载
          </button>
        </div>
      ) : (
        <>
          {pendingClaims.length > 0 && (
            <div className='mb-4 rounded-2xl border border-d-border bg-d-surface p-4'>
              <p className='text-[13px] font-bold text-d-text'>待领取</p>
              <p className='mt-0.5 text-[11px] text-d-muted'>以下机会的领取窗口已开启，去「可用机会」记录领取。</p>
              <div className='mt-2 flex flex-col gap-1.5'>
                {pendingClaims.map((dto) => (
                  <a key={dto.account_id} href='/promos' className='rounded-xl bg-d-subtle px-3 py-2 text-[13px] font-semibold'>
                    {dto.title} · {dto.reason}
                  </a>
                ))}
              </div>
            </div>
          )}

          <TaskList tasks={tasks} onReload={() => void load()} />

          {tasks.length > 0 && (
            <button
              type='button'
              onClick={() => setRewardTarget(tasks[0])}
              className='mt-4 flex h-11 w-full items-center justify-center rounded-full border border-d-accent text-[13px] font-semibold text-d-accent-light'
            >
              记录奖励到账（{tasks[0].title}）
            </button>
          )}
        </>
      )}

      {rewardTarget && (
        <RewardReceivedDialog
          taskCycle={{ id: rewardTarget.cycle?.id ?? '', title: rewardTarget.title }}
          rewardKey='spend-gift'
          rewardKind='quota'
          accountId={null}
          onClose={() => setRewardTarget(null)}
          onDone={() => void load()}
        />
      )}
    </div>
  )
}
