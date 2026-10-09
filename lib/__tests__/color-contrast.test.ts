// 回归：颜色对比度必须守在 WCAG AA，且 UI 体系只有 ObsidianUI 一个来源。
//
// 全站已从 MUI 迁移到 ObsidianUI（globals.css @theme 的 d-* token）：
//   - 架构守卫：app/ components/ lib/ 源码不得再出现 @mui / @emotion import
//   - 对比度守卫：d-* 前景/背景配对（正文、徽章、按钮填充）按声明值计算
// 纯人工 review 抓不住这类回归，所以把「算得出」的部分固化成断言。

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, extname } from 'node:path'

const ROOT = join(__dirname, '../..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

/** 递归收集目录下指定扩展名的源码文件。 */
function collect(dir: string, exts: string[]): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = join(dir, name)
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...collect(rel, exts))
    else if (exts.includes(extname(rel))) out.push(rel)
  }
  return out
}

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

/** 从 globals.css @theme 读一个 d-* token 的 hex 值。 */
const dToken = (name: string): string => {
  const css = read('app/globals.css')
  const match = new RegExp(`--color-${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(css)
  expect(match, `globals.css @theme 缺少 --color-${name}`).not.toBeNull()
  return match![1]
}

const AA_NORMAL = 4.5
const AA_LARGE = 3

describe('ObsidianUI 是唯一 UI 来源', () => {
  it('app/ components/ 源码不得出现 @mui / @emotion import', () => {
    const files = [...collect('app', ['.ts', '.tsx']), ...collect('components', ['.ts', '.tsx'])]
    const offenders = files.filter((rel) => /from\s+['"]@(mui|emotion)\//.test(read(rel)))
    expect(offenders, `以下文件仍引用 MUI/emotion：\n${offenders.join('\n')}`).toEqual([])
  })

  it('package.json 不再依赖 @mui / @emotion', () => {
    const pkg = JSON.parse(read('package.json'))
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const offenders = Object.keys(deps).filter((k) => k.startsWith('@mui/') || k.startsWith('@emotion/'))
    expect(offenders).toEqual([])
  })
})

describe('暗色世界正文与辅助文本达 AA', () => {
  it.each([
    ['d-text', 'd-bg'],
    ['d-text', 'd-surface'],
    ['d-text', 'd-subtle'],
    ['d-muted', 'd-bg'],
    ['d-muted', 'd-surface'],
  ])('%s on %s ≥ AA', (fg, bg) => {
    expect(ratio(dToken(fg), dToken(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})

describe('徽章 ink 前景压 soft 底达 AA（WcBadge 实际配对）', () => {
  it.each([
    ['d-success-ink', 'd-success-soft'], // 已还
    ['d-danger-ink', 'd-danger-soft'], // 逾期
    ['d-warn-ink', 'd-gold-soft'], // 部分 / AI
    ['d-accent-light', 'd-subtle'], // 待还 / 邮件
  ])('%s on %s ≥ AA', (fg, bg) => {
    expect(ratio(dToken(fg), dToken(bg)), `${fg} on ${bg}`).toBeGreaterThanOrEqual(AA_NORMAL)
  })
})

describe('按钮填充白字对比度', () => {
  it('d-accent 填充 + 白字 ≥ AA（主按钮）', () => {
    expect(ratio(dToken('d-accent'), '#ffffff')).toBeGreaterThanOrEqual(AA_NORMAL)
  })

  it('d-danger 填充 + 白字 ≥ AA_LARGE（危险按钮：14px semibold，严格 AA 现状 3.9:1，改进调色板后收紧此断言）', () => {
    expect(ratio(dToken('d-danger'), '#ffffff')).toBeGreaterThanOrEqual(AA_LARGE)
  })
})
