// 回归：后台控制台这批改动里「错了不会报错、只会静默失效」的几处不变量。
//
// 后台的失败模式普遍是「点了没反应、什么都没变」，而不是抛错——所以这里锁的都是
// 那种「看着在工作、实际没生效」的契约。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '../..')
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8')

describe('银行简称', () => {
  it('banks 表有 short_name 列', () => {
    expect(read('migrations/d1/0010_bank_short_name.sql')).toMatch(/ALTER TABLE banks ADD COLUMN short_name/)
  })

  it('创建与更新都带上 short_name（漏一处就会「填了不保存」）', () => {
    const admin = read('lib/api/admin.server.ts')
    // INSERT 的列清单
    expect(admin).toMatch(/INSERT INTO banks \(id, name, short_name, full_name/)
    // UPDATE 的允许字段清单
    const updateList = /for \(const key of \[([^\]]*)\]\)/.exec(admin)?.[1] ?? ''
    expect(updateList).toContain("'short_name'")
  })

  it('列表页渲染简称列', () => {
    const page = read('app/admin/banks/page.tsx')
    expect(page).toMatch(/>简称</)
    expect(page).toMatch(/bank\.short_name/)
  })
})

describe('银行维度额度×账单模式', () => {
  it('0012 迁移存在且含两列 ALTER', () => {
    const sql = read('migrations/d1/0012_bank_quota_statement_modes.sql')
    expect(sql).toMatch(/ALTER TABLE banks ADD COLUMN quota_mode TEXT NOT NULL DEFAULT 'independent'/)
    expect(sql).toMatch(/ALTER TABLE banks ADD COLUMN statement_mode TEXT NOT NULL DEFAULT 'independent'/)
    expect(sql).toMatch(/quota_mode IN \('independent', 'shared'\)/)
    expect(sql).toMatch(/statement_mode IN \('independent', 'merged'\)/)
  })

  it('createBank 的 INSERT 带上 quota_mode（缺省会写成独立模式）', () => {
    const admin = read('lib/api/admin.server.ts')
    expect(admin).toMatch(/INSERT INTO banks \([^)]*quota_mode[^)]*\)/)
    expect(admin).toMatch(/payload\.quota_mode \|\| 'independent'/)
    // UPDATE 的允许字段清单同样要放行
    const updateList = /for \(const key of \[([^\]]*)\]\)/.exec(admin)?.[1] ?? ''
    expect(updateList).toContain("'quota_mode'")
    expect(updateList).toContain("'statement_mode'")
  })

  it('银行编辑弹窗提供「额度模式」「账单模式」选项', () => {
    const page = read('app/admin/banks/page.tsx')
    expect(page).toMatch(/额度模式/)
    expect(page).toMatch(/账单模式/)
    expect(page).toMatch(/每卡独立额度/)
    expect(page).toMatch(/多卡共享额度/)
    expect(page).toMatch(/每卡单独账单/)
    expect(page).toMatch(/多卡合并账单/)
  })
})

describe('按真实内容补全：必须分批且说清剩余', () => {
  const page = read('app/admin/banks/page.tsx')

  // 一次跑完全部会超时；超时后前端拿不到结果、库里也没写入，
  // 表现就是用户报告的「什么改变都没有」。
  it('存在批次上限并真的用它切片', () => {
    expect(page).toMatch(/ENRICH_BATCH_SIZE\s*=\s*\d+/)
    expect(page).toMatch(/targets\.slice\(0, ENRICH_BATCH_SIZE\)/)
  })

  it('进度按本批而非全部计数', () => {
    expect(page).toMatch(/setEnrichProgress\(\{ done: acc\.length, total: batch\.length \}\)/)
  })

  it('结果提示包含「还剩多少家」，便于连续点击', () => {
    expect(page).toMatch(/仍有 \$\{remaining\} 家缺字段/)
  })

  it('剩余家数用写入后的新数据算，不能用闭包里的旧 banks', () => {
    // fetchData 需要把列表回传
    expect(page).toMatch(/const fresh = await fetchData\(\)/)
    expect(page).toMatch(/banksMissingFields\(fresh \?\? \[\]\)/)
  })

  it('统计 skipped 在清空 enrichRows 之前完成', () => {
    const i = page.indexOf('const skipped = enrichRows.filter')
    const j = page.indexOf('setEnrichRows([])')
    expect(i).toBeGreaterThan(-1)
    expect(j).toBeGreaterThan(-1)
    expect(i).toBeLessThan(j)
  })

  // 可写入的依据有两类：官网页面直接读到（site）、权威第三方来源（thirdparty）。
  // 纯模型记忆（model）不写。第三方这一档是必需的：不少银行官网对抓取直接拒绝
  // （实测民泰 412、建行/交行返回空壳），只认官网会让这些行永远补不上。
  it('只写有依据的字段：官网或权威第三方，模型记忆不落库', () => {
    expect(page).toMatch(/const groundedProvenance = \(p: string\) => p === 'site' \|\| p === 'thirdparty'/)
    expect(page).toMatch(/groundedProvenance\(row\.provenance\.full_name\)/)
    expect(page).toMatch(/groundedProvenance\(row\.provenance\.customer_service_phone\)/)
    expect(page).toMatch(/groundedProvenance\(row\.provenance\.website_url\)/)
    // 不能写成只认 site
    expect(page).not.toMatch(/row\.provenance\.full_name === 'site'/)
  })

  it('第三方来源在界面上单独标注，不冒充官网', () => {
    // 迁移 ObsidianUI 后徽章是文本节点（原 MUI Chip 的 label prop）
    expect(page).toMatch(/>第三方</)
    expect(page).toMatch(/>官网</)
    expect(page).toMatch(/>待确认</)
  })

  it('官网抓取失败时说明「改用第三方来源」', () => {
    expect(page).toMatch(/官网抓取失败，改用第三方来源/)
  })
})

describe('卡产品：国家筛选与批量操作', () => {
  const page = read('app/admin/card-products/page.tsx')

  it('有按国家筛选状态且参与过滤', () => {
    expect(page).toMatch(/const \[filterCountry, setFilterCountry\]/)
    expect(page).toMatch(/filterCountry === 'all' \|\| p\.country === filterCountry/)
    expect(page).toMatch(/按国家筛选/)
  })

  it('筛选变化时回到第一页（否则停在空页像「没数据」）', () => {
    expect(page).toMatch(/\}, \[search, filterBank, filterCountry\]\)/)
  })

  it('提供全选/单选的复选框列', () => {
    // 迁移 ObsidianUI 后用 AdminShell 的 AdminCheckbox（原 MUI Checkbox 的 indeterminate prop）
    expect(page).toMatch(/indeterminate=/)
    expect(page).toMatch(/ariaLabel='全选本页'/)
  })

  it('批量动作覆盖 AI 补全 / 启用 / 禁用 / 删除', () => {
    for (const label of ['AI 补全', '启用', '禁用', '删除']) {
      expect(page, `缺少批量动作：${label}`).toContain(label)
    }
  })

  it('批量 AI 只填充空白字段，绝不覆盖人工维护过的值', () => {
    // 批量最危险的失败模式就是把人写好的字段一次冲掉
    expect(page).toMatch(/current === null \|\| current === undefined \|\| current === ''/)
  })

  it('批量结果区分成功与失败，部分失败要报出来', () => {
    expect(page).toMatch(/failed\.push/)
    expect(page).toMatch(/setSaveError\(`\$\{label\}完成/)
  })
})

describe('AI 获取活动', () => {
  const ai = read('lib/api/ai.server.ts')
  const page = read('app/admin/promos/page.tsx')

  it('是 admin-only 的 RPC', () => {
    expect(read('lib/api/registry.ts')).toMatch(/suggestPromosFromWeb: \{ impl: aiServer\.suggestPromosFromWeb, admin: true \}/)
  })

  it('discount_type 只接受声明过的四种值', () => {
    expect(ai).toMatch(/const ALLOWED = new Set\(\['满减', '折扣', '积分', '返现'\]\)/)
    expect(ai).toMatch(/ALLOWED\.has\(row\.discount_type\)/)
  })

  it('日期必须是合法 YYYY-MM-DD，否则置空（不写猜测的日期）', () => {
    expect(ai).toMatch(/const dateRe = \/\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$\//)
    expect(ai).toMatch(/dateRe\.test\(v\) \? v : null/)
  })

  it('条数上限与字段截断，避免超长内容直接入库', () => {
    expect(ai).toMatch(/parsed\.slice\(0, 8\)/)
    expect(ai).toMatch(/\.slice\(0, 80\)/)
  })

  it('provenance 区分「官网」与「待确认」，且默认只勾选官网项', () => {
    expect(ai).toMatch(/provenance: grounded \? 'site' : 'model'/)
    expect(page).toMatch(/setAiChecked\(rows\.map\(r => r\.provenance === 'site'\)\)/)
  })

  it('候选先复核再落库（拉取不写库）', () => {
    // 拉取函数只返回候选；落库发生在显式导入动作里
    expect(ai).toMatch(/export async function suggestPromosFromWeb/)
    expect(ai).not.toMatch(/INSERT INTO promos/)
    expect(page).toMatch(/AI 获取活动/)
    expect(page).toMatch(/写入勾选/)
  })

  it('只抓官网 origin，不接受任意 URL', () => {
    expect(ai).toMatch(/function normalizeOrigin/)
    expect(ai).toMatch(/url\.protocol === 'http:' \|\| url\.protocol === 'https:' \? url\.origin : null/)
  })
})

describe('权益 AI 搜集兼容入口（Task 13 候选门面）', () => {
  it('autoEnrichCardBenefits 只返回候选且标记 REVIEW_REQUIRED，不写 benefits', async () => {
    const { createOpportunityDb } = await import('./helpers/sqlite-d1')
    const { seedOpportunityFixtures } = await import('./helpers/opportunity-fixtures')
    const { setDb } = await import('../db/client')
    const db = createOpportunityDb()
    await seedOpportunityFixtures(db)
    setDb(db as unknown as D1Database)
    try {
      const { autoEnrichCardBenefits } = await import('../api/benefits.server')
      await expect(
        autoEnrichCardBenefits('p-any', '验证银行', '验证卡'),
      ).rejects.toThrow(/AI|Key|配置/) // 无 AI 配置：显式失败，不生成假依据
      const rows = db.raw.prepare('SELECT COUNT(*) AS n FROM benefits').get() as { n: number }
      expect(rows.n).toBe(3) // fixture 原有 3 条，一条未新增
    } finally {
      setDb(null)
      db.close()
    }
  })
})
