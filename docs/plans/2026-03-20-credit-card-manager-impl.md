# WorldCredit Phase 1 实施计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 搭建基于 vinext + InsForge + MUI 的信用卡管理 PWA，实现持卡人、信用卡、账单/还款的完整 CRUD 和首页仪表盘。

**Architecture:** 前端使用 vinext（Vite + Next.js API）构建 React SPA，InsForge 提供 Postgres 数据库、Auth 和 Storage。手机端 PWA 采用 Material Design 风格，底部导航栏切换核心页面。数据通过 InsForge 自动生成的 REST API 读写。

**Tech Stack:** React 18, vinext, MUI v5, InsForge (Postgres + Auth), vite-plugin-pwa, TypeScript

---

## Task 1: 项目脚手架初始化

**目标：** 创建 vinext 项目，安装核心依赖，确保 dev server 可运行。

**Files:**
- Create: `package.json`
- Create: `vite.config.ts`
- Create: `next.config.ts`
- Create: `tsconfig.json`
- Create: `app/layout.tsx`
- Create: `app/page.tsx`

**Step 1: 初始化 vinext 项目**

```bash
cd /Users/hubo/Projects/worldcredit
npx -y create-vinext@latest ./
```

> 如果 create-vinext 不存在，手动初始化：
> ```bash
> npm init -y
> npm install vinext react react-dom
> npm install -D typescript @types/react @types/react-dom
> ```

**Step 2: 安装 MUI 和其他依赖**

```bash
npm install @mui/material @mui/icons-material @emotion/react @emotion/styled
npm install date-fns
```

**Step 3: 创建基础 app/layout.tsx**

```tsx
// app/layout.tsx
import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'WorldCredit - 信用卡管理',
  description: '家庭信用卡账单、还款、权益管理工具',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  )
}
```

**Step 4: 创建基础 app/page.tsx**

```tsx
// app/page.tsx
export default function Home() {
  return <h1>WorldCredit</h1>
}
```

**Step 5: 启动 dev server 验证**

```bash
npx vinext dev
```

Expected: 浏览器访问 http://localhost:3000 显示 "WorldCredit"

**Step 6: Commit**

```bash
git init
echo "node_modules/\n.next/\ndist/\n.env.local" > .gitignore
git add .
git commit -m "chore: init vinext project with MUI"
```

---

## Task 2: InsForge 配置与数据库 Schema

**目标：** 连接 InsForge，创建 9 张数据库表。

**Files:**
- Create: `lib/insforge.ts`
- Create: `lib/types.ts`
- Create: `db/schema.sql`

**Step 1: 注册并启动 InsForge**

访问 https://insforge.dev 注册项目，或本地 Docker 启动：

```bash
git clone https://github.com/insforge/insforge.git /tmp/insforge
cd /tmp/insforge
cp .env.example .env
docker compose -f docker-compose.prod.yml up -d
```

连接 InsForge MCP，获取项目 URL 和 API Key。

**Step 2: 安装 InsForge 客户端**

```bash
cd /Users/hubo/Projects/worldcredit
npm install @insforge/js
```

**Step 3: 创建数据库 Schema 文件**

```sql
-- db/schema.sql

-- 用户表（由 InsForge Auth 管理，这里扩展 profile）
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id UUID UNIQUE NOT NULL,  -- InsForge Auth 用户 ID
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 持卡人档案
CREATE TABLE IF NOT EXISTS card_holders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  managed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  auth_user_id UUID REFERENCES users(id),  -- Phase 3: 持卡人独立账号
  name TEXT NOT NULL,
  phone TEXT,
  avatar_color TEXT DEFAULT '#1976d2',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 信用卡
CREATE TABLE IF NOT EXISTS credit_cards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  holder_id UUID NOT NULL REFERENCES card_holders(id) ON DELETE CASCADE,
  country TEXT NOT NULL DEFAULT 'CN',
  bank_name TEXT NOT NULL,
  card_name TEXT NOT NULL,
  card_number_last4 TEXT,
  card_image_id TEXT,
  credit_limit NUMERIC NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'CNY',
  billing_day INT NOT NULL CHECK (billing_day BETWEEN 1 AND 31),
  payment_due_type TEXT NOT NULL DEFAULT 'after_billing'
    CHECK (payment_due_type IN ('fixed', 'after_billing')),
  payment_due_value INT NOT NULL DEFAULT 20,
  annual_fee NUMERIC DEFAULT 0,
  annual_fee_waiver TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'frozen', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 账单
CREATE TABLE IF NOT EXISTS bills (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  bill_month TEXT NOT NULL,  -- '2026-03'
  statement_start DATE,
  statement_end DATE,
  statement_date DATE,
  bill_amount NUMERIC NOT NULL DEFAULT 0,
  min_payment NUMERIC DEFAULT 0,
  due_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid'
    CHECK (status IN ('unpaid', 'partial', 'paid', 'overdue')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(card_id, bill_month)
);

-- 还款记录
CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bill_id UUID NOT NULL REFERENCES bills(id) ON DELETE CASCADE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  paid_at DATE NOT NULL DEFAULT CURRENT_DATE,
  channel TEXT DEFAULT '手动还款',
  note TEXT,
  idempotency_key TEXT UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 权益定义
CREATE TABLE IF NOT EXISTS benefits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  quota INT NOT NULL DEFAULT 1,
  period TEXT NOT NULL DEFAULT 'yearly'
    CHECK (period IN ('yearly', 'monthly', 'one_time')),
  reset_month INT CHECK (reset_month BETWEEN 1 AND 12),
  expiry_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 权益使用记录
CREATE TABLE IF NOT EXISTS benefit_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  benefit_id UUID NOT NULL REFERENCES benefits(id) ON DELETE CASCADE,
  used_at DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 优惠活动定义
CREATE TABLE IF NOT EXISTS promos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id UUID REFERENCES credit_cards(id) ON DELETE SET NULL,
  bank_name TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  discount_type TEXT CHECK (discount_type IN ('满减', '折扣', '积分', '返现')),
  start_date DATE,
  end_date DATE,
  conditions TEXT,
  max_uses INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 优惠使用记录
CREATE TABLE IF NOT EXISTS promo_usages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promo_id UUID NOT NULL REFERENCES promos(id) ON DELETE CASCADE,
  card_id UUID REFERENCES credit_cards(id) ON DELETE SET NULL,
  used_at DATE NOT NULL DEFAULT CURRENT_DATE,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 索引
CREATE INDEX idx_card_holders_managed_by ON card_holders(managed_by);
CREATE INDEX idx_credit_cards_holder ON credit_cards(holder_id);
CREATE INDEX idx_bills_card ON bills(card_id);
CREATE INDEX idx_bills_due_date ON bills(due_date);
CREATE INDEX idx_payments_bill ON payments(bill_id);
CREATE INDEX idx_benefit_usages_benefit ON benefit_usages(benefit_id);
CREATE INDEX idx_promo_usages_promo ON promo_usages(promo_id);
```

**Step 4: 通过 InsForge 执行 schema**

使用 InsForge 控制台或 MCP 工具执行 `db/schema.sql`。

**Step 5: 创建 InsForge 客户端配置**

```ts
// lib/insforge.ts
import { createClient } from '@insforge/js'

const insforgeUrl = process.env.NEXT_PUBLIC_INSFORGE_URL!
const insforgeKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY!

export const insforge = createClient(insforgeUrl, insforgeKey)
```

**Step 6: 创建 TypeScript 类型定义**

```ts
// lib/types.ts

export interface User {
  id: string
  auth_id: string
  email: string
  name: string
  role: 'admin' | 'member'
  created_at: string
}

export interface CardHolder {
  id: string
  managed_by: string
  auth_user_id?: string
  name: string
  phone?: string
  avatar_color: string
  created_at: string
}

export interface CreditCard {
  id: string
  holder_id: string
  country: string
  bank_name: string
  card_name: string
  card_number_last4?: string
  card_image_id?: string
  credit_limit: number
  currency: string
  billing_day: number
  payment_due_type: 'fixed' | 'after_billing'
  payment_due_value: number
  annual_fee: number
  annual_fee_waiver?: string
  status: 'active' | 'frozen' | 'cancelled'
  created_at: string
}

export interface Bill {
  id: string
  card_id: string
  bill_month: string
  statement_start?: string
  statement_end?: string
  statement_date?: string
  bill_amount: number
  min_payment: number
  due_date: string
  status: 'unpaid' | 'partial' | 'paid' | 'overdue'
  created_at: string
}

export interface Payment {
  id: string
  bill_id: string
  amount: number
  paid_at: string
  channel: string
  note?: string
  idempotency_key: string
  created_at: string
}

export interface Benefit {
  id: string
  card_id: string
  name: string
  description?: string
  quota: number
  period: 'yearly' | 'monthly' | 'one_time'
  reset_month?: number
  expiry_date?: string
  created_at: string
}

export interface BenefitUsage {
  id: string
  benefit_id: string
  used_at: string
  note?: string
  created_at: string
}

export interface Promo {
  id: string
  card_id?: string
  bank_name: string
  title: string
  description?: string
  discount_type?: '满减' | '折扣' | '积分' | '返现'
  start_date?: string
  end_date?: string
  conditions?: string
  max_uses?: number
  created_at: string
}

export interface PromoUsage {
  id: string
  promo_id: string
  card_id?: string
  used_at: string
  note?: string
  created_at: string
}
```

**Step 7: 创建环境变量文件**

```bash
# .env.local
NEXT_PUBLIC_INSFORGE_URL=http://localhost:7130
NEXT_PUBLIC_INSFORGE_ANON_KEY=your-anon-key-here
```

**Step 8: Commit**

```bash
git add .
git commit -m "feat: add InsForge config and database schema (9 tables)"
```

---

## Task 3: Auth 登录流程

**目标：** 实现管理员邮箱/密码登录，保护所有页面。

**Files:**
- Create: `app/login/page.tsx`
- Create: `lib/auth.tsx`
- Modify: `app/layout.tsx`

**Step 1: 创建 Auth Context**

```tsx
// lib/auth.tsx
'use client'

import { createContext, useContext, useEffect, useState, ReactNode } from 'react'
import { insforge } from './insforge'

interface AuthContextType {
  user: any | null
  loading: boolean
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // 检查当前登录状态
    insforge.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null)
      setLoading(false)
    })

    // 监听登录状态变化
    const { data: { subscription } } = insforge.auth.onAuthStateChange(
      (_event, session) => setUser(session?.user ?? null)
    )
    return () => subscription.unsubscribe()
  }, [])

  const signIn = async (email: string, password: string) => {
    const { error } = await insforge.auth.signInWithPassword({ email, password })
    if (error) throw error
  }

  const signOut = async () => {
    await insforge.auth.signOut()
  }

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be inside AuthProvider')
  return ctx
}
```

**Step 2: 创建登录页面**

```tsx
// app/login/page.tsx
'use client'

import { useState } from 'react'
import {
  Box, Card, CardContent, TextField, Button,
  Typography, Alert, CircularProgress
} from '@mui/material'
import { CreditCard as CreditCardIcon } from '@mui/icons-material'
import { useAuth } from '@/lib/auth'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { signIn } = useAuth()
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
      router.push('/')
    } catch (err: any) {
      setError(err.message || '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box sx={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      p: 2,
    }}>
      <Card sx={{ maxWidth: 400, width: '100%' }}>
        <CardContent sx={{ p: 4 }}>
          <Box sx={{ textAlign: 'center', mb: 3 }}>
            <CreditCardIcon sx={{ fontSize: 48, color: 'primary.main' }} />
            <Typography variant="h5" fontWeight={700} mt={1}>
              WorldCredit
            </Typography>
            <Typography color="text.secondary" variant="body2">
              信用卡管理
            </Typography>
          </Box>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <form onSubmit={handleSubmit}>
            <TextField
              fullWidth label="邮箱" type="email" margin="normal"
              value={email} onChange={e => setEmail(e.target.value)}
              required autoFocus
            />
            <TextField
              fullWidth label="密码" type="password" margin="normal"
              value={password} onChange={e => setPassword(e.target.value)}
              required
            />
            <Button
              fullWidth variant="contained" type="submit" size="large"
              disabled={loading} sx={{ mt: 2 }}
            >
              {loading ? <CircularProgress size={24} /> : '登录'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </Box>
  )
}
```

**Step 3: 更新 layout.tsx 集成 Auth + MUI 主题**

```tsx
// app/layout.tsx
import type { Metadata } from 'next'
import { ThemeRegistry } from '@/components/ThemeRegistry'
import { AuthProvider } from '@/lib/auth'

export const metadata: Metadata = {
  title: 'WorldCredit - 信用卡管理',
  description: '家庭信用卡账单、还款、权益管理工具',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <ThemeRegistry>
          <AuthProvider>
            {children}
          </AuthProvider>
        </ThemeRegistry>
      </body>
    </html>
  )
}
```

**Step 4: 创建 MUI 主题注册**

```tsx
// components/ThemeRegistry.tsx
'use client'

import { ThemeProvider, createTheme, CssBaseline } from '@mui/material'
import { ReactNode } from 'react'

const theme = createTheme({
  palette: {
    primary: { main: '#1976d2' },
    secondary: { main: '#9c27b0' },
  },
  typography: {
    fontFamily: '"Roboto", "Noto Sans SC", sans-serif',
  },
  shape: { borderRadius: 12 },
})

export function ThemeRegistry({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  )
}
```

**Step 5: 验证登录页面渲染**

```bash
npx vinext dev
```

Expected: 访问 /login 显示 Material Design 风格的登录表单

**Step 6: Commit**

```bash
git add .
git commit -m "feat: add auth flow with login page and MUI theme"
```

---

## Task 4: 手机端基础布局（底部导航 + 路由保护）

**目标：** 创建手机端 shell——底部导航栏 + 页面路由保护（未登录跳转登录页）。

**Files:**
- Create: `components/mobile/BottomNav.tsx`
- Create: `components/mobile/MobileShell.tsx`
- Create: `app/(mobile)/layout.tsx`

**Step 1: 创建底部导航栏组件**

```tsx
// components/mobile/BottomNav.tsx
'use client'

import { usePathname, useRouter } from 'next/navigation'
import { BottomNavigation, BottomNavigationAction, Paper } from '@mui/material'
import {
  Dashboard as DashboardIcon,
  People as PeopleIcon,
  Receipt as ReceiptIcon,
  LocalOffer as PromoIcon,
} from '@mui/icons-material'

const navItems = [
  { label: '首页', icon: <DashboardIcon />, path: '/' },
  { label: '持卡人', icon: <PeopleIcon />, path: '/holders' },
  { label: '账单', icon: <ReceiptIcon />, path: '/bills' },
  { label: '优惠', icon: <PromoIcon />, path: '/promos' },
]

export function BottomNav() {
  const pathname = usePathname()
  const router = useRouter()
  const currentIndex = navItems.findIndex(item =>
    pathname === item.path || pathname.startsWith(item.path + '/')
  )

  return (
    <Paper
      sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1000 }}
      elevation={3}
    >
      <BottomNavigation
        value={currentIndex === -1 ? 0 : currentIndex}
        onChange={(_, newValue) => router.push(navItems[newValue].path)}
        showLabels
      >
        {navItems.map(item => (
          <BottomNavigationAction
            key={item.path}
            label={item.label}
            icon={item.icon}
          />
        ))}
      </BottomNavigation>
    </Paper>
  )
}
```

**Step 2: 创建路由保护 + 手机端外壳**

```tsx
// components/mobile/MobileShell.tsx
'use client'

import { useEffect, ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Box, CircularProgress } from '@mui/material'
import { useAuth } from '@/lib/auth'
import { BottomNav } from './BottomNav'

export function MobileShell({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) router.replace('/login')
  }, [user, loading, router])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    )
  }

  if (!user) return null

  return (
    <Box sx={{ pb: 7, minHeight: '100vh', bgcolor: 'grey.50' }}>
      {children}
      <BottomNav />
    </Box>
  )
}
```

**Step 3: 创建手机端路由组布局**

```tsx
// app/(mobile)/layout.tsx
import { MobileShell } from '@/components/mobile/MobileShell'

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return <MobileShell>{children}</MobileShell>
}
```

**Step 4: 将首页移到路由组下**

将 `app/page.tsx` 移动到 `app/(mobile)/page.tsx`，创建占位页面：

```tsx
// app/(mobile)/page.tsx
'use client'

import { Box, Typography } from '@mui/material'

export default function HomePage() {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" fontWeight={700}>WorldCredit</Typography>
      <Typography color="text.secondary">首页仪表盘（待实现）</Typography>
    </Box>
  )
}
```

同样创建占位路由：
- `app/(mobile)/holders/page.tsx`
- `app/(mobile)/bills/page.tsx`
- `app/(mobile)/promos/page.tsx`

**Step 5: 验证底部导航和路由切换**

Expected: 四个 Tab 可切换，未登录自动跳转 /login

**Step 6: Commit**

```bash
git add .
git commit -m "feat: add mobile shell with bottom nav and route protection"
```

---

## Task 5: 持卡人模块 CRUD

**目标：** 实现持卡人列表、添加、编辑、删除功能。

**Files:**
- Create: `lib/api/holders.ts`
- Create: `app/(mobile)/holders/page.tsx`
- Create: `app/(mobile)/holders/[id]/page.tsx`
- Create: `components/mobile/HolderCard.tsx`
- Create: `components/mobile/HolderForm.tsx`

**Step 1: 创建持卡人 API 层**

```ts
// lib/api/holders.ts
import { insforge } from '../insforge'
import type { CardHolder } from '../types'

export async function getHolders(): Promise<CardHolder[]> {
  const { data, error } = await insforge
    .from('card_holders')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getHolder(id: string): Promise<CardHolder> {
  const { data, error } = await insforge
    .from('card_holders')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createHolder(holder: Omit<CardHolder, 'id' | 'created_at'>): Promise<CardHolder> {
  const { data, error } = await insforge
    .from('card_holders')
    .insert(holder)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateHolder(id: string, updates: Partial<CardHolder>): Promise<CardHolder> {
  const { data, error } = await insforge
    .from('card_holders')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteHolder(id: string): Promise<void> {
  const { error } = await insforge
    .from('card_holders')
    .delete()
    .eq('id', id)
  if (error) throw error
}
```

**Step 2: 创建持卡人卡片组件**

```tsx
// components/mobile/HolderCard.tsx
'use client'

import { Avatar, Card, CardActionArea, CardContent, Typography, Box, Chip } from '@mui/material'
import type { CardHolder } from '@/lib/types'

interface Props {
  holder: CardHolder
  cardCount: number
  onClick: () => void
}

export function HolderCard({ holder, cardCount, onClick }: Props) {
  return (
    <Card sx={{ mb: 1.5 }}>
      <CardActionArea onClick={onClick}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar sx={{ bgcolor: holder.avatar_color, width: 48, height: 48 }}>
            {holder.name.charAt(0)}
          </Avatar>
          <Box sx={{ flex: 1 }}>
            <Typography variant="subtitle1" fontWeight={600}>
              {holder.name}
            </Typography>
            {holder.phone && (
              <Typography variant="body2" color="text.secondary">
                {holder.phone}
              </Typography>
            )}
          </Box>
          <Chip label={`${cardCount} 张卡`} size="small" />
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
```

**Step 3: 创建添加/编辑表单组件**

```tsx
// components/mobile/HolderForm.tsx
'use client'

import { useState } from 'react'
import {
  Dialog, DialogTitle, DialogContent, DialogActions,
  TextField, Button, Box
} from '@mui/material'
import type { CardHolder } from '@/lib/types'

const COLORS = ['#1976d2', '#d32f2f', '#388e3c', '#f57c00', '#7b1fa2', '#00796b']

interface Props {
  open: boolean
  onClose: () => void
  onSubmit: (data: { name: string; phone?: string; avatar_color: string }) => void
  initial?: CardHolder
}

export function HolderForm({ open, onClose, onSubmit, initial }: Props) {
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [color, setColor] = useState(initial?.avatar_color ?? COLORS[0])

  const handleSubmit = () => {
    if (!name.trim()) return
    onSubmit({ name: name.trim(), phone: phone.trim() || undefined, avatar_color: color })
    onClose()
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>{initial ? '编辑持卡人' : '添加持卡人'}</DialogTitle>
      <DialogContent>
        <TextField
          fullWidth label="姓名" margin="normal" required
          value={name} onChange={e => setName(e.target.value)}
          autoFocus
        />
        <TextField
          fullWidth label="手机号" margin="normal"
          value={phone} onChange={e => setPhone(e.target.value)}
        />
        <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          {COLORS.map(c => (
            <Box
              key={c}
              onClick={() => setColor(c)}
              sx={{
                width: 36, height: 36, borderRadius: '50%', bgcolor: c, cursor: 'pointer',
                border: c === color ? '3px solid #000' : '3px solid transparent',
              }}
            />
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>取消</Button>
        <Button variant="contained" onClick={handleSubmit}>保存</Button>
      </DialogActions>
    </Dialog>
  )
}
```

**Step 4: 实现持卡人列表页面**

```tsx
// app/(mobile)/holders/page.tsx
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Box, Typography, Fab, Skeleton } from '@mui/material'
import { Add as AddIcon } from '@mui/icons-material'
import { getHolders, createHolder } from '@/lib/api/holders'
import { HolderCard } from '@/components/mobile/HolderCard'
import { HolderForm } from '@/components/mobile/HolderForm'
import { useAuth } from '@/lib/auth'
import type { CardHolder } from '@/lib/types'

export default function HoldersPage() {
  const [holders, setHolders] = useState<CardHolder[]>([])
  const [loading, setLoading] = useState(true)
  const [formOpen, setFormOpen] = useState(false)
  const { user } = useAuth()
  const router = useRouter()

  const loadHolders = useCallback(async () => {
    try {
      const data = await getHolders()
      setHolders(data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadHolders() }, [loadHolders])

  const handleCreate = async (data: { name: string; phone?: string; avatar_color: string }) => {
    await createHolder({ ...data, managed_by: user!.id })
    loadHolders()
  }

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" fontWeight={700} sx={{ mb: 2 }}>持卡人</Typography>

      {loading ? (
        Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} variant="rounded" height={80} sx={{ mb: 1.5 }} />
        ))
      ) : holders.length === 0 ? (
        <Typography color="text.secondary" textAlign="center" sx={{ mt: 4 }}>
          还没有持卡人，点击右下角添加
        </Typography>
      ) : (
        holders.map(h => (
          <HolderCard
            key={h.id}
            holder={h}
            cardCount={0}  // TODO: 从 credit_cards 查询
            onClick={() => router.push(`/holders/${h.id}`)}
          />
        ))
      )}

      <Fab
        color="primary"
        sx={{ position: 'fixed', bottom: 72, right: 16 }}
        onClick={() => setFormOpen(true)}
      >
        <AddIcon />
      </Fab>

      <HolderForm
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSubmit={handleCreate}
      />
    </Box>
  )
}
```

**Step 5: 创建持卡人详情页（卡片列表入口）**

```tsx
// app/(mobile)/holders/[id]/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Box, Typography, IconButton, Skeleton } from '@mui/material'
import { ArrowBack } from '@mui/icons-material'
import { getHolder } from '@/lib/api/holders'
import type { CardHolder } from '@/lib/types'

export default function HolderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [holder, setHolder] = useState<CardHolder | null>(null)
  const router = useRouter()

  useEffect(() => {
    getHolder(id).then(setHolder)
  }, [id])

  if (!holder) return <Skeleton variant="rounded" height={200} sx={{ m: 2 }} />

  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
        <IconButton onClick={() => router.back()}>
          <ArrowBack />
        </IconButton>
        <Typography variant="h6" fontWeight={700}>{holder.name}</Typography>
      </Box>
      <Typography color="text.secondary">
        信用卡列表（Task 6 实现）
      </Typography>
    </Box>
  )
}
```

**Step 6: 验证持卡人 CRUD 功能**

Expected: 可添加持卡人、查看列表、点击进入详情

**Step 7: Commit**

```bash
git add .
git commit -m "feat: add card holder CRUD with list and form"
```

---

## Task 6: 信用卡模块 CRUD

**目标：** 实现信用卡添加、编辑、详情查看，在持卡人详情页展示卡片列表。

**Files:**
- Create: `lib/api/cards.ts`
- Create: `lib/utils.ts`
- Create: `components/mobile/CreditCardVisual.tsx`
- Create: `components/mobile/CardForm.tsx`
- Create: `app/(mobile)/cards/[id]/page.tsx`
- Modify: `app/(mobile)/holders/[id]/page.tsx`

**Step 1: 创建信用卡 API 层**

```ts
// lib/api/cards.ts
import { insforge } from '../insforge'
import type { CreditCard } from '../types'

export async function getCardsByHolder(holderId: string): Promise<CreditCard[]> {
  const { data, error } = await insforge
    .from('credit_cards')
    .select('*')
    .eq('holder_id', holderId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data
}

export async function getCard(id: string): Promise<CreditCard> {
  const { data, error } = await insforge
    .from('credit_cards')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return data
}

export async function createCard(card: Omit<CreditCard, 'id' | 'created_at'>): Promise<CreditCard> {
  const { data, error } = await insforge
    .from('credit_cards')
    .insert(card)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCard(id: string, updates: Partial<CreditCard>): Promise<CreditCard> {
  const { data, error } = await insforge
    .from('credit_cards')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function deleteCard(id: string): Promise<void> {
  const { error } = await insforge
    .from('credit_cards')
    .delete()
    .eq('id', id)
  if (error) throw error
}
```

**Step 2: 创建工具函数（还款日计算、额度计算）**

```ts
// lib/utils.ts
import { addDays, setDate, lastDayOfMonth, format } from 'date-fns'
import type { CreditCard } from './types'

/**
 * 计算实际账单日（处理 billing_day > 当月最后一天的情况）
 */
export function getActualBillingDate(billingDay: number, month: Date): Date {
  const lastDay = lastDayOfMonth(month).getDate()
  const actualDay = Math.min(billingDay, lastDay)
  return setDate(month, actualDay)
}

/**
 * 计算还款截止日
 */
export function getDueDate(card: CreditCard, billMonth: Date): Date {
  if (card.payment_due_type === 'fixed') {
    const lastDay = lastDayOfMonth(billMonth).getDate()
    const actualDay = Math.min(card.payment_due_value, lastDay)
    return setDate(billMonth, actualDay)
  } else {
    const billingDate = getActualBillingDate(card.billing_day, billMonth)
    return addDays(billingDate, card.payment_due_value)
  }
}

/**
 * 格式化金额
 */
export function formatAmount(amount: number, currency: string = 'CNY'): string {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount)
}

/**
 * 生成幂等键
 */
export function generateIdempotencyKey(): string {
  return crypto.randomUUID()
}
```

**Step 3: 创建信用卡视觉组件**

```tsx
// components/mobile/CreditCardVisual.tsx
'use client'

import { Card, CardActionArea, CardContent, Typography, Box, LinearProgress } from '@mui/material'
import { CreditCard as CreditCardIcon } from '@mui/icons-material'
import { formatAmount } from '@/lib/utils'
import type { CreditCard } from '@/lib/types'

interface Props {
  card: CreditCard
  usedAmount?: number  // 从账单计算得出
  onClick?: () => void
}

export function CreditCardVisual({ card, usedAmount = 0, onClick }: Props) {
  const available = card.credit_limit - usedAmount
  const usagePercent = card.credit_limit > 0 ? (usedAmount / card.credit_limit) * 100 : 0

  return (
    <Card sx={{ mb: 1.5 }}>
      <CardActionArea onClick={onClick}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <CreditCardIcon color="primary" />
            <Box>
              <Typography variant="subtitle2" fontWeight={600}>
                {card.bank_name}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {card.card_name} {card.card_number_last4 ? `•••• ${card.card_number_last4}` : ''}
              </Typography>
            </Box>
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              已用 {formatAmount(usedAmount, card.currency)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              额度 {formatAmount(card.credit_limit, card.currency)}
            </Typography>
          </Box>

          <LinearProgress
            variant="determinate"
            value={Math.min(usagePercent, 100)}
            color={usagePercent > 80 ? 'error' : usagePercent > 50 ? 'warning' : 'primary'}
            sx={{ height: 6, borderRadius: 3 }}
          />

          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            可用 {formatAmount(available, card.currency)}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  )
}
```

**Step 4: 创建信用卡表单组件**

一个 Dialog 表单，字段：国别、银行名、卡名、卡号后四位、额度、币种、账单日、还款日类型/数值、年费、免年费条件。

> 代码较长，使用 MUI 的 TextField + Select 构建，此处省略完整实现，
> 实施时根据 `CreditCard` 类型定义的字段生成表单。

**Step 5: 更新持卡人详情页，展示信用卡列表**

在 `app/(mobile)/holders/[id]/page.tsx` 中引入 `getCardsByHolder`，展示 `CreditCardVisual` 列表。

**Step 6: 创建信用卡详情页**

```tsx
// app/(mobile)/cards/[id]/page.tsx
```

展示卡片完整信息、额度、当前账单、权益和优惠（后两个在 Phase 2 实现）。

**Step 7: 验证信用卡 CRUD**

Expected: 在持卡人详情中可添加/查看信用卡，点击进入卡片详情

**Step 8: Commit**

```bash
git add .
git commit -m "feat: add credit card CRUD with visual component"
```

---

## Task 7: 账单 + 还款模块

**目标：** 实现账单录入、还款记录、账单列表、还款状态追踪。

**Files:**
- Create: `lib/api/bills.ts`
- Create: `lib/api/payments.ts`
- Create: `components/mobile/BillCard.tsx`
- Create: `components/mobile/BillForm.tsx`
- Create: `components/mobile/PaymentForm.tsx`
- Create: `app/(mobile)/bills/page.tsx`

**Step 1: 创建账单 API 层**

```ts
// lib/api/bills.ts
import { insforge } from '../insforge'
import type { Bill } from '../types'

export async function getBills(cardId?: string): Promise<Bill[]> {
  let query = insforge
    .from('bills')
    .select('*, credit_cards(bank_name, card_name, card_number_last4, currency)')
    .order('due_date', { ascending: true })

  if (cardId) query = query.eq('card_id', cardId)

  const { data, error } = await query
  if (error) throw error
  return data
}

export async function getUnpaidBills(): Promise<Bill[]> {
  const { data, error } = await insforge
    .from('bills')
    .select('*, credit_cards(bank_name, card_name, currency, holder_id)')
    .in('status', ['unpaid', 'partial', 'overdue'])
    .order('due_date', { ascending: true })
  if (error) throw error
  return data
}

export async function createBill(bill: Omit<Bill, 'id' | 'created_at'>): Promise<Bill> {
  const { data, error } = await insforge
    .from('bills')
    .insert(bill)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateBillStatus(billId: string, status: Bill['status']): Promise<void> {
  const { error } = await insforge
    .from('bills')
    .update({ status })
    .eq('id', billId)
  if (error) throw error
}
```

**Step 2: 创建还款 API 层**

```ts
// lib/api/payments.ts
import { insforge } from '../insforge'
import type { Payment } from '../types'
import { generateIdempotencyKey } from '../utils'

export async function getPaymentsByBill(billId: string): Promise<Payment[]> {
  const { data, error } = await insforge
    .from('payments')
    .select('*')
    .eq('bill_id', billId)
    .order('paid_at', { ascending: false })
  if (error) throw error
  return data
}

export async function createPayment(
  payment: Omit<Payment, 'id' | 'created_at' | 'idempotency_key'>
): Promise<Payment> {
  const { data, error } = await insforge
    .from('payments')
    .insert({ ...payment, idempotency_key: generateIdempotencyKey() })
    .select()
    .single()
  if (error) throw error
  return data
}

/**
 * 根据还款记录计算账单已还金额，并更新账单状态
 */
export async function recalcBillStatus(billId: string, billAmount: number): Promise<void> {
  const payments = await getPaymentsByBill(billId)
  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0)

  let status: 'unpaid' | 'partial' | 'paid'
  if (totalPaid >= billAmount) status = 'paid'
  else if (totalPaid > 0) status = 'partial'
  else status = 'unpaid'

  const { error } = await insforge
    .from('bills')
    .update({ status })
    .eq('id', billId)
  if (error) throw error
}
```

**Step 3: 创建账单卡片组件**

带颜色状态指示（绿色已还 / 黄色部分 / 红色逾期 / 灰色待还），
显示银行名、卡名、账单金额、还款进度、距还款日倒计时。

**Step 4: 创建账单录入 + 还款表单**

**Step 5: 实现账单列表页面**

按月份分组显示，可切换月份。

**Step 6: 在卡片详情页集成账单和额度计算**

额度 = `credit_limit - SUM(unpaid bills amount - paid amount)`

**Step 7: 验证**

Expected: 可录入账单、添加还款、查看状态变化、额度实时更新

**Step 8: Commit**

```bash
git add .
git commit -m "feat: add bill and payment management with status tracking"
```

---

## Task 8: 首页仪表盘

**目标：** 实现首页还款概览、还款日提醒、持卡人快速入口。

**Files:**
- Modify: `app/(mobile)/page.tsx`
- Create: `components/mobile/DashboardSummary.tsx`
- Create: `components/mobile/UpcomingBills.tsx`

**Step 1: 创建还款概览组件**

展示本月总待还、已还进度条、各持卡人汇总。

**Step 2: 创建即将到期账单组件**

倒计时卡片，按紧急程度排序（今天 / 3天内 / 7天内）。

**Step 3: 组装首页**

```tsx
// app/(mobile)/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { Box, Typography } from '@mui/material'
import { DashboardSummary } from '@/components/mobile/DashboardSummary'
import { UpcomingBills } from '@/components/mobile/UpcomingBills'
import { getUnpaidBills } from '@/lib/api/bills'
import { getHolders } from '@/lib/api/holders'

export default function HomePage() {
  const [bills, setBills] = useState([])
  const [holders, setHolders] = useState([])

  useEffect(() => {
    getUnpaidBills().then(setBills)
    getHolders().then(setHolders)
  }, [])

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5" fontWeight={700} sx={{ mb: 2 }}>
        WorldCredit
      </Typography>
      <DashboardSummary bills={bills} />
      <UpcomingBills bills={bills} />
    </Box>
  )
}
```

**Step 4: 验证仪表盘数据展示**

Expected: 显示待还总额、进度条、即将到期的账单卡片

**Step 5: Commit**

```bash
git add .
git commit -m "feat: add dashboard with billing summary and upcoming bills"
```

---

## Task 9: PWA 配置

**目标：** 配置 PWA manifest、Service Worker、离线缓存。

**Files:**
- Create: `public/manifest.json`
- Modify: `vite.config.ts` 或 `next.config.ts`
- Modify: `app/layout.tsx`

**Step 1: 安装 PWA 插件**

```bash
npm install vite-plugin-pwa
```

**Step 2: 创建 manifest.json**

```json
{
  "name": "WorldCredit - 信用卡管理",
  "short_name": "WorldCredit",
  "description": "家庭信用卡账单、还款、权益管理",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#1976d2",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

**Step 3: 配置 Vite PWA 插件**

在 vite.config.ts 中添加 VitePWA 插件配置，启用离线缓存策略。

**Step 4: 在 layout.tsx 中添加 manifest 链接和 meta 标签**

```html
<link rel="manifest" href="/manifest.json" />
<meta name="theme-color" content="#1976d2" />
<meta name="apple-mobile-web-app-capable" content="yes" />
```

**Step 5: 验证 PWA 安装提示**

在手机浏览器中访问，确认"添加到主屏幕"可用。

**Step 6: Commit**

```bash
git add .
git commit -m "feat: add PWA manifest and service worker"
```

---

## Task 10: 部署到 Cloudflare Workers

**目标：** 使用 vinext deploy 部署到 Cloudflare Workers。

**Step 1: 配置 Cloudflare**

确保已安装 wrangler 并已登录：

```bash
npx wrangler login
```

**Step 2: 部署**

```bash
npx vinext deploy
```

**Step 3: 验证线上访问**

Expected: 可在手机浏览器中访问部署后的 URL，所有功能正常。

**Step 4: Commit**

```bash
git add .
git commit -m "chore: configure cloudflare workers deployment"
```

---

## 依赖关系

```text
Task 1 (脚手架) → Task 2 (数据库) → Task 3 (Auth)
                                           ↓
                   Task 4 (布局) ←──────────┘
                       ↓
        ┌──────────────┼──────────────┐
        ↓              ↓              ↓
   Task 5 (持卡人) → Task 6 (信用卡) → Task 7 (账单)
                                           ↓
                                      Task 8 (仪表盘)
                                           ↓
                                      Task 9 (PWA)
                                           ↓
                                      Task 10 (部署)
```

## 预估工时

| Task | 预估时间 |
|------|---------|
| Task 1: 项目脚手架 | 15 min |
| Task 2: 数据库 Schema | 20 min |
| Task 3: Auth 登录 | 20 min |
| Task 4: 手机端布局 | 15 min |
| Task 5: 持卡人 CRUD | 30 min |
| Task 6: 信用卡 CRUD | 30 min |
| Task 7: 账单 + 还款 | 45 min |
| Task 8: 首页仪表盘 | 20 min |
| Task 9: PWA 配置 | 15 min |
| Task 10: 部署 | 10 min |
| **合计** | **~3.5 小时** |

> 注意：由于 vinext 和 InsForge 都是较新项目，实际开发中可能需要额外时间
> 来解决兼容性问题和查阅文档。建议预留 50% buffer，实际约 5-6 小时。
