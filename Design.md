# Design System · WorldCredit

> 面向 AI coding agent 的设计系统规范。替换项目中旧版误放文件（疗养中心规范），以下为 WorldCredit 的唯一设计标准。

## 1. Visual Theme & Atmosphere

WorldCredit 是一个家庭信用卡管理工具——深蓝金融稳重 + 家庭温度。深海军蓝锚定信任与金确权感，金用于资产高光时刻（还款完成、贵宾权益、AI 智能填充标识）。金额与数字严格等宽对齐（tabular-nums），账单状态用颜色 + 文字 + 图标三通道表达，确保色弱用户可辨。首屏只回答一个问题："现在该做什么"——克制、聚焦、不制造焦虑。

**Key Characteristics**

- Deep navy foundation (`#0A1F44`) providing trust and stability
- Gold accents (`#C9A227`) for premium moments — repayment completion, premium benefits, AI fill badges
- Semantic status colors: green=paid, gold=partial, red=overdue, blue=unpaid
- Tabular-nums for all monetary values; clean, generous whitespace
- Unified 3-tab bottom navigation (Home / Bills / Me) — no chatbot, no unnecessary tabs
- Dual-mode visual language: light mobile PWA + dark admin console, sharing the same semantic palette

## 2. Color Palette & Roles

### Primary
- **Deep Navy** (`#0A1F44`): Headings, core UI anchors, bottom navigation active state; trust and authority
- **Indigo Blue** (`#1E3A8A`): Links, focus rings, interactive hover states; bridges navy with lighter accents

### Accent
- **Gold** (`#C9A227`): Asset-signaling highlights — repayment complete, account in good standing, AI fill badge, tab active dot; fill-only, never as text (use `#8A6D1F` for gold text to meet 4.5:1 contrast)
- **Sky Blue** (`#7AADFF`): Secondary accent for subtle background tinting; very light, non-intrusive

### Semantic / Status
- **Success Green** (`#16A34A`): Paid, available credit sufficient, toast success
- **Warning Yellow** (`#FCB900`): Partial repayment, approaching deadline
- **Error Red** (`#CF2E2E`): Overdue, validation error, high-risk alert
- **Info Blue** (`--navy-600` / `#1E3A8A`): Unpaid, neutral information, chip tags

### Neutral Scale
- **Background** (`#F5F7FA`): Mobile page background — not pure white
- **Surface White** (`#FFFFFF`): Cards, panels, form fields
- **Ink Dark** (`#111827`): Primary body text
- **Ink Secondary** (`#374151`): Secondary text, descriptions
- **Muted** (`#6B7280`): Captions, metadata, placeholder, disabled text
- **Border Light** (`#E5E7EB`): Subtle separation between cards and sections
- **Border Strong** (`#C8CFDB`): Input borders, focus rings

### Dark Mode (Admin Console)

| Token | Light | Dark |
|-------|-------|------|
| Background | `#F5F7FA` | `#0F1117` |
| Surface/Card | `#FFFFFF` | `#181A24` |
| Foreground text | `#111827` | `#E4E6EB` |
| Muted text | `#6B7280` | `#9AA3B2` |
| Border | `#E5E7EB` | `rgba(255,255,255,0.08)` |

Semantic colors shift up one brightness step on dark: Success `#34D399`, Danger `#F87171`.

## 3. Typography Rules

### Font Family

**Primary:** Noto Sans SC (system fallback: PingFang SC / Hiragino Sans GB / Microsoft YaHei / sans-serif)
**Numbers:** Manrope or DIN Alternate with `font-variant-numeric: tabular-nums` — all monetary values must be monospaced for column alignment.
**Mono:** JetBrains Mono or ui-monospace — card number masks, code-like content.

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing | Notes |
|------|------|------|--------|-------------|----------------|-------|
| Display | Noto Sans SC | 22px | 700 | 1.2 | -0.01em | Section titles, main metric value |
| Card Title | Noto Sans SC | 15px | 600 | 1.4 | 0 | Card headers, item names |
| Body | Noto Sans SC | 13.5px | 400 | 1.6 | 0 | Primary body text |
| Amount | tabular-nums | 14–22px | 700 | 1.2 | 0 | Monetary values; varies by context |
| Caption | Noto Sans SC | 11–12px | 400 | 1.5 | 0.02em | Metadata, dates, secondary info |
| Button | Noto Sans SC | 13px | 600 | 1.2 | 0.02em | All interactive buttons |
| ALL CAPS labels | Noto Sans SC | 10–12px | 600 | 1.2 | 0.06em–0.08em | Section labels, badge text |

### Principles
- Max 3 type sizes visible above the fold per view
- Never use `text-align: justify` for body copy (creates rivers)
- All monetary values use tabular-nums; never use proportional figures for amounts
- Button text always has `letter-spacing: 0.02em`
- Never more than 3 weights in a single view

## 4. Component Stylings

### Buttons

#### Primary Button (Filled Navy)
- **Background:** `--navy-800 (#0A1F44)`
- **Text Color:** `#FFFFFF`
- **Font:** Noto Sans SC, 13px, weight 600, letter-spacing 0.02em
- **Padding:** 10px 18px
- **Border Radius:** 999px (capsule)
- **Hover:** Background `--navy-600 (#1E3A8A)`
- **Active:** Scale 0.96
- **Focus:** 2px solid `--gold-500`, offset 2px
- **Disabled:** Background `#D7DCE4`, color `#9AA3B2`, cursor not-allowed

#### AI Fill Button (Gold)
- **Background:** `--gold-500 (#C9A227)`
- **Text Color:** `#FFFFFF`
- **Icon:** 13px sparkle SVG to the left of text
- **Disabled:** Background `#E8DFC4`, color `#A9986B`
- Other properties same as primary

#### Ghost Button (on dark background)
- **Background:** `rgba(255,255,255,0.14)`
- **Text Color:** `#FFFFFF`
- **Border:** 1px solid `rgba(255,255,255,0.3)`
- **Hover:** Background `rgba(255,255,255,0.22)`

### Cards & Containers

#### Standard Card
- **Background:** `--paper (#FFFFFF)`
- **Border:** 1px solid `--line (#E5E7EB)`
- **Border Radius:** 12px
- **Padding:** 13–16px
- **Box Shadow:** `0 2px 8px rgba(10,31,68,0.06)` (on light bg)

#### Main Metric Card (Hero)
- **Background:** `linear-gradient(135deg, --navy-800, --navy-600)`
- **Text Color:** `#FFFFFF`
- **Border Radius:** 18px
- **Padding:** 16px 18px
- **Decoration:** Gold semi-transparent circle (120px) positioned right-top for visual depth

#### Stat Metric Card
- **Background:** `--paper`
- **Border:** 1px solid `--line`
- **Border Radius:** 14px
- **Padding:** 12px 13px
- **Content:** Muted label (11px) + bold value (19px, tabular-nums) + sub caption (10px)

#### Bank Group Header
- **Background:** `--navy-800`
- **Text Color:** `#FFFFFF`
- **Border Radius:** 10px
- **Padding:** 7px 11px
- **Content:** Bank name + account count + total due (right-aligned)

### Navigation

#### Bottom Tab Bar (Mobile)
- **Background:** `--paper`
- **Border Top:** 1px solid `--line`
- **Layout:** 3-column grid (Home / Bills / Me)
- **Tab Height:** min 56px (≥44pt touch target)
- **Tab Default:** color `--muted`, icon 22px SVG (1.6–1.8px stroke, currentColor), label 10.5px
- **Tab Active:** color `--navy-800`, label weight 700, gold top bar (16px × 3px, `--gold-500`)
- **Icons:** Linear SVG only — **absolutely no emoji** in navigation or UI

#### Segment Control (Pills Group)
- **Background:** `#EEF1F5`
- **Border Radius:** 999px
- **Padding:** 3–4px
- **Item Default:** transparent, color `--muted`, font 12.5px weight 600
- **Item Active:** background `--navy-800`, color `#FFFFFF`

### Form Inputs

#### Text Input
- **Background:** `--paper`
- **Border:** 1.5px solid `--line-strong (#C8CFDB)`
- **Border Radius:** 12px
- **Padding:** 12px 14px
- **Font:** 15px, tabular-nums for amount fields
- **Focus:** Border `--navy-600`, box-shadow `0 0 0 3px rgba(30,58,138,0.12)`
- **Error:** Border `--danger`, tinted background

#### AI Smart Fill Area
- **Border:** 1.5px dashed `--gold-500`
- **Background:** `#FBF7EA`
- **Border Radius:** 13px
- **Padding:** 12px
- **Content:** Textarea + "Fill sample" link + "Smart Fill" gold button + loading status spinner

### Badges & Status Indicators

| State | Background | Text | Usage |
|-------|-----------|------|-------|
| Paid / Success | `#E7F6EC` | `--success` | Bill fully paid |
| Unpaid / Info | `--accent-soft (#EEF2FF)` | `--navy-600` | Bill unpaid but not overdue |
| Partial / Warning | `#FBF7EA` | `--gold-700` | Partially repaid |
| Overdue / Error | `#FCE9E9` | `--danger` | Past due date |
| AI Fill | `--gold-500` | `#FFFFFF` | Field was auto-filled by AI |
| Email Source | `--accent-soft` | `--navy-600` | Data from email import |
| Manual Source | `#F0F1F4` | `--muted` | Manually entered/edited |

All badges: border-radius 999px, padding 3px 9px, font-weight 700, font-size 10.5px.

### Action Sheet (Bottom Drawer)
- **Mask:** `rgba(6,18,43,0.45)`, opacity transition 220ms
- **Panel:** White, border-radius 22px top-only, translateY slide-up 260ms cubic-bezier(0.32,0.72,0.2,1)
- **Handle:** 40px × 4px gray bar, centered at top
- **Content:** List of actions with SVG icons + title + description

### Toast
- **Default:** `--navy-800` background, white text, capsule shape
- **Success:** `--success` background
- **Position:** Bottom center, 92px above bottom
- **Animation:** Fade + slide-up 240ms, auto-dismiss 2.4s

### Empty State
- Centered layout with SVG block (52px circle, accent-soft fill) + title (14px) + description (12px) + CTA button
- Never show a blank screen with "No data" — always include guidance

### Error State
- Red-tinted background with border, plain-language cause, recovery action (retry button), preserved user input
- At least 3 retries with exponential backoff before showing "Contact support"

### Loading Skeleton
- Rounded card height (74px for bill items), shimmer animation (1.1s linear, 200% background-position)
- Target: 80% layout matched to populated state
- 15s timeout fallback: "Taking longer than expected"

## 5. Layout Principles

### Spacing System

**Base Unit:** 4px

**Scale:** 4 / 8 / 12 / 16 / 24 / 32

- Cards: 16px–24px internal padding, 8px–12px between items
- Sections: 24px–32px vertical spacing
- Navigation: 8px–12px internal

### Grid

- Mobile (≤390px): Single column, 18px side padding
- Tablet (768–1024px): 8-col grid, 6px gutters
- Desktop (>1024px): 12-col grid, 8px gutters, max container width 1200px

### Whitespace Philosophy

Whitespace is intentional. Don't crowd. One primary action per screen. Ancillary information collapses or defers. The homepage answers one question: "What needs attention now?" — anything else is secondary.

### Border Radius Scale

- 8–10px: Buttons, small interactive elements
- 12–14px: Standard cards, panels
- 16–18px: Hero cards, main metric cards
- 22px: Sheet top corners
- 999px: Badges, pills, capsule buttons

## 6. Depth & Elevation

| Level | Treatment | Use |
|-------|-----------|-----|
| Ground | 1px border, no shadow | Default cards, inputs, panels |
| Raised | `0 2px 8px rgba(10,31,68,0.06)` | Interactive cards, hover |
| Elevated | `0 12px 40px rgba(6,18,43,0.16)` | Phone frame (large), modals |
| Floating | Bottom sheet mask 0.45 opacity | Action sheets, dialogs |

Shadows are navy-tinted, not pure black. On dark surfaces, use semi-transparent white borders instead of shadows.

## 7. Do's and Don'ts

### Do

- Use CSS custom properties (`var(--navy-800)`) for all colors — never hardcode hex outside `:root`
- Use `font-variant-numeric: tabular-nums` for all monetary values, card numbers, and amount columns
- Maintain minimum 4.5:1 contrast for body text; use `#8A6D1F` for gold text on white
- Use 3 tab navigation only: Home / Bills / Me — never add a chatbot tab
- Display source provenance badges on imported/manual/AI-filled data
- Show clear focus indicators (2px gold outline, 2px offset) for all interactive elements
- Render loading, empty, error, and edge states for every data surface
- Validate forms on blur, not on first keystroke
- Use linear SVG icons (1.6–1.8px stroke, currentColor) — never emoji

### Don't

- Never use emoji as UI elements (icons, avatars, navigation, decoration). Inline body copy emoji is acceptable only when the emoji IS the content.
- Never use Inter / Roboto / Space Grotesk / Fraunces as default — use Noto Sans SC system stack
- Never use purple-blue or indigo-pink gradients (`#6366f1`, `#4f46e5` etc.)
- Never use the "trust gradient" (blue→purple hero background)
- Never use `border-left: 4px solid color` accent cards (the canonical AI dashboard tile)
- Never invent fake metrics ("10× faster", "99.9% uptime") — use labelled placeholders or omit
- Never write "Something went wrong" with no cause or recovery
- Never clear form fields on submission failure
- Never show a blank screen for empty state
- Never have the chatbot tab — LLM belongs in form-fill assist, not as a separate chat interface

## 8. Responsive Behavior

### Mobile PWA
- Default authoring viewport: 390 × 844 (iPhone 14 Pro)
- Container uses `min(390px, 100vw)` with max-width constraints — never locked to one fixed size
- Bottom tab bar: `padding-bottom: calc(10px + env(safe-area-inset-bottom, 0px))`
- Touch targets: minimum 44 × 44pt (24px CSS minimum by WCAG 2.5.8, 44px for comfortable use)
- Font sizes never drop below 13px body / 10.5px caption

### Admin Console
- Sidebar: fixed 260px, collapsible below 1024px
- Content area: fluid with 32px padding
- Cards: 1 column mobile, 2 columns tablet, 3 columns desktop

### Breakpoints

| Name | Width | Key Changes |
|------|-------|-------------|
| Mobile | <576px | Single column, 18px padding, full-width |
| Tablet | 576–1024px | 2-col grid possible, 24px padding |
| Desktop | 1024–1440px | 3+ columns, 32px padding |
| Wide | >1440px | Content max 1200px centered |

### prefers-reduced-motion
All animations, transitions, and skeleton shimmers must be disabled when `prefers-reduced-motion: reduce` is active. Use `@media (prefers-reduced-motion: reduce)` to zero out animation and transition durations.

## 9. Agent Prompt Guide

### Quick Color Reference

- **Primary Heading:** Deep Navy (`#0A1F44`)
- **Body Text:** Ink Dark (`#111827`) on light, `#E4E6EB` on dark
- **Primary Button:** Deep Navy background, white text
- **AI Button:** Gold (`#C9A227`) background, white text
- **Page Background:** `#F5F7FA` (mobile), `#0F1117` (admin)
- **Card Background:** `#FFFFFF` (mobile), `#181A24` (admin)
- **Status Colors:** Green `#16A34A` / Yellow `#FCB900` / Red `#CF2E2E` / Blue `#1E3A8A`
- **Focus:** 2px solid `#C9A227`, offset 2px
- **Disabled:** `#D7DCE4` background, `#9AA3B2` text

### Iteration Guide

1. **Start with the token layer:** All colors, fonts, spacing, and radius values are CSS custom properties in `:root`. Never hardcode values — reference tokens by `var()`.

2. **Set typography to Noto Sans SC with tabular-nums for amounts:** The single most important typographic rule: every monetary value must use monospaced numbers.

3. **Apply 3-tab navigation:** Home (statistics dashboard) / Bills (dual-dimension grouping + sorting) / Me (family management, perks, preferences). No chatbot tab. No holder tab.

4. **Home page = statistics dashboard:** Holder segment switch (All/A/B/C) at top → main metric card (total due) → 2×2 metric grid (overdue / N-day forecast / total debt expandable / unbilled with placeholder) → account chips → quick action grid → overdue bill list.

5. **Bills = dual-dimension account book:** Segment switch (by holder / by bank) → dynamic filter pills → month switcher → sort (due date / grace period) → group headers (bank name + account count) → bill cards with billing day / due day / grace days per card → tap to bill detail → tap "view card" to card detail.

6. **LLM = form-fill assist, not chat:** AI Smart Fill area (dashed gold border) embedded in add-card / add-bill / record-repayment forms. Paste text → Smart Fill → fields auto-populate with gold AI badge → user confirms or modifies → save.

7. **Data provenance:** Every record carries `source` field (email / manual / ai). Email imports use unique key dedup (card + bill_month + statement_date). Card matching by bank + last 4 digits. Three-tier conflict resolution: L1 auto-merge / L2 confirm on field mismatch / L3 never overwrite user-edited fields.

8. **Test responsive at 390px, 768px, 1024px, 1440px.** Ensure no content breaks, touch targets remain ≥44pt, and typography stays readable.

9. **Cover all states:** Loading skeleton → Empty with guidance → Populated → Error with recovery. Every list, card, and form must render all four.

10. **No emoji, no AI slop, no dead-end states.** SVG icons only. Token-based theming only. Every interactive element has hover/active/focus/disabled states.

