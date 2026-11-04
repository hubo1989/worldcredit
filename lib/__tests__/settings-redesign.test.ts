import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '../..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('F5 设置页重设计 · 双主题 Token 契约', () => {
  it('app/globals.css 完整收录 17 个亮色令牌与动态覆盖', () => {
    const css = read('app/globals.css')
    expect(css).toContain('--color-d-light-bg:')
    expect(css).toContain('--color-d-light-surface:')
    expect(css).toContain('--color-d-light-border:')
    expect(css).toContain('--color-d-light-text:')
    expect(css).toContain('--color-d-light-accent:')
    expect(css).toContain('--color-d-light-gold:')
    expect(css).toContain('--color-d-light-danger:')
    expect(css).toMatch(/\.theme-light,\s*\[data-theme="light"\]/)
    expect(css).toMatch(/--color-d-bg:\s*#f5f7fa;/)
  })

  it('foundations.json 补齐暗色缺失令牌并收录亮色令牌', () => {
    const foundations = JSON.parse(read('design/openpencil/vars/foundations.json'))
    expect(foundations['color.obsidian.accentLight'].value).toBe('#7AADFF')
    expect(foundations['color.obsidian.goldDeep'].value).toBe('#D9A93F')
    expect(foundations['color.obsidian.danger'].value).toBe('#E5484D')
    expect(foundations['color.obsidian.light.canvas'].value).toBe('#F5F7FA')
    expect(foundations['color.obsidian.light.surface'].value).toBe('#FFFFFF')
  })

  it('baoyu-design 现行真源与历史存档保护', () => {
    expect(existsSync(join(ROOT, 'design/baoyu/README.md'))).toBe(true)
    expect(existsSync(join(ROOT, 'design/baoyu/canvas.json'))).toBe(true)
    expect(existsSync(join(ROOT, 'design/baoyu/tokens.json'))).toBe(true)
    expect(existsSync(join(ROOT, 'design/baoyu/Mobile_Settings_Dark.dc.html'))).toBe(true)
    expect(existsSync(join(ROOT, 'design/baoyu/Admin_Settings_Dark.dc.html'))).toBe(true)
    // 历史归档 .op 资产保留
    expect(existsSync(join(ROOT, 'design/openpencil/worldcredit-redesign.op'))).toBe(true)
  })
})

describe('F5 设置页重设计 · 移动端 /settings 与 BottomNav', () => {
  const bottomNav = read('components/mobile/BottomNav.tsx')
  const settingsPage = read('app/(mobile)/settings/page.tsx')
  const displayCard = read('components/settings/DisplayPreferencesCard.tsx')
  const gmailPanel = read('components/mobile/GmailConnectPanel.tsx')

  it('BottomNav 落地 4 Tab 结构（首页 / 账单 / 卡片 / 我的）', () => {
    expect(bottomNav).toMatch(/\/dashboard/)
    expect(bottomNav).toMatch(/\/bills/)
    expect(bottomNav).toMatch(/\/cards/)
    expect(bottomNav).toMatch(/\/settings/)
    expect(bottomNav).toContain('首页')
    expect(bottomNav).toContain('账单')
    expect(bottomNav).toContain('卡片')
    expect(bottomNav).toContain('我的')
  })

  it('移动端消除硬编码渐变与色值', () => {
    expect(settingsPage).not.toContain('#4338ca')
    expect(settingsPage).not.toContain('#4f46e5')
    expect(settingsPage).not.toContain('#f59e0b')
    expect(settingsPage).not.toContain('window.confirm')
    expect(gmailPanel).not.toContain('window.confirm')
  })

  it('移动端头卡统一角色胶囊与后台跳转', () => {
    expect(settingsPage).toContain('◆ 管理员')
    expect(settingsPage).toContain('进入后台 →')
    expect(settingsPage).toContain('/admin/settings')
  })

  it('移动端三组设置采用 BottomSheet 抽屉承载', () => {
    expect(settingsPage).toContain('<BottomSheet')
    expect(settingsPage).toContain('title=\'邮箱账单导入\'')
    expect(settingsPage).toContain('title=\'提醒偏好配置\'')
    expect(settingsPage).toContain('title=\'显示与币种偏好\'')
  })

  it('显示偏好开放 default_currency 与 show_annual_fee', () => {
    expect(displayCard).toContain('default_currency')
    expect(displayCard).toContain('show_annual_fee')
    expect(displayCard).toContain('综合看板折算币种')
    expect(displayCard).toContain('卡片年费信息')
  })

  it('退出登录具备 ConfirmDialog 二次确认', () => {
    expect(settingsPage).toContain('<ConfirmDialog')
    expect(settingsPage).toContain('title=\'退出登录\'')
    expect(settingsPage).toContain('确定要退出当前账号吗？')
  })
})

describe('F5 设置页重设计 · 后台 /admin/settings', () => {
  const adminPage = read('app/admin/settings/page.tsx')

  it('首屏加载失败时具备告警防护且锁死保存', () => {
    expect(adminPage).toContain('loadError')
    expect(adminPage).toContain('disabled={!canSave}')
    expect(adminPage).toContain('重试加载')
    expect(adminPage).toContain('配置拉取失败，已锁死保存操作')
  })

  it('全站维护模式开启操作具备 ConfirmDialog 二次确认拦截', () => {
    expect(adminPage).toContain('confirmMaintenanceOpen')
    expect(adminPage).toContain('开启全站维护模式')
    expect(adminPage).toContain('开启全站维护模式后，所有普通用户的实时访问与会话将立即中断')
  })

  it('AI API Key 保持只写不回显，并提供独立安全更新通道', () => {
    expect(adminPage).toContain('aiApiKeyInput')
    expect(adminPage).toContain('只写不回显')
    expect(adminPage).toContain('单独更新密钥')
    expect(adminPage).toContain('ai_api_key_set')
  })

  it('统一草稿表单保存与 dirty 检测机制', () => {
    expect(adminPage).toContain('dirtyKeys')
    expect(adminPage).toContain('hasDraftChanges')
    expect(adminPage).toContain('撤销更改')
    expect(adminPage).toContain('保存更改')
  })

  it('默认记账币种改为 SelectField 标准选项', () => {
    expect(adminPage).toContain('<SelectField')
    expect(adminPage).toContain('label=\'默认记账币种\'')
    expect(adminPage).toContain('CURRENCY_OPTIONS')
  })
})
