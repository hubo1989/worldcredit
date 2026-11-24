// lib/__tests__/bill-import-rpc.test.ts — HUB-156 统一账单导入草稿箱的契约与边界测试。
//
// 覆盖 HUB-154 §3.3 冻结的 billDrafts / passwordVault / preferences / holders 契约：
//   1) importAndParseBill 的解析落草稿、幂等重放、非账单、解析失败与入参校验；
//   2) 草稿归属 fail-closed（越权一律 403）；
//   3) confirmBillImportDraft 的 409 DUPLICATE_BILL 对比与 merge_update；
//   4) unlockEncryptedDraft 的 R2 原位脱密 + 密码本落库；
//   5) 密码本 DTO 物理剥离密文、import_config 只写自己那块。
//
// 解密与多模态解析由 HUB-155 的 lib/email-core 提供，这里通过
// __setPdfDecryptorForTests / __setBillImportCoreParserForTests 注入，只验证编排契约。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createOpportunityDb, type SqliteD1 } from './helpers/sqlite-d1'
import { ensureHub156Schema } from './helpers/hub156-schema'
import { setDb, setWorkerEnv } from '../db/client'
import { MemberScopeError } from '../api/member-scope'
import { RpcDomainError } from '../api/errors'
import {
  batchDiscardBillDrafts,
  confirmBillImportDraft,
  createBillImportDraft,
  discardBillImportDraft,
  getBillImportDraftById,
  importAndParseBill,
  unlockEncryptedDraft,
  updateBillImportDraft,
  type BillDraftPayload,
} from '../api/billDrafts.server'
import {
  __setPdfDecryptorForTests,
  __setBillImportCoreParserForTests,
  type BillImportCoreParser,
} from '../api/bill-import-core.server'
import {
  createPasswordRule,
  listPasswordRules,
  updatePasswordRule,
  deletePasswordRule,
} from '../api/passwordVault.server'
import {
  getUserImportPreferences,
  updateUserImportPreferences,
  getUserPreferences,
  updateUserPreferences,
} from '../api/preferences.server'
import { updateMyHolderAliases } from '../api/holders.server'
import { createSessionValue, type SessionUser } from '../session'
import { POST as uploadHandler } from '../../app/api/attachments/upload/route'
import { GET as attachmentGetHandler } from '../../app/api/attachments/[id]/route'
import { DELETE as attachmentDeleteHandler } from '../../app/api/attachments/[id]/route'

// ─── 最小 R2 桩 ─────────────────────────────────────────────
class FakeBucket {
  objects = new Map<string, { bytes: Uint8Array; contentType?: string }>()
  async put(key: string, body: ArrayBuffer | Uint8Array | string, opts?: { httpMetadata?: { contentType?: string } }) {
    const bytes =
      typeof body === 'string'
        ? new TextEncoder().encode(body)
        : body instanceof Uint8Array
          ? new Uint8Array(body)
          : new Uint8Array(body)
    this.objects.set(key, { bytes, contentType: opts?.httpMetadata?.contentType })
    return { key }
  }
  async get(key: string) {
    const found = this.objects.get(key)
    if (!found) return null
    const bytes = found.bytes
    return {
      httpMetadata: { contentType: found.contentType },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    }
  }
  async delete(key: string) {
    this.objects.delete(key)
  }
  async list(opts: { prefix?: string; cursor?: string } = {}) {
    const keys = [...this.objects.keys()].filter(key => !opts.prefix || key.startsWith(opts.prefix))
    return { objects: keys.map(key => ({ key })), truncated: false }
  }
}

const SECRET = 'hub156-test-secret'

let db: SqliteD1
let bucket: FakeBucket

function seedBase() {
  return db.exec(`
    INSERT INTO users (id, email, password_hash) VALUES
      ('u1', 'u1@example.com', 'hash'),
      ('u2', 'u2@example.com', 'hash');
    INSERT INTO banks (id, name) VALUES ('b_cmb', '招商银行');
    INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
    VALUES ('cp_cmb', 'b_cmb', '招商银行', '招行经典白金', 'after_billing', 20);
    INSERT INTO card_holders (id, created_by, managed_by, name, auth_user_id) VALUES
      ('h1', 'u1', 'u1', '本人', 'u1'),
      ('h2', 'u2', 'u2', '配偶', 'u2');
    INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day)
    VALUES ('cc_8888', 'h1', 'cp_cmb', '8888', 15);
  `)
}

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n% mock statement\n%%EOF')

async function seedEncryptedDraft() {
  await bucket.put('draft-files/u1/draft_pdf/x.pdf', PDF_BYTES, {
    httpMetadata: { contentType: 'application/pdf' },
  })
  await db.exec(`
    INSERT INTO bill_import_drafts
      (id, created_by, card_id, source_type, raw_text, file_ref, parsed_payload, status,
       parse_status, confidence, created_at)
    VALUES ('draft_pdf', 'u1', 'cc_8888', 'pdf', NULL, 'att_pdf',
            '{"is_bill":true,"warnings":["该 PDF 已加密"]}', 'draft', 'needs_password', NULL,
            '2026-11-01T00:00:00Z');
    INSERT INTO record_attachments
      (id, record_type, record_id, bucket, storage_path, file_name, file_type, file_size,
       uploaded_by, sha256, created_at)
    VALUES ('att_pdf', 'draft', 'draft_pdf', 'record-attachments',
            'draft-files/u1/draft_pdf/x.pdf', 'x.pdf', 'application/pdf', ${PDF_BYTES.length},
            'u1', 'sha_pdf', '2026-11-01T00:00:00Z');
  `)
}

beforeEach(async () => {
  db = createOpportunityDb()
  ensureHub156Schema(db)
  setDb(db as unknown as D1Database)
  bucket = new FakeBucket()
  setWorkerEnv({ SESSION_SECRET: SECRET, ATTACHMENTS: bucket })
  await seedBase()
  __setPdfDecryptorForTests(null)
  __setBillImportCoreParserForTests(null)
})

afterEach(() => {
  __setPdfDecryptorForTests(null)
  __setBillImportCoreParserForTests(null)
  setDb(null)
  setWorkerEnv({})
  db.close()
})

// ─── importAndParseBill ─────────────────────────────────────

describe('billDrafts.importAndParseBill', () => {
  it('文本导入走离线兜底并落草稿，confidence 固定 0.3 且带告警', async () => {
    const result = await importAndParseBill({
      user_id: 'u1',
      source_type: 'text',
      raw_text: '招商银行信用卡 账单金额 ¥1234.56 还款日 2026-12-05',
    })
    expect(result.outcome).toBe('drafts_created')
    expect(result.drafts).toHaveLength(1)
    const draft = result.drafts[0]
    expect(draft.parse_status).toBe('ready')
    expect(draft.confidence).toBe(0.3)
    expect(draft.parsed_payload.warnings?.join('')).toContain('离线')
    expect(draft.parsed_payload.bill_amount).toBeGreaterThan(0)
  })

  it('同一 client_request_id 重放返回原草稿（duplicate_file + deduplicated）', async () => {
    const first = await importAndParseBill({
      user_id: 'u1',
      source_type: 'text',
      raw_text: '账单金额 ¥100.00 还款日 2026-12-05',
      client_request_id: 'share-ext-1',
    })
    expect(first.outcome).toBe('drafts_created')
    const second = await importAndParseBill({
      user_id: 'u1',
      source_type: 'text',
      raw_text: '账单金额 ¥100.00 还款日 2026-12-05',
      client_request_id: 'share-ext-1',
    })
    expect(second.outcome).toBe('duplicate_file')
    expect(second.deduplicated).toBe(true)
    expect(second.drafts[0].id).toBe(first.drafts[0].id)
    const rows = await db.raw.prepare('SELECT COUNT(*) AS n FROM bill_import_drafts').get() as { n: number }
    expect(Number(rows.n)).toBe(1)
  })

  it('未识别出账单且未强制保存 → non_bill_warning 且不落草稿', async () => {
    const parser: BillImportCoreParser = async () => ({
      statements: [],
      isBill: false,
      nonBillReason: '营销邮件',
      needsPassword: false,
      passwordHint: null,
      error: null,
      parser: 'core',
    })
    __setBillImportCoreParserForTests(parser)
    const result = await importAndParseBill({
      user_id: 'u1',
      source_type: 'text',
      raw_text: '双十一刷卡金活动',
    })
    expect(result.outcome).toBe('non_bill_warning')
    expect(result.drafts).toHaveLength(0)
    const rows = await db.raw.prepare('SELECT COUNT(*) AS n FROM bill_import_drafts').get() as { n: number }
    expect(Number(rows.n)).toBe(0)
  })

  it('force_save_non_bill=true 时把非账单也停泊成草稿供人工判断', async () => {
    const parser: BillImportCoreParser = async () => ({
      statements: [],
      isBill: false,
      nonBillReason: '营销邮件',
      needsPassword: false,
      passwordHint: null,
      error: null,
      parser: 'core',
    })
    __setBillImportCoreParserForTests(parser)
    const result = await importAndParseBill({
      user_id: 'u1',
      source_type: 'text',
      raw_text: '双十一刷卡金活动',
      force_save_non_bill: true,
    })
    expect(result.outcome).toBe('non_bill_warning')
    expect(result.drafts).toHaveLength(1)
    expect(result.drafts[0].parsed_payload.is_bill).toBe(false)
  })

  it('多模态内核缺失时图片导入落 parse_failed，绝不伪造成功', async () => {
    await bucket.put('draft-files/u1/d1/a.png', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
      httpMetadata: { contentType: 'image/png' },
    })
    await db.exec(`
      INSERT INTO record_attachments
        (id, record_type, record_id, bucket, storage_path, file_name, file_type, file_size,
         uploaded_by, sha256, created_at)
      VALUES ('att_img', 'draft', 'd1', 'record-attachments', 'draft-files/u1/d1/a.png',
              'a.png', 'image/png', 8, 'u1', 'sha_img', '2026-11-01T00:00:00Z');
    `)
    const result = await importAndParseBill({
      user_id: 'u1',
      source_type: 'image',
      attachment_ids: ['att_img'],
    })
    expect(result.outcome).toBe('parse_failed')
    expect(result.drafts[0].parse_status).toBe('parse_failed')
    expect(result.drafts[0].error_message).toContain('图片')
  })

  it('缺少文本与附件 → VALIDATION_FAILED；超长文本 → VALIDATION_FAILED', async () => {
    await expect(
      importAndParseBill({ user_id: 'u1', source_type: 'text', raw_text: '   ' }),
    ).rejects.toBeInstanceOf(RpcDomainError)
    await expect(
      importAndParseBill({ user_id: 'u1', source_type: 'text', raw_text: 'x'.repeat(20_001) }),
    ).rejects.toThrow(/文本内容不能超过/)
  })

  it('引用他人的草稿附件 → 403（AC-12）', async () => {
    await seedEncryptedDraft()
    await expect(
      importAndParseBill({
        user_id: 'u2',
        source_type: 'pdf',
        attachment_ids: ['att_pdf'],
      }),
    ).rejects.toBeInstanceOf(MemberScopeError)
  })
})

// ─── 归属 fail-closed ───────────────────────────────────────

describe('草稿归属 fail-closed', () => {
  beforeEach(async () => {
    await db.exec(`
      INSERT INTO bill_import_drafts
        (id, created_by, card_id, source_type, parsed_payload, status, confidence, created_at)
      VALUES ('d_own', 'u1', 'cc_8888', 'text', '{"is_bill":true,"bill_amount":100}', 'draft', 0.9,
              '2026-11-01T00:00:00Z');
    `)
  })

  it('getBillImportDraftById 越权抛 MemberScopeError', async () => {
    await expect(getBillImportDraftById('d_own', 'u2')).rejects.toBeInstanceOf(MemberScopeError)
    const own = await getBillImportDraftById('d_own', 'u1')
    expect(own.id).toBe('d_own')
  })

  it('updateBillImportDraft 越权抛错且不落库', async () => {
    await expect(
      updateBillImportDraft('d_own', { parsed_payload: { bill_amount: 1 } }, 'u2'),
    ).rejects.toBeInstanceOf(MemberScopeError)
    const row = await db.raw
      .prepare("SELECT parsed_payload FROM bill_import_drafts WHERE id = 'd_own'")
      .get() as { parsed_payload: string }
    expect(JSON.parse(row.parsed_payload).bill_amount).toBe(100)
  })

  it('discardBillImportDraft 越权抛错，草稿仍是 draft', async () => {
    await expect(discardBillImportDraft('d_own', 'u2')).rejects.toBeInstanceOf(MemberScopeError)
    const row = await db.raw
      .prepare("SELECT status FROM bill_import_drafts WHERE id = 'd_own'")
      .get() as { status: string }
    expect(row.status).toBe('draft')
  })

  it('batchDiscardBillDrafts 混入他人草稿 → 整体 403 且本人草稿未被丢弃', async () => {
    await db.exec(`
      INSERT INTO bill_import_drafts
        (id, created_by, card_id, source_type, parsed_payload, status, confidence, created_at)
      VALUES ('d_own2', 'u1', NULL, 'text', '{"is_bill":true}', 'draft', 0.5, '2026-11-01T00:00:00Z');
    `)
    await expect(
      batchDiscardBillDrafts(['d_own', 'd_own2'], 'u2'),
    ).rejects.toBeInstanceOf(MemberScopeError)
    const rows = await db.raw
      .prepare("SELECT status FROM bill_import_drafts WHERE id IN ('d_own','d_own2')")
      .all() as Array<{ status: string }>
    expect(rows.every(row => row.status === 'draft')).toBe(true)
  })

  it('batchDiscardBillDrafts 对本人草稿返回 discarded_count', async () => {
    await db.exec(`
      INSERT INTO bill_import_drafts
        (id, created_by, card_id, source_type, parsed_payload, status, confidence, created_at)
      VALUES ('d_own2', 'u1', NULL, 'text', '{"is_bill":true}', 'draft', 0.5, '2026-11-01T00:00:00Z');
    `)
    const result = await batchDiscardBillDrafts(['d_own', 'd_own2'], 'u1')
    expect(result.discarded_count).toBe(2)
  })
})

// ─── 确认入账 ───────────────────────────────────────────────

describe('billDrafts.confirmBillImportDraft', () => {
  async function seedDraft(overrides: Partial<BillDraftPayload> = {}) {
    const payload: BillDraftPayload = {
      is_bill: true,
      bill_amount: 1234.56,
      bill_month: '2026-11',
      due_date: '2026-12-05',
      min_payment: 120,
      currency: 'CNY',
      ...overrides,
    }
    return createBillImportDraft({
      created_by: 'u1',
      card_id: 'cc_8888',
      source_type: 'text',
      parsed_payload: payload,
      confidence: 0.95,
    })
  }

  it('确认成功：写 bills、草稿转 confirmed 并回填 confirmed_bill_id', async () => {
    const draft = await seedDraft()
    const bill = await confirmBillImportDraft(draft.id, undefined, 'u1')
    expect(bill.bill_month).toBe('2026-11')
    expect(Number(bill.bill_amount)).toBe(1234.56)
    const row = await db.raw
      .prepare('SELECT status, confirmed_bill_id FROM bill_import_drafts WHERE id = ?')
      .get(draft.id) as { status: string; confirmed_bill_id: string }
    expect(row.status).toBe('confirmed')
    expect(row.confirmed_bill_id).toBe(bill.id)
  })

  it('同卡同月已存在账单 → 409 CONFLICT + reason=DUPLICATE_BILL + existing_bill', async () => {
    await db.exec(`
      INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
      VALUES ('b_exist', 'cc_8888', '2026-11', 1000, '2026-12-05', 'unpaid');
    `)
    const draft = await seedDraft()
    let caught: unknown
    try {
      await confirmBillImportDraft(draft.id, undefined, 'u1')
    } catch (err) {
      caught = err
    }
    expect(caught).toBeInstanceOf(RpcDomainError)
    const error = caught as RpcDomainError
    expect(error.code).toBe('CONFLICT')
    expect(error.status).toBe(409)
    expect(error.details.reason).toBe('DUPLICATE_BILL')
    expect((error.details.existing_bill as { bill_id: string }).bill_id).toBe('b_exist')
    // 未确认的草稿必须留在草稿箱
    const row = await db.raw
      .prepare('SELECT status FROM bill_import_drafts WHERE id = ?')
      .get(draft.id) as { status: string }
    expect(row.status).toBe('draft')
  })

  it('conflict_resolution=merge_update 更新原账单且不新建第二笔', async () => {
    await db.exec(`
      INSERT INTO bills (id, card_id, bill_month, bill_amount, due_date, status)
      VALUES ('b_exist', 'cc_8888', '2026-11', 1000, '2026-12-05', 'unpaid');
    `)
    const draft = await seedDraft()
    const bill = await confirmBillImportDraft(draft.id, { conflict_resolution: 'merge_update' }, 'u1')
    expect(bill.id).toBe('b_exist')
    expect(Number(bill.bill_amount)).toBe(1234.56)
    const count = await db.raw
      .prepare("SELECT COUNT(*) AS n FROM bills WHERE card_id = 'cc_8888' AND bill_month = '2026-11'")
      .get() as { n: number }
    expect(Number(count.n)).toBe(1)
  })

  it('缺还款日 → VALIDATION_FAILED，绝不放行', async () => {
    const draft = await seedDraft({ due_date: null })
    await expect(confirmBillImportDraft(draft.id, undefined, 'u1')).rejects.toThrow(/还款日/)
  })

  it('quick_create_card 快捷建卡后入账', async () => {
    const draft = await createBillImportDraft({
      created_by: 'u1',
      card_id: null,
      source_type: 'text',
      parsed_payload: {
        is_bill: true,
        bill_amount: 88,
        bill_month: '2026-11',
        due_date: '2026-12-05',
      },
      confidence: 0.9,
    })
    const bill = await confirmBillImportDraft(
      draft.id,
      {
        quick_create_card: {
          holder_id: 'h1',
          card_product_id: 'cp_cmb',
          card_number_last4: '6666',
          billing_day: 10,
        },
      },
      'u1',
    )
    expect(bill.card_id).toBeTruthy()
    const card = await db.raw
      .prepare('SELECT card_number_last4 FROM credit_cards WHERE id = ?')
      .get(bill.card_id) as { card_number_last4: string }
    expect(card.card_number_last4).toBe('6666')
  })
})

// ─── 加密 PDF 解锁 ──────────────────────────────────────────

describe('billDrafts.unlockEncryptedDraft', () => {
  it('解锁成功：R2 原位覆盖、草稿转 ready、可选写入密码本', async () => {
    await seedEncryptedDraft()
    __setPdfDecryptorForTests(async () => ({ ok: true, bytes: new TextEncoder().encode('%PDF-1.7\ndecrypted') }))
    __setBillImportCoreParserForTests(async () => ({
      statements: [
        {
          is_bill: true,
          bill_amount: 999,
          bill_month: '2026-11',
          due_date: '2026-12-20',
          currency: 'CNY',
        },
      ],
      isBill: true,
      nonBillReason: null,
      needsPassword: false,
      passwordHint: null,
      error: null,
      parser: 'core',
    }))

    const result = await unlockEncryptedDraft(
      'draft_pdf',
      { password: '1234', save_to_vault: true, vault_label: '招行月结单' },
      'u1',
    )
    expect(result.vault_rule_saved).toBe(true)
    expect(result.drafts[0].parse_status).toBe('ready')
    expect(result.drafts[0].parsed_payload.bill_amount).toBe(999)
    // R2 对象已被脱密内容覆盖
    const stored = bucket.objects.get('draft-files/u1/draft_pdf/x.pdf')
    expect(new TextDecoder().decode(stored?.bytes)).toContain('decrypted')
    // 密码本落库且 DTO 不含密文
    const rules = await listPasswordRules('u1')
    expect(rules).toHaveLength(1)
    expect(rules[0].label).toBe('招行月结单')
    expect(JSON.stringify(rules[0])).not.toContain('password_ciphertext')
    expect(JSON.stringify(rules[0])).not.toContain('1234')
  })

  it('密码错误 → VALIDATION_FAILED，R2 对象保持原样', async () => {
    await seedEncryptedDraft()
    __setPdfDecryptorForTests(async () => ({ ok: false, reason: 'wrong_password' }))
    await expect(
      unlockEncryptedDraft('draft_pdf', { password: 'bad' }, 'u1'),
    ).rejects.toThrow(/密码错误/)
    const stored = bucket.objects.get('draft-files/u1/draft_pdf/x.pdf')
    expect(new TextDecoder().decode(stored?.bytes)).toContain('mock statement')
  })

  it('越权解锁他人草稿 → 403', async () => {
    await seedEncryptedDraft()
    await expect(
      unlockEncryptedDraft('draft_pdf', { password: '1234' }, 'u2'),
    ).rejects.toBeInstanceOf(MemberScopeError)
  })
})

// ─── 密码本 ─────────────────────────────────────────────────

describe('passwordVault', () => {
  it('CRUD 全流程，DTO 物理剥离密文与明文', async () => {
    const created = await createPasswordRule({
      user_id: 'u1',
      label: '招行',
      password: 'pw-secret-1',
      holder_id: 'h1',
      bank_keyword: '招商',
    })
    expect(created.label).toBe('招行')
    expect(created.holder_id).toBe('h1')
    expect(Object.keys(created)).not.toContain('password_ciphertext')

    const raw = await db.raw
      .prepare('SELECT password_ciphertext FROM statement_password_vault WHERE id = ?')
      .get(created.id) as { password_ciphertext: string }
    expect(raw.password_ciphertext.startsWith('v1:')).toBe(true)
    expect(raw.password_ciphertext).not.toContain('pw-secret-1')

    const updated = await updatePasswordRule(created.id, { hint: '身份证后六位' }, 'u1')
    expect(updated.hint).toBe('身份证后六位')

    expect(await deletePasswordRule(created.id, 'u1')).toEqual({ ok: true })
    expect(await listPasswordRules('u1')).toHaveLength(0)
  })

  it('他人规则一律 403（不区分「不存在」）', async () => {
    const created = await createPasswordRule({ user_id: 'u1', label: 'x', password: 'y' })
    await expect(updatePasswordRule(created.id, { label: 'z' }, 'u2')).rejects.toBeInstanceOf(MemberScopeError)
    await expect(deletePasswordRule(created.id, 'u2')).rejects.toBeInstanceOf(MemberScopeError)
    await expect(updatePasswordRule('no-such-id', { label: 'z' }, 'u2')).rejects.toBeInstanceOf(MemberScopeError)
  })
})

// ─── 偏好 / 持卡人别名 ──────────────────────────────────────

describe('import_config 与持卡人别名', () => {
  it('import_config 独立读写，不触碰 display_config 与 reminder_config', async () => {
    await updateUserPreferences('u1', { display_config: { privacy_mode: true } })
    const before = await getUserPreferences('u1')
    expect(before.display_config.privacy_mode).toBe(true)

    expect((await getUserImportPreferences('u1')).import_config.auto_commit_trusted_email).toBe(true)
    const updated = await updateUserImportPreferences('u1', { auto_commit_trusted_email: false })
    expect(updated.import_config.auto_commit_trusted_email).toBe(false)
    expect((await getUserImportPreferences('u1')).import_config.auto_commit_trusted_email).toBe(false)

    const after = await getUserPreferences('u1')
    expect(after.display_config.privacy_mode).toBe(true)
  })

  it('updateMyHolderAliases 只允许改本人档案', async () => {
    const updated = await updateMyHolderAliases('h1', ['Bo Hu', '胡博'], 'u1')
    expect(updated.aliases).toEqual(['Bo Hu', '胡博'])
    const raw = await db.raw
      .prepare("SELECT aliases FROM card_holders WHERE id = 'h1'")
      .get() as { aliases: string }
    expect(JSON.parse(raw.aliases)).toEqual(['Bo Hu', '胡博'])

    await expect(updateMyHolderAliases('h2', ['x'], 'u1')).rejects.toBeInstanceOf(MemberScopeError)
  })
})

// ─── 迁移落地前后都能跑（合入顺序不是运行时前提）──────────────────────────
//
// HUB-155 的 0034–0036 与本模块并行开发；这里用「只跑 0001–0033 的裸库」
// 验证列缺失时写入不 500、读取回落默认值。

describe('0034–0036 未落地时的降级', () => {
  let bareDb: SqliteD1

  beforeEach(async () => {
    bareDb = createOpportunityDb()
    setDb(bareDb as unknown as D1Database)
    setWorkerEnv({ SESSION_SECRET: SECRET, ATTACHMENTS: new FakeBucket() })
    await bareDb.exec(`
      INSERT INTO users (id, email, password_hash) VALUES ('u1', 'u1@example.com', 'hash');
      INSERT INTO banks (id, name) VALUES ('b_cmb', '招商银行');
      INSERT INTO card_products (id, bank_id, bank_name, card_name, payment_due_type, payment_due_value)
      VALUES ('cp_cmb', 'b_cmb', '招商银行', '招行经典白金', 'after_billing', 20);
      INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h1', 'u1', 'u1', '本人');
      INSERT INTO credit_cards (id, holder_id, card_product_id, card_number_last4, billing_day)
      VALUES ('cc_8888', 'h1', 'cp_cmb', '8888', 15);
    `)
  })

  afterEach(() => {
    setDb(null)
    setWorkerEnv({})
    bareDb.close()
  })

  it('草稿仍可创建与读取，新列回落默认值', async () => {
    const draft = await createBillImportDraft({
      created_by: 'u1',
      card_id: 'cc_8888',
      source_type: 'text',
      parsed_payload: { is_bill: true, bill_amount: 100, bill_month: '2026-11', due_date: '2026-12-05' },
      confidence: 0.9,
      parse_status: 'ready',
      holder_id: 'h1',
    })
    expect(draft.parse_status).toBe('ready')
    expect(draft.holder_id).toBeNull() // 列不存在 → 读回落 null
    expect(draft.attribution_trusted).toBe(false)

    const updated = await updateBillImportDraft(draft.id, { parsed_payload: { bill_amount: 200 } }, 'u1')
    expect(updated.parsed_payload.bill_amount).toBe(200)

    const bill = await confirmBillImportDraft(draft.id, undefined, 'u1')
    expect(Number(bill.bill_amount)).toBe(200)
  })
})

// ─── 附件两段式契约（HUB-154 §3.2 / AC-12）────────────────────────────────

describe('附件上传与读取的越权边界', () => {
  const sessionUser = (id: string, role: 'admin' | 'member'): SessionUser => ({
    id,
    email: `${id}@example.com`,
    name: id,
    role,
    created_at: '2026-01-01T00:00:00Z',
  })

  function uploadRequest(file: File, recordType = 'draft', recordId = 'draft-1', token?: string) {
    const form = new FormData()
    form.set('record_type', recordType)
    form.set('record_id', recordId)
    form.set('file', file)
    return new Request('https://app.all-bill.com/api/attachments/upload', {
      method: 'POST',
      body: form,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    })
  }

  it('未登录 → 401', async () => {
    const res = await uploadHandler(uploadRequest(new File(['%PDF-1.7'], 'a.pdf', { type: 'application/pdf' })))
    expect(res.status).toBe(401)
  })

  it('超过 10MB 的草稿附件 → 413 且不落 R2', async () => {
    const token = await createSessionValue(sessionUser('u1', 'admin'))
    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' })
    const res = await uploadHandler(uploadRequest(big, 'draft', 'draft-1', token))
    expect(res.status).toBe(413)
    expect(bucket.objects.size).toBe(0)
  })

  it('魔数不匹配的「PDF」→ 415（MIME 头可伪造，只认字节）', async () => {
    const token = await createSessionValue(sessionUser('u1', 'admin'))
    const fake = new File([new TextEncoder().encode('not a pdf at all')], 'fake.pdf', {
      type: 'application/pdf',
    })
    const res = await uploadHandler(uploadRequest(fake, 'draft', 'draft-1', token))
    expect(res.status).toBe(415)
  })

  it('合法 PDF → 200 + sha256，并登记到 record_attachments', async () => {
    const token = await createSessionValue(sessionUser('u1', 'admin'))
    const res = await uploadHandler(uploadRequest(new File([PDF_BYTES], 'x.pdf', { type: 'application/pdf' }), 'draft', 'draft-1', token))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { data: { sha256: string; record_type: string } }
    expect(body.data.record_type).toBe('draft')
    expect(body.data.sha256).toMatch(/^[0-9a-f]{64}$/)
    const row = await db.raw
      .prepare('SELECT sha256, storage_path, uploaded_by FROM record_attachments')
      .get() as { sha256: string; storage_path: string; uploaded_by: string }
    expect(row.uploaded_by).toBe('u1')
    expect(row.storage_path).toContain('draft-files/u1/draft-1/')
    expect(row.sha256).toBe(body.data.sha256)
  })

  it('成员给非本人 bill 传附件 → 403', async () => {
    // member 只有 u2，且没有绑定任何持卡人 → 对 cc_8888（属于 h1/u1）无权限
    const token = await createSessionValue(sessionUser('u2', 'member'))
    const res = await uploadHandler(
      uploadRequest(new File([PDF_BYTES], 'x.pdf', { type: 'application/pdf' }), 'bill', 'cc_8888', token),
    )
    expect(res.status).toBe(403)
  })

  it('他人读取草稿附件 → 403；本人 → 200', async () => {
    const ownerToken = await createSessionValue(sessionUser('u1', 'admin'))
    const otherToken = await createSessionValue(sessionUser('u2', 'admin'))
    const upload = await uploadHandler(
      uploadRequest(new File([PDF_BYTES], 'x.pdf', { type: 'application/pdf' }), 'draft', 'draft-1', ownerToken),
    )
    const attachmentId = ((await upload.json()) as { data: { id: string } }).data.id
    const params = Promise.resolve({ id: attachmentId })

    const denied = await attachmentGetHandler(
      new Request(`https://app.all-bill.com/api/attachments/${attachmentId}`, {
        headers: { Authorization: `Bearer ${otherToken}` },
      }),
      { params },
    )
    expect(denied.status).toBe(403)

    const allowed = await attachmentGetHandler(
      new Request(`https://app.all-bill.com/api/attachments/${attachmentId}`, {
        headers: { Authorization: `Bearer ${ownerToken}` },
      }),
      { params },
    )
    expect(allowed.status).toBe(200)
    expect(new TextDecoder().decode(await allowed.arrayBuffer())).toContain('mock statement')
  })

  it('他人删除草稿附件 → 403 且附件仍在', async () => {
    const ownerToken = await createSessionValue(sessionUser('u1', 'admin'))
    const otherToken = await createSessionValue(sessionUser('u2', 'admin'))
    const upload = await uploadHandler(
      uploadRequest(new File([PDF_BYTES], 'x.pdf', { type: 'application/pdf' }), 'draft', 'draft-1', ownerToken),
    )
    const attachmentId = ((await upload.json()) as { data: { id: string } }).data.id
    const params = Promise.resolve({ id: attachmentId })

    const denied = await attachmentDeleteHandler(
      new Request(`https://app.all-bill.com/api/attachments/${attachmentId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${otherToken}` },
      }),
      { params },
    )
    expect(denied.status).toBe(403)
    const row = await db.raw
      .prepare('SELECT COUNT(*) AS n FROM record_attachments WHERE id = ?')
      .get(attachmentId) as { n: number }
    expect(Number(row.n)).toBe(1)
  })
})
