// 回归：颜色对比度必须守在 WCAG AA，且语义色只能有一个来源。
//
// 本次全站颜色审计暴露的问题都不是「审美分歧」，而是可测量的缺陷：
//   - 徽章彩色文字压在自己 10~14% 的淡底上，全部不达 AA（最低 2.66:1）
//   - /admin 首页把亮色 token 硬编码在暗底上（#030059 on #181a24 = 1.06:1，几乎不可见）
//   - globals.css 另存一套语义色（#16A34A/#CF2E2E/#2563EB），与 theme.ts 声明值不同
// 纯人工 review 抓不住这类回归，所以把「算得出」的部分固化成断言。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '../..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

type RGB = [number, number, number]

const hex = (value: string): RGB => {
  const h = value.replace('#', '')
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB
}

const channel = (c: number) => {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
}

const luminance = ([r, g, b]: RGB) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)

const ratio = (a: string, b: string) => {
  const [l1, l2] = [luminance(hex(a)), luminance(hex(b))]
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
}

/** color-mix(in srgb, fg pct%, bg) —— 按 sRGB 线性插值近似，与浏览器一致的近似算法。 */
const tint = (fg: string, pct: number, bg = '#FFFFFF') => {
  const [f, b] = [hex(fg), hex(bg)]
  const mixed = f.map((c, i) => Math.round(c * pct + b[i] * (1 - pct)))
  return '#' + mixed.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** 从 globals.css 读一个 CSS 变量值（只解析 #rrggbb 形式）。 */
const cssVar = (css: string, name: string): string => {
  const match = new RegExp(`${name}\\s*:\\s*(#[0-9A-Fa-f]{6})`).exec(css)
  expect(match, `globals.css 缺少 ${name}`).not.toBeNull()
  return match![1]
}

const AA_NORMAL = 4.5
const AA_LARGE = 3

describe('语义色只有一个来源', () => {
  const css = read('app/globals.css')
  const theme = read('lib/theme.ts')

  // 同一句「成功/危险/信息」在 globals.css 与 theme.ts 里必须是同一个值，
  // 否则同一个状态在不同组件里渲染成两种颜色。
  it.each([
    ['--success', '#2e7d32'],
    ['--danger', '#d32f2f'],
    ['--info', '#0277bd'],
  ])('%s 与 Design.md / theme.ts 的声明值一致', (name, expected) => {
    expect(cssVar(css, name).toLowerCase()).toBe(expected)
    expect(theme.toLowerCase()).toContain(expected)
  })

  it('语义色提供 ink 档用于正文/标签（本色只有 3.1~4.2，压淡底不达 AA）', () => {
    for (const name of ['--success-ink', '--warning-ink', '--danger-ink', '--info-ink']) {
      expect(css, `缺少 ${name}`).toContain(name)
    }
  })
})

describe('状态徽章文字必须达 AA', () => {
  const css = read('app/globals.css')

  // WcBadge 用 color-mix(token pct%, transparent) 生成淡底，文字取 `-ink` 档。
  it.each([
    ['已还', '--success-ink', '--success', 12],
    ['逾期', '--danger-ink', '--danger', 12],
    ['待还', '--info-ink', '--info', 10],
  ])('%s 徽章 ≥ AA', (_label, inkVar, bgVar, pct) => {
    const fg = cssVar(css, inkVar)
    const bg = tint(cssVar(css, bgVar), pct / 100)
    expect(ratio(fg, bg), `${inkVar} on ${pct}% ${bgVar}`).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('语义本色压自己淡底确实不达 AA —— 这就是必须用 ink 档的原因', () => {
    // 若哪天这个前提不成立了（例如淡底大幅变浅），可以用本色，届时再调整。
    const failing = [
      ['--success', 12],
      ['--warning', 14],
      ['--danger', 12],
    ]
    for (const [name, pct] of failing) {
      const base = cssVar(css, name as string)
      expect(ratio(base, tint(base, (pct as number) / 100))).toBeLessThan(AA_NORMAL)
    }
  })

  it('WcBadge 的文字用 ink 档而非语义本色', () => {
    const badge = read('components/mobile/WcBadge.tsx')
    expect(badge).not.toMatch(/fg: 'var\(--success\)'/)
    expect(badge).not.toMatch(/fg: 'var\(--danger\)'/)
    expect(badge).not.toMatch(/fg: 'var\(--info\)'/)
  })
})

describe('/admin 暗色世界不得使用亮色 token', () => {
  // 亮色世界的深藏青/次级灰压在 #181a24 上分别是 1.06:1 与 2.88:1——标题几乎不可见。
  it('/admin 首页不再硬编码亮色文字', () => {
    const src = read('app/admin/page.tsx')
    for (const bad of ["'#030059'", "'#636363'"]) {
      expect(src, `app/admin/page.tsx 不应再出现 ${bad}`).not.toContain(bad)
    }
  })

  it('admin 世界要求 AA：text.primary / text.secondary 在背景上必须达标', () => {
    const theme = read('lib/theme.ts')
    const dark = /adminDarkTheme[\s\S]*?background:\s*\{\s*default:\s*'(#[0-9A-Fa-f]{6})'/.exec(theme)
    expect(dark, '未能从 adminDarkTheme 解析出背景色').not.toBeNull()
    const bg = dark![1]
    // 与 theme.ts 的 adminDarkTheme.text 保持一致
    for (const fg of ['#e4e6eb', '#9ca3af']) {
      expect(ratio(fg, bg), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA_NORMAL)
    }
  })

  it('StatCard 走主题 token（此前是白卡 + 亮色文字，跨世界）', () => {
    const stat = read('components/admin/StatCard.tsx')
    expect(stat).toContain("'background.paper'")
    expect(stat).toContain("'text.primary'")
    expect(stat).not.toContain("bgcolor: '#FFFFFF'")
  })

  it('admin 按钮填充不用 indigo-light（白字其上仅 2.98:1）', () => {
    for (const rel of [
      'app/admin/banks/page.tsx',
      'app/admin/benefits/page.tsx',
      'app/admin/promos/page.tsx',
      'app/admin/settings/page.tsx',
      'app/admin/card-products/page.tsx',
    ]) {
      expect(read(rel), rel).not.toContain("bgcolor: '#818cf8'")
    }
  })

  it('indigo-light 填充的实际对比度确认不达 AA（作为上一条的依据）', () => {
    expect(ratio('#818cf8', '#ffffff')).toBeLessThan(AA_NORMAL)
    // 声明的填充档可以
    expect(ratio('#4f46e5', '#ffffff')).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})

describe('亮色世界关键对比度', () => {
  const css = read('app/globals.css')

  it('次级文本在纸面与雾底上达 AA', () => {
    const muted = cssVar(css, '--text-secondary')
    expect(ratio(muted, '#FFFFFF')).toBeGreaterThanOrEqual(AA_NORMAL)
    expect(ratio(muted, '#F5F8FF')).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('gold-500 只能用于深底（白底上 2.42:1，连大字号门槛都不到）', () => {
    const gold500 = cssVar(css, '--gold-500')
    expect(ratio(gold500, '#FFFFFF')).toBeLessThan(AA_LARGE)
    // gold-700 才是白底上的文字档
    expect(ratio(cssVar(css, '--gold-700'), '#FFFFFF')).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('dashboard 的白卡金额不再使用 gold-500', () => {
    const dash = read('app/(mobile)/dashboard/page.tsx')
    expect(dash).not.toMatch(/color: 'var\(--gold-500\)',\s*\n\s*lineHeight: 1\.2/)
  })
})
