# WorldCredit 商用化 MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 把 WorldCredit 从家庭信用卡自用工具推进到可小范围收费验证的家庭信用卡账单管家。

**Architecture:** 先建立 `household` 家庭边界，再在其上叠加 `subscription` 权益校验、账单导入额度、提醒可靠性、报表导出和最小运营后台。现有 `lib/api/*`、RLS 和移动端页面继续保留，新增能力通过独立模块接入，避免把订阅和家庭逻辑散落到业务页面里。

**Tech Stack:** React 19、MUI、Vinext/Next-style app routes、InsForge SDK、Postgres SQL/RLS、TypeScript、Vitest。

---

## 执行约束

当前工作区已有大量未提交改动。执行本计划时，每个任务只能 `git add` 该任务列出的文件，不要暂存或回滚无关改动。

每个任务按 TDD 执行：先写失败测试，再写最小实现，再跑目标测试，最后小提交。涉及数据库迁移的任务先写 SQL，再补类型和 API；不能只做前端隐藏入口。

---

### Task 1: 建立家庭与订阅数据模型

**Files:**
- Create: `db/migrations/007_commercial_households_subscriptions.sql`
- Modify: `db/schema.sql`

**Step 1: 写迁移 SQL**

Create `db/migrations/007_commercial_households_subscriptions.sql`:

```sql
-- Commercial MVP: household boundary, subscription, entitlement, audit, feedback.

CREATE TABLE IF NOT EXISTS households (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS household_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
  invited_email TEXT,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(household_id, user_id),
  UNIQUE(household_id, invited_email)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  household_id UUID PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'pro')),
  status TEXT NOT NULL DEFAULT 'trialing' CHECK (status IN ('trialing', 'active', 'past_due', 'cancelled')),
  trial_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  trial_end TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '14 days'),
  provider TEXT NOT NULL DEFAULT 'manual',
  provider_customer_id TEXT,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS entitlement_overrides (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  plan TEXT NOT NULL CHECK (plan IN ('free', 'pro')),
  reason TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_counters (
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  period TEXT NOT NULL,
  value INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (household_id, metric, period)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feedback_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID REFERENCES households(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE card_holders ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE CASCADE;
ALTER TABLE bill_import_drafts ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE CASCADE;
ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS household_id UUID REFERENCES households(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_households_owner ON households(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_household_members_household ON household_members(household_id);
CREATE INDEX IF NOT EXISTS idx_household_members_user ON household_members(user_id);
CREATE INDEX IF NOT EXISTS idx_card_holders_household ON card_holders(household_id);
CREATE INDEX IF NOT EXISTS idx_audit_events_household_created ON audit_events(household_id, created_at DESC);
```

**Step 2: 补 RLS 策略**

在同一迁移文件继续加入 `ENABLE ROW LEVEL SECURITY` 和策略：

```sql
ALTER TABLE households ENABLE ROW LEVEL SECURITY;
ALTER TABLE household_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE entitlement_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE feedback_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "members_can_view_households" ON households
  FOR SELECT
  USING (id IN (
    SELECT household_id FROM household_members hm
    JOIN users u ON hm.user_id = u.id
    WHERE u.auth_id = auth.uid() AND hm.status = 'accepted'
  ));

CREATE POLICY "owners_can_manage_households" ON households
  FOR ALL
  USING (owner_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()))
  WITH CHECK (owner_user_id IN (SELECT id FROM users WHERE auth_id = auth.uid()));

CREATE POLICY "members_can_view_memberships" ON household_members
  FOR SELECT
  USING (household_id IN (
    SELECT hm.household_id FROM household_members hm
    JOIN users u ON hm.user_id = u.id
    WHERE u.auth_id = auth.uid() AND hm.status = 'accepted'
  ));
```

**Step 3: 更新 `db/schema.sql`**

把新表结构同步到 `db/schema.sql`，并给 `card_holders`、`bill_import_drafts`、`notification_preferences` 补 `household_id`。不要删除现有字段，迁移期允许 `managed_by` 和 `household_id` 共存。

**Step 4: 人工检查 SQL**

Run:

```bash
rg -n "households|household_members|subscriptions|audit_events|household_id" db/schema.sql db/migrations/007_commercial_households_subscriptions.sql
```

Expected: 能看到新表、新索引和 `household_id` 字段。

**Step 5: Commit**

```bash
git add db/schema.sql db/migrations/007_commercial_households_subscriptions.sql
git commit -m "feat: add commercial household schema"
```

---

### Task 2: 增加商用化类型定义

**Files:**
- Modify: `lib/types.ts`
- Test: `lib/__tests__/commercialTypes.test.ts`

**Step 1: 写类型测试**

Create `lib/__tests__/commercialTypes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Household, HouseholdMember, Subscription } from '../types'

describe('commercial types', () => {
  it('supports household membership roles', () => {
    const member: HouseholdMember = {
      id: 'hm-1',
      household_id: 'household-1',
      user_id: 'user-1',
      role: 'owner',
      status: 'accepted',
      invited_email: 'a@example.com',
      accepted_at: '2026-05-06T00:00:00Z',
      created_at: '2026-05-06T00:00:00Z',
    }

    expect(member.role).toBe('owner')
  })

  it('supports free and pro subscription plans', () => {
    const subscription: Subscription = {
      household_id: 'household-1',
      plan: 'pro',
      status: 'active',
      trial_start: '2026-05-06T00:00:00Z',
      trial_end: '2026-05-20T00:00:00Z',
      provider: 'manual',
      created_at: '2026-05-06T00:00:00Z',
      updated_at: '2026-05-06T00:00:00Z',
    }

    const household: Household = {
      id: 'household-1',
      owner_user_id: 'user-1',
      name: 'Hubert 的家庭',
      created_at: '2026-05-06T00:00:00Z',
    }

    expect(subscription.plan).toBe('pro')
    expect(household.name).toContain('家庭')
  })
})
```

**Step 2: 验证失败**

Run:

```bash
npm test -- commercialTypes.test.ts
```

Expected: FAIL，提示 `Household`、`HouseholdMember`、`Subscription` 未导出。

**Step 3: 添加类型**

Modify `lib/types.ts`:

```ts
export interface Household {
  id: string
  owner_user_id: string
  name: string
  created_at: string
}

export interface HouseholdMember {
  id: string
  household_id: string
  user_id?: string
  role: 'owner' | 'admin' | 'member'
  status: 'pending' | 'accepted' | 'expired' | 'revoked'
  invited_email?: string
  accepted_at?: string
  created_at: string
}

export interface Subscription {
  household_id: string
  plan: 'free' | 'pro'
  status: 'trialing' | 'active' | 'past_due' | 'cancelled'
  trial_start: string
  trial_end: string
  provider: 'manual' | 'stripe' | 'app_store' | string
  provider_customer_id?: string
  current_period_end?: string
  created_at: string
  updated_at: string
}
```

Also add optional `household_id?: string` to `CardHolder`.

**Step 4: 验证通过**

Run:

```bash
npm test -- commercialTypes.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add lib/types.ts lib/__tests__/commercialTypes.test.ts
git commit -m "feat: add commercial domain types"
```

---

### Task 3: 建立家庭 API 与默认家庭创建

**Files:**
- Create: `lib/api/households.ts`
- Test: `lib/__tests__/household.test.ts`
- Modify: `lib/auth.tsx`

**Step 1: 写纯逻辑测试**

Create `lib/__tests__/household.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canManageHousehold, canViewHousehold, getDefaultHouseholdName } from '../api/households'
import type { HouseholdMember } from '../types'

const owner: HouseholdMember = {
  id: 'hm-1',
  household_id: 'h-1',
  user_id: 'u-1',
  role: 'owner',
  status: 'accepted',
  created_at: '2026-05-06',
}

describe('household permissions', () => {
  it('allows owner and admin to manage household data', () => {
    expect(canManageHousehold(owner)).toBe(true)
    expect(canManageHousehold({ ...owner, role: 'admin' })).toBe(true)
    expect(canManageHousehold({ ...owner, role: 'member' })).toBe(false)
  })

  it('requires accepted membership to view household data', () => {
    expect(canViewHousehold(owner)).toBe(true)
    expect(canViewHousehold({ ...owner, status: 'pending' })).toBe(false)
  })

  it('builds a stable default household name', () => {
    expect(getDefaultHouseholdName('Hubert')).toBe('Hubert 的家庭')
    expect(getDefaultHouseholdName('')).toBe('我的家庭')
  })
})
```

**Step 2: 验证失败**

Run:

```bash
npm test -- household.test.ts
```

Expected: FAIL，`../api/households` 不存在。

**Step 3: 实现 API**

Create `lib/api/households.ts`:

```ts
import { db } from '../insforge'
import type { Household, HouseholdMember, Subscription, User } from '../types'

export function getDefaultHouseholdName(name: string): string {
  const trimmed = name.trim()
  return trimmed ? `${trimmed} 的家庭` : '我的家庭'
}

export function canViewHousehold(member: HouseholdMember | null): boolean {
  return member?.status === 'accepted'
}

export function canManageHousehold(member: HouseholdMember | null): boolean {
  return member?.status === 'accepted' && (member.role === 'owner' || member.role === 'admin')
}

export async function createDefaultHousehold(user: User): Promise<Household> {
  const { data: household, error } = await db
    .from('households')
    .insert({
      owner_user_id: user.id,
      name: getDefaultHouseholdName(user.name),
    })
    .select()
    .single()
  if (error) throw error

  const { error: memberError } = await db.from('household_members').insert({
    household_id: household.id,
    user_id: user.id,
    role: 'owner',
    status: 'accepted',
    accepted_at: new Date().toISOString(),
  })
  if (memberError) throw memberError

  const { error: subscriptionError } = await db.from('subscriptions').insert({
    household_id: household.id,
    plan: 'free',
    status: 'trialing',
  })
  if (subscriptionError) throw subscriptionError

  return household as Household
}

export async function getHouseholdsForUser(userId: string): Promise<Household[]> {
  const { data, error } = await db
    .from('household_members')
    .select('households(*)')
    .eq('user_id', userId)
    .eq('status', 'accepted')
  if (error) throw error
  return (data || []).map((row: any) => row.households).filter(Boolean)
}

export async function getPrimaryHousehold(userId: string): Promise<Household | null> {
  const households = await getHouseholdsForUser(userId)
  return households[0] ?? null
}

export async function getHouseholdSubscription(householdId: string): Promise<Subscription | null> {
  const { data, error } = await db
    .from('subscriptions')
    .select('*')
    .eq('household_id', householdId)
    .maybeSingle()
  if (error) throw error
  return data
}
```

**Step 4: 注册后创建默认家庭**

Modify `lib/auth.tsx` after profile creation in `signUp`: import `createDefaultHousehold`, then call it when a new profile is created. Guard it so existing profiles do not create duplicate households.

**Step 5: 验证通过**

Run:

```bash
npm test -- household.test.ts
```

Expected: PASS。

**Step 6: Commit**

```bash
git add lib/api/households.ts lib/auth.tsx lib/__tests__/household.test.ts
git commit -m "feat: create default household for new users"
```

---

### Task 4: 增加订阅权益与额度校验

**Files:**
- Create: `lib/subscription.ts`
- Test: `lib/__tests__/subscription.test.ts`

**Step 1: 写失败测试**

Create `lib/__tests__/subscription.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  COMMERCIAL_PLANS,
  assertEntitlement,
  getEffectivePlan,
  isTrialActive,
} from '../subscription'
import type { Subscription } from '../types'

const trialing: Subscription = {
  household_id: 'h-1',
  plan: 'free',
  status: 'trialing',
  trial_start: '2026-05-01T00:00:00Z',
  trial_end: '2026-05-20T00:00:00Z',
  provider: 'manual',
  created_at: '2026-05-01T00:00:00Z',
  updated_at: '2026-05-01T00:00:00Z',
}

describe('subscription entitlements', () => {
  it('treats active trial as pro for evaluation', () => {
    expect(isTrialActive(trialing, new Date('2026-05-06'))).toBe(true)
    expect(getEffectivePlan(trialing, new Date('2026-05-06'))).toBe('pro')
  })

  it('falls back to free after trial ends', () => {
    expect(getEffectivePlan(trialing, new Date('2026-06-01'))).toBe('free')
  })

  it('blocks free card limit overflow', () => {
    expect(() => assertEntitlement('free', 'cards', COMMERCIAL_PLANS.free.limits.cards + 1))
      .toThrow('已达到 Free 套餐的 cards 限制')
  })

  it('allows pro higher limits', () => {
    expect(() => assertEntitlement('pro', 'cards', COMMERCIAL_PLANS.free.limits.cards + 1)).not.toThrow()
  })
})
```

**Step 2: 验证失败**

Run:

```bash
npm test -- subscription.test.ts
```

Expected: FAIL，`../subscription` 不存在。

**Step 3: 实现订阅逻辑**

Create `lib/subscription.ts`:

```ts
import type { Subscription } from './types'

export type CommercialPlan = 'free' | 'pro'
export type EntitlementMetric = 'holders' | 'cards' | 'monthly_imports' | 'monthly_exports' | 'advanced_reminders'

export class EntitlementError extends Error {
  constructor(
    public readonly plan: CommercialPlan,
    public readonly metric: EntitlementMetric,
    public readonly limit: number,
    public readonly attempted: number
  ) {
    super(`已达到 ${plan === 'free' ? 'Free' : 'Pro'} 套餐的 ${metric} 限制`)
  }
}

export const COMMERCIAL_PLANS: Record<CommercialPlan, { limits: Record<EntitlementMetric, number> }> = {
  free: {
    limits: {
      holders: 2,
      cards: 4,
      monthly_imports: 5,
      monthly_exports: 1,
      advanced_reminders: 0,
    },
  },
  pro: {
    limits: {
      holders: 12,
      cards: 50,
      monthly_imports: 200,
      monthly_exports: 100,
      advanced_reminders: 1,
    },
  },
}

export function isTrialActive(subscription: Subscription | null, now = new Date()): boolean {
  if (!subscription || subscription.status !== 'trialing') return false
  return new Date(subscription.trial_end).getTime() >= now.getTime()
}

export function getEffectivePlan(subscription: Subscription | null, now = new Date()): CommercialPlan {
  if (!subscription) return 'free'
  if (subscription.plan === 'pro' && subscription.status === 'active') return 'pro'
  if (isTrialActive(subscription, now)) return 'pro'
  return 'free'
}

export function assertEntitlement(plan: CommercialPlan, metric: EntitlementMetric, attempted: number): void {
  const limit = COMMERCIAL_PLANS[plan].limits[metric]
  if (attempted > limit) {
    throw new EntitlementError(plan, metric, limit, attempted)
  }
}
```

**Step 4: 验证通过**

Run:

```bash
npm test -- subscription.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add lib/subscription.ts lib/__tests__/subscription.test.ts
git commit -m "feat: add subscription entitlement rules"
```

---

### Task 5: 在创建持卡人与信用卡时接入额度校验

**Files:**
- Modify: `lib/api/holders.ts`
- Modify: `lib/api/cards.ts`
- Test: `lib/__tests__/subscription.test.ts`

**Step 1: 扩展测试覆盖 helper**

Update the existing import in `lib/__tests__/subscription.test.ts` so it also imports `getNextUsageCount`, then append the new `describe` block:

```ts
describe('usage helpers', () => {
  it('computes attempted count before writes', () => {
    expect(getNextUsageCount(3)).toBe(4)
  })
})
```

Expected: FAIL，`getNextUsageCount` 未导出。

**Step 2: 添加 helper**

Modify `lib/subscription.ts`:

```ts
export function getNextUsageCount(currentCount: number): number {
  return currentCount + 1
}
```

**Step 3: 改造 API 签名**

Modify `lib/api/holders.ts`:

```ts
export interface CreateHolderOptions {
  currentHolderCount?: number
  effectivePlan?: 'free' | 'pro'
}

export async function createHolder(
  holder: Omit<CardHolder, 'id' | 'created_at'>,
  options: CreateHolderOptions = {}
): Promise<CardHolder> {
  if (options.effectivePlan && options.currentHolderCount !== undefined) {
    assertEntitlement(options.effectivePlan, 'holders', getNextUsageCount(options.currentHolderCount))
  }
  // existing insert follows
}
```

Modify `lib/api/cards.ts` the same way with `CreateCardOptions`, `cards`, and `currentCardCount`.

**Step 4: 更新调用点**

Search:

```bash
rg -n "createHolder\\(|createCard\\(" app components lib
```

For form submissions, pass current counts when available. If a page does not yet have subscription context, leave options empty only for legacy paths that cannot yet identify a household; list those call sites in the commit message so they are explicit follow-up work.

**Step 5: 验证测试**

Run:

```bash
npm test -- subscription.test.ts
```

Expected: PASS。

**Step 6: Commit**

```bash
git add lib/subscription.ts lib/api/holders.ts lib/api/cards.ts lib/__tests__/subscription.test.ts
git commit -m "feat: enforce holder and card limits"
```

---

### Task 6: 增加家庭上下文 Provider 与 onboarding 入口

**Files:**
- Create: `lib/household.tsx`
- Modify: `app/layout.tsx`
- Modify: `components/mobile/MobileShell.tsx`
- Create: `app/onboarding/household/page.tsx`

**Step 1: 创建 Provider**

Create `lib/household.tsx` with:

```tsx
'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Household, Subscription } from './types'
import { useAuth } from './auth'
import { getHouseholdSubscription, getPrimaryHousehold } from './api/households'

interface HouseholdContextValue {
  household: Household | null
  subscription: Subscription | null
  loading: boolean
  reload: () => Promise<void>
}

const HouseholdContext = createContext<HouseholdContextValue | null>(null)

export function HouseholdProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [household, setHousehold] = useState<Household | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [loading, setLoading] = useState(true)

  const reload = async () => {
    if (!profile) {
      setHousehold(null)
      setSubscription(null)
      setLoading(false)
      return
    }
    setLoading(true)
    const h = await getPrimaryHousehold(profile.id)
    setHousehold(h)
    setSubscription(h ? await getHouseholdSubscription(h.id) : null)
    setLoading(false)
  }

  useEffect(() => { void reload() }, [profile?.id])

  return (
    <HouseholdContext.Provider value={{ household, subscription, loading, reload }}>
      {children}
    </HouseholdContext.Provider>
  )
}

export function useHousehold() {
  const ctx = useContext(HouseholdContext)
  if (!ctx) throw new Error('useHousehold must be inside HouseholdProvider')
  return ctx
}
```

**Step 2: 包装布局**

Modify `app/layout.tsx` to nest `HouseholdProvider` inside `AuthProvider`.

**Step 3: 缺家庭时跳转 onboarding**

Modify `components/mobile/MobileShell.tsx`: when logged in, profile loaded, and household context is not loading but `household` is null, redirect to `/onboarding/household`.

**Step 4: 创建 onboarding 页面**

Create `app/onboarding/household/page.tsx` with a simple MUI form using `createDefaultHousehold(profile)` and redirecting to `/`.

**Step 5: 手动验证**

Run:

```bash
npm test
```

Expected: existing Vitest suite passes.

**Step 6: Commit**

```bash
git add lib/household.tsx app/layout.tsx components/mobile/MobileShell.tsx app/onboarding/household/page.tsx
git commit -m "feat: add household context onboarding"
```

---

### Task 7: 成员邀请与绑定流程

**Files:**
- Create: `lib/api/memberInvites.ts`
- Modify: `lib/api/holders.ts`
- Modify: `components/mobile/HolderBindingDialog.tsx`
- Create: `lib/__tests__/memberInvites.test.ts`

**Step 1: 写邀请 token 测试**

Create `lib/__tests__/memberInvites.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createInviteToken, isInviteExpired } from '../api/memberInvites'

describe('member invites', () => {
  it('creates non-empty invite tokens', () => {
    expect(createInviteToken()).toHaveLength(48)
  })

  it('detects expired invites', () => {
    expect(isInviteExpired('2026-05-01T00:00:00Z', new Date('2026-05-06'))).toBe(true)
    expect(isInviteExpired('2026-05-10T00:00:00Z', new Date('2026-05-06'))).toBe(false)
  })
})
```

**Step 2: 实现邀请 API**

Create `lib/api/memberInvites.ts`:

```ts
import { db } from '../insforge'

export function createInviteToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function isInviteExpired(expiresAt: string, now = new Date()): boolean {
  return new Date(expiresAt).getTime() < now.getTime()
}

export async function inviteHouseholdMember(householdId: string, email: string, role: 'admin' | 'member') {
  const token = createInviteToken()
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 7)

  const { data, error } = await db
    .from('household_members')
    .insert({
      household_id: householdId,
      invited_email: email.trim().toLowerCase(),
      role,
      status: 'pending',
    })
    .select()
    .single()
  if (error) throw error

  return { invite: data, token, expiresAt: expiresAt.toISOString() }
}
```

**Step 3: 更新绑定流程**

Modify `components/mobile/HolderBindingDialog.tsx`: add household member invite option for holder email, show pending/accepted/revoked statuses, and call `bindHolderToUser` only after accepted user exists.

**Step 4: 验证**

Run:

```bash
npm test -- memberInvites.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add lib/api/memberInvites.ts lib/api/holders.ts components/mobile/HolderBindingDialog.tsx lib/__tests__/memberInvites.test.ts
git commit -m "feat: add household member invitations"
```

---

### Task 8: 账单导入草稿接入家庭和导入额度

**Files:**
- Modify: `lib/api/billDrafts.ts`
- Modify: `components/mobile/BillImportDialog.tsx`
- Test: `lib/__tests__/subscription.test.ts`

**Step 1: 扩展权益测试**

Append:

```ts
it('blocks free monthly import overflow', () => {
  expect(() => assertEntitlement('free', 'monthly_imports', COMMERCIAL_PLANS.free.limits.monthly_imports + 1))
    .toThrow('monthly_imports')
})
```

**Step 2: 改造 draft input**

Modify `lib/api/billDrafts.ts`:

```ts
export interface CreateDraftInput {
  created_by: string
  household_id: string
  card_id?: string
  source_type: BillImportDraft['source_type']
  raw_text?: string
  file_ref?: string
  parsed_payload: BillDraftPayload
  confidence?: number
  effectivePlan?: 'free' | 'pro'
  currentMonthlyImportCount?: number
}
```

Before insert:

```ts
if (input.effectivePlan && input.currentMonthlyImportCount !== undefined) {
  assertEntitlement(input.effectivePlan, 'monthly_imports', getNextUsageCount(input.currentMonthlyImportCount))
}
```

Insert `household_id`.

**Step 3: 更新 UI**

Modify `components/mobile/BillImportDialog.tsx`: read household/subscription context, pass `household_id`, effective plan, and current monthly import count into `createBillImportDraft`. Show upgrade message on `EntitlementError`.

**Step 4: 验证**

Run:

```bash
npm test -- subscription.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add lib/api/billDrafts.ts components/mobile/BillImportDialog.tsx lib/__tests__/subscription.test.ts
git commit -m "feat: gate bill imports by subscription"
```

---

### Task 9: 审计事件与关键操作记录

**Files:**
- Create: `lib/api/audit.ts`
- Modify: `lib/api/holders.ts`
- Modify: `lib/api/cards.ts`
- Modify: `lib/api/billDrafts.ts`
- Modify: `lib/api/payments.ts`
- Test: `lib/__tests__/audit.test.ts`

**Step 1: 写测试**

Create `lib/__tests__/audit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { buildAuditEvent } from '../api/audit'

describe('audit events', () => {
  it('builds append-only audit payloads', () => {
    const payload = buildAuditEvent({
      householdId: 'h-1',
      actorUserId: 'u-1',
      eventType: 'bill.confirmed',
      entityType: 'bill',
      entityId: 'b-1',
      metadata: { source: 'import' },
    })

    expect(payload.event_type).toBe('bill.confirmed')
    expect(payload.metadata).toEqual({ source: 'import' })
  })
})
```

**Step 2: 实现 audit API**

Create `lib/api/audit.ts`:

```ts
import { db } from '../insforge'

interface BuildAuditEventInput {
  householdId?: string
  actorUserId?: string
  eventType: string
  entityType: string
  entityId?: string
  metadata?: Record<string, unknown>
}

export function buildAuditEvent(input: BuildAuditEventInput) {
  return {
    household_id: input.householdId ?? null,
    actor_user_id: input.actorUserId ?? null,
    event_type: input.eventType,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
  }
}

export async function recordAuditEvent(input: BuildAuditEventInput): Promise<void> {
  const { error } = await db.from('audit_events').insert(buildAuditEvent(input))
  if (error) throw error
}
```

**Step 3: 接入关键操作**

After successful writes:

- `createHolder`: `holder.created`
- `createCard`: `card.created`
- `confirmBillImportDraft`: `bill.confirmed`
- `createPayment` in `lib/api/payments.ts`: `payment.created`

Do not let audit failure silently hide the main write failure during MVP; throw and fix if it fails.

**Step 4: 验证**

Run:

```bash
npm test -- audit.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add lib/api/audit.ts lib/api/holders.ts lib/api/cards.ts lib/api/billDrafts.ts lib/api/payments.ts lib/__tests__/audit.test.ts
git commit -m "feat: record commercial audit events"
```

---

### Task 10: 家庭报表与导出额度

**Files:**
- Modify: `lib/api/analytics.ts`
- Modify: `lib/export.ts`
- Modify: `components/mobile/ExportDialog.tsx`
- Test: `lib/__tests__/subscription.test.ts`

**Step 1: 扩展导出额度测试**

Append:

```ts
it('blocks free monthly export overflow', () => {
  expect(() => assertEntitlement('free', 'monthly_exports', COMMERCIAL_PLANS.free.limits.monthly_exports + 1))
    .toThrow('monthly_exports')
})
```

**Step 2: 给 analytics 增加 household filter**

Modify `lib/api/analytics.ts`: every report query should accept `household_id?: string` and filter through card holders or direct `household_id` where available.

**Step 3: 给 export 增加 entitlement options**

Modify `lib/export.ts` exported function signature:

```ts
interface ExportOptions {
  householdId: string
  effectivePlan?: 'free' | 'pro'
  currentMonthlyExportCount?: number
  // keep existing filters
}
```

Before generating CSV, call `assertEntitlement` for `monthly_exports`.

**Step 4: 更新导出 UI**

Modify `components/mobile/ExportDialog.tsx`: pass household context and show upgrade hint when export is blocked.

**Step 5: 验证**

Run:

```bash
npm test -- subscription.test.ts
```

Expected: PASS。

**Step 6: Commit**

```bash
git add lib/api/analytics.ts lib/export.ts components/mobile/ExportDialog.tsx lib/__tests__/subscription.test.ts
git commit -m "feat: add household export limits"
```

---

### Task 11: 运营控制台最小版

**Files:**
- Create: `lib/api/ops.ts`
- Create: `app/ops/page.tsx`
- Create: `lib/__tests__/ops.test.ts`

**Step 1: 写权限测试**

Create `lib/__tests__/ops.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { canAccessOps } from '../api/ops'
import type { User } from '../types'

const user: User = {
  id: 'u-1',
  auth_id: 'auth-1',
  email: 'admin@example.com',
  name: 'Admin',
  role: 'admin',
  created_at: '2026-05-06',
}

describe('ops access', () => {
  it('allows only configured internal admin emails', () => {
    expect(canAccessOps(user, ['admin@example.com'])).toBe(true)
    expect(canAccessOps({ ...user, email: 'user@example.com' }, ['admin@example.com'])).toBe(false)
  })
})
```

**Step 2: 实现 ops API**

Create `lib/api/ops.ts`:

```ts
import { db } from '../insforge'
import type { User } from '../types'

export function canAccessOps(user: User | null, internalAdminEmails: string[]): boolean {
  if (!user) return false
  return internalAdminEmails.map(e => e.toLowerCase()).includes(user.email.toLowerCase())
}

export async function getOpsOverview() {
  const [users, households, subscriptions, drafts] = await Promise.all([
    db.from('users').select('id', { count: 'exact', head: true }),
    db.from('households').select('id', { count: 'exact', head: true }),
    db.from('subscriptions').select('household_id, plan, status'),
    db.from('bill_import_drafts').select('id, status, created_at').order('created_at', { ascending: false }).limit(20),
  ])

  if (users.error) throw users.error
  if (households.error) throw households.error
  if (subscriptions.error) throw subscriptions.error
  if (drafts.error) throw drafts.error

  return {
    userCount: users.count ?? 0,
    householdCount: households.count ?? 0,
    subscriptions: subscriptions.data ?? [],
    recentDrafts: drafts.data ?? [],
  }
}
```

**Step 3: 创建页面**

Create `app/ops/page.tsx`: use `useAuth`, `canAccessOps`, and `getOpsOverview`; render user count, household count, subscription table, recent import draft table. Use environment variable `VITE_INTERNAL_ADMIN_EMAILS` or equivalent project pattern.

**Step 4: 验证**

Run:

```bash
npm test -- ops.test.ts
```

Expected: PASS。

**Step 5: Commit**

```bash
git add lib/api/ops.ts app/ops/page.tsx lib/__tests__/ops.test.ts
git commit -m "feat: add minimal ops console"
```

---

### Task 12: 信任页面、反馈入口和删除请求

**Files:**
- Create: `app/privacy/page.tsx`
- Create: `app/terms/page.tsx`
- Create: `lib/api/feedback.ts`
- Modify: `components/mobile/MobileShell.tsx`
- Test: `lib/__tests__/feedback.test.ts`

**Step 1: 写 feedback 测试**

Create `lib/__tests__/feedback.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { normalizeFeedbackMessage } from '../api/feedback'

describe('feedback', () => {
  it('trims feedback and rejects empty messages', () => {
    expect(normalizeFeedbackMessage('  hello  ')).toBe('hello')
    expect(() => normalizeFeedbackMessage('   ')).toThrow('反馈内容不能为空')
  })
})
```

**Step 2: 实现 feedback API**

Create `lib/api/feedback.ts`:

```ts
import { db } from '../insforge'

export function normalizeFeedbackMessage(message: string): string {
  const trimmed = message.trim()
  if (!trimmed) throw new Error('反馈内容不能为空')
  return trimmed
}

export async function createFeedbackMessage(userId: string, householdId: string | null, message: string): Promise<void> {
  const { error } = await db.from('feedback_messages').insert({
    user_id: userId,
    household_id: householdId,
    message: normalizeFeedbackMessage(message),
  })
  if (error) throw error
}
```

**Step 3: 创建隐私与条款页面**

Create `app/privacy/page.tsx` and `app/terms/page.tsx`. Content must include:

- 不保存完整卡号。
- 不发起还款或资金转移。
- 用户可导出和删除数据。
- 数据用于账单管理、提醒、报表和客服支持。

**Step 4: 增加入口**

Modify `components/mobile/MobileShell.tsx` or an existing settings area to expose links to `/privacy`, `/terms`, and feedback dialog.

**Step 5: 验证**

Run:

```bash
npm test -- feedback.test.ts
```

Expected: PASS。

**Step 6: Commit**

```bash
git add app/privacy/page.tsx app/terms/page.tsx lib/api/feedback.ts components/mobile/MobileShell.tsx lib/__tests__/feedback.test.ts
git commit -m "feat: add trust pages and feedback"
```

---

### Task 13: 商用主线验证

**Files:**
- Create: `docs/checklists/commercial-mvp-qa.md`
- Modify: `package.json`

**Step 1: 增加验证脚本**

Modify `package.json` scripts:

```json
{
  "scripts": {
    "test": "npx vitest run",
    "commercial:check": "npm test"
  }
}
```

Do not remove existing scripts.

**Step 2: 写 QA checklist**

Create `docs/checklists/commercial-mvp-qa.md`:

```md
# Commercial MVP QA

## 注册与家庭
- [ ] 新用户注册后存在业务 profile。
- [ ] 新用户存在默认家庭。
- [ ] 默认家庭存在 owner membership。
- [ ] 默认家庭存在 Free/trial subscription。

## 权限与协作
- [ ] Owner 能创建持卡人和卡片。
- [ ] Member 只能看到绑定持卡人的数据。
- [ ] Member 不能修改卡片和账单基础资料。

## 订阅限制
- [ ] Free 超过持卡人限制时阻止创建。
- [ ] Free 超过卡片限制时阻止创建。
- [ ] Free 超过导入限制时阻止导入。
- [ ] Pro 或有效试用可以通过更高限制。

## 账单导入
- [ ] 文本导入先创建草稿。
- [ ] 草稿确认前不写入正式账单。
- [ ] 重复账单被阻止。
- [ ] 金额不一致有警告。

## 提醒与导出
- [ ] 临近还款提醒出现。
- [ ] 已忽略提醒不重复显示。
- [ ] CSV 导出包含账单、还款、账单明细。
- [ ] Free 超出导出限制时展示升级提示。
```

**Step 3: 跑完整测试**

Run:

```bash
npm run commercial:check
```

Expected: all Vitest tests pass.

**Step 4: Commit**

```bash
git add package.json docs/checklists/commercial-mvp-qa.md
git commit -m "chore: add commercial mvp verification"
```

---

## Completion Criteria

商业 MVP 计划完成时，需要满足：

- `npm run commercial:check` 通过。
- 新用户注册后有默认家庭和试用订阅。
- 家庭边界存在于数据模型、API 和主要页面流程中。
- Free/Pro 限制至少覆盖持卡人、卡片、账单导入和导出。
- 文本账单导入仍然走草稿确认，不直接污染正式账单。
- 运营后台能查看用户/家庭/订阅/导入概况。
- 隐私、条款、反馈入口可访问。
- 每个任务均独立提交，未暂存无关工作区改动。
