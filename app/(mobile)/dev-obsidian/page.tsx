// 内部预览页（DEV only）：ObsidianUI 迁移基础设施验证用。
// Dashboard 迁移（B1）落地后删除本路由。
import Link from 'next/link';
import type { StatusDay } from '@/components/obsidian/status-bars';
import { StatusBars } from '@/components/obsidian/status-bars';

export default function DevObsidianPage() {
  if (import.meta.env.PROD) return null;
  return (
    <main className="min-h-dvh bg-d-bg p-5 text-d-text">
      <h1 className="text-lg font-bold">ObsidianUI 迁移验证（DEV only）</h1>
      <p className="mt-1 text-xs text-d-muted">Tailwind v4 + 暗色 token + vendored 组件冒烟页</p>

      <section className="mt-4 rounded-2xl border border-d-border bg-d-surface p-4">
        <h2 className="text-sm font-bold">今天需还款 09-30</h2>
        <p className="mt-1 text-xs text-d-muted">建设银行 · 尾号 9003</p>
        <p className="mt-2 text-xl font-bold text-d-gold">¥8,000.00</p>
        <button className="mt-3 h-11 w-full rounded-xl bg-d-accent text-sm font-semibold text-white shadow-[0_4px_18px_rgba(59,111,224,0.5)]">
          立即还款
        </button>
      </section>

      <section className="mt-4 rounded-2xl border border-d-border bg-d-surface p-4">
        <h2 className="text-sm font-bold">StatusBars（ObsidianUI 组件）</h2>
        <div className="mt-3 text-d-accent-light">
          <StatusBars
            label="WorldCredit API"
            days={[
              ...Array.from({ length: 29 }, (_, i): StatusDay => ({
                date: new Date(Date.now() - (29 - i) * 86400000).toISOString().slice(0, 10),
                status: 'up',
              })),
              { date: new Date().toISOString().slice(0, 10), status: 'degraded', degraded: 42 },
            ]}
          />
        </div>
      </section>

      <Link href="/dashboard" className="mt-4 inline-block text-xs text-d-accent-light">
        返回 Dashboard
      </Link>
    </main>
  );
}
