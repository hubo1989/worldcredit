// lib/api/passwordVault.server.ts — 月结单密码本（server only）。
//
// 明文密码「只写不读」：所有对外 DTO 物理剥离 password_ciphertext 与明文，
// 解密只发生在 lib/email-core 的 PDF 验密管道内部（HUB-155）。
//
// 密钥派生与 lib/gmail/token-crypto.ts 完全域隔离：salt / info 都不同，
// 即使两处共用 SESSION_SECRET，密文也不可互解（HUB-154 §1.3）。
//   salt = "worldcredit-statement-vault"
//   info  = "pdf-password-vault/v1:" + userId   ← 绑定 userId，跨用户密文不可互解

import { query, queryOne, execute, uuid } from '../db'
import { getWorkerEnv } from '../db/client'
import { toB64Url, fromB64Url } from '../base64url'
import { MemberScopeError } from './member-scope'
import { RpcDomainError } from './errors'

const VAULT_SALT = 'worldcredit-statement-vault'
const VAULT_INFO_PREFIX = 'pdf-password-vault/v1:'
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export class PasswordVaultCryptoError extends Error {}

export interface StatementPasswordRule {
  id: string
  user_id: string
  label: string
  holder_id: string | null
  bank_id: string | null
  bank_keyword: string | null
  hint: string | null
  use_count: number
  last_used_at: string | null
  created_at: string
  updated_at: string
}

/** 对外 DTO：不含 password_ciphertext，也不含明文。 */
export type StatementPasswordRuleDto = Omit<StatementPasswordRule, 'user_id'>

export interface StatementPasswordRuleInput {
  user_id?: string
  label?: string
  password?: string
  holder_id?: string | null
  bank_id?: string | null
  bank_keyword?: string | null
  hint?: string | null
}

function resolveSecret(): string {
  const env = getWorkerEnv() as { SESSION_SECRET?: string } | undefined
  const secret =
    env?.SESSION_SECRET ??
    (typeof process !== 'undefined' ? (process.env?.SESSION_SECRET ?? '') : '')
  if (!secret) throw new PasswordVaultCryptoError('SESSION_SECRET 未配置，无法加密月结单密码')
  return secret
}

async function deriveKey(secret: string, userId: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    'HKDF',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: encoder.encode(VAULT_SALT),
      info: encoder.encode(VAULT_INFO_PREFIX + userId),
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** 密文格式：`v1:` + base64url(12B IV || AES-GCM CT)，版本前缀便于将来轮换 KDF。 */
export async function encryptVaultPassword(plain: string, userId: string): Promise<string> {
  const key = await deriveKey(resolveSecret(), userId)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(plain)),
  )
  const joined = new Uint8Array(iv.length + ct.length)
  joined.set(iv, 0)
  joined.set(ct, iv.length)
  return 'v1:' + toB64Url(joined)
}

export async function decryptVaultPassword(ciphertext: string, userId: string): Promise<string> {
  if (!ciphertext.startsWith('v1:')) {
    throw new PasswordVaultCryptoError('密码本密文版本不受支持')
  }
  const joined = fromB64Url(ciphertext.slice(3))
  if (joined.length <= 12) throw new PasswordVaultCryptoError('密码本密文长度非法')
  try {
    const key = await deriveKey(resolveSecret(), userId)
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: joined.slice(0, 12) },
      key,
      joined.slice(12),
    )
    return decoder.decode(plain)
  } catch {
    throw new PasswordVaultCryptoError('密码本解密失败（密钥不匹配或密文被篡改）')
  }
}

function toDto(row: StatementPasswordRule): StatementPasswordRuleDto {
  // 显式重建对象而不是展开 row：password_ciphertext 即使将来被加进 SELECT 也不会外泄。
  return {
    id: row.id,
    label: row.label,
    holder_id: row.holder_id,
    bank_id: row.bank_id,
    bank_keyword: row.bank_keyword,
    hint: row.hint,
    use_count: row.use_count,
    last_used_at: row.last_used_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

/**
 * 按四级优先级取最多 8 条候选（HUB-154 §1.2 Step 2）：
 *   0) 持卡人 + 银行/关键词命中
 *   1) 持卡人 + 通用规则
 *   2) 仅银行/关键词命中
 *   3) 通用兜底
 * 同级内按 last_used_at DESC, use_count DESC, created_at ASC。
 */
const CANDIDATE_ORDER_SQL = [
  'ORDER BY',
  '  CASE',
  "    WHEN holder_id IS ? AND (bank_id IS ? OR instr(lower(COALESCE(?, '')), lower(COALESCE(bank_keyword, ''))) > 0) THEN 0",
  "    WHEN holder_id IS ? AND bank_id IS NULL AND COALESCE(bank_keyword, '') = '' THEN 1",
  "    WHEN holder_id IS NULL AND (bank_id IS ? OR instr(lower(COALESCE(?, '')), lower(COALESCE(bank_keyword, ''))) > 0) THEN 2",
  '    ELSE 3',
  '  END,',
  '  last_used_at DESC,',
  '  use_count DESC,',
  '  created_at ASC',
].join('\n')

/** 仅服务端内部（PDF 验密管道）使用；绝不进 RPC 返回值。 */
export async function loadVaultPasswordCandidates(params: {
  userId: string
  holderId?: string | null
  bankId?: string | null
  context?: string | null
  limit?: number
}): Promise<Array<{ rule: StatementPasswordRuleDto; password: string }>> {
  const limit = Math.min(Math.max(params.limit ?? 8, 1), 8)
  const { data, error } = await query<StatementPasswordRule & { password_ciphertext: string }>(
    `SELECT * FROM statement_password_vault WHERE user_id = ? ${CANDIDATE_ORDER_SQL} LIMIT ?`,
    [
      params.userId,
      params.holderId ?? null,
      params.bankId ?? null,
      params.context ?? '',
      params.holderId ?? null,
      params.bankId ?? null,
      params.context ?? '',
      limit,
    ],
  )
  if (error) throw new Error(error.message)

  const out: Array<{ rule: StatementPasswordRuleDto; password: string }> = []
  for (const row of data || []) {
    try {
      const password = await decryptVaultPassword(row.password_ciphertext, params.userId)
      out.push({ rule: toDto(row), password })
    } catch {
      // 单条密文损坏不应让整本密码本不可用：跳过并继续。
    }
  }
  return out
}

export async function markVaultRuleUsed(ruleId: string): Promise<void> {
  const ts = new Date().toISOString()
  await execute(
    'UPDATE statement_password_vault SET use_count = use_count + 1, last_used_at = ?, updated_at = ? WHERE id = ?',
    [ts, ts, ruleId],
  )
}

function assertText(value: unknown, field: string, max = 120): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new RpcDomainError('VALIDATION_FAILED', `${field}不能为空`)
  }
  const trimmed = value.trim()
  if (trimmed.length > max) {
    throw new RpcDomainError('VALIDATION_FAILED', `${field}长度不能超过 ${max} 个字符`)
  }
  return trimmed
}

export async function listPasswordRules(userId: string): Promise<StatementPasswordRuleDto[]> {
  if (!userId) throw new MemberScopeError('未登录，无法读取密码本')
  const { data, error } = await query<StatementPasswordRule>(
    'SELECT * FROM statement_password_vault WHERE user_id = ? ORDER BY created_at ASC',
    [userId],
  )
  if (error) throw new Error(error.message)
  return (data || []).map(toDto)
}

export async function createPasswordRule(
  input: StatementPasswordRuleInput,
): Promise<StatementPasswordRuleDto> {
  if (!input || typeof input !== 'object') {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少密码本规则参数')
  }
  const userId = input.user_id
  if (!userId) throw new MemberScopeError('未登录，无法保存密码本')
  const label = assertText(input.label, '规则名称')
  const password = assertText(input.password, '密码', 200)

  const id = uuid()
  const ciphertext = await encryptVaultPassword(password, userId)
  const ts = new Date().toISOString()
  const { error } = await execute(
    `INSERT INTO statement_password_vault
       (id, user_id, label, holder_id, bank_id, bank_keyword, password_ciphertext, hint,
        use_count, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    [
      id,
      userId,
      label,
      input.holder_id ?? null,
      input.bank_id ?? null,
      input.bank_keyword?.trim() || null,
      ciphertext,
      input.hint?.trim() || null,
      ts,
      ts,
    ],
  )
  if (error) throw new Error(error.message)
  return getPasswordRuleOrThrow(id, userId)
}

export async function updatePasswordRule(
  ruleId: string,
  input: Omit<StatementPasswordRuleInput, 'user_id'>,
  userId: string,
): Promise<StatementPasswordRuleDto> {
  if (typeof ruleId !== 'string' || !ruleId) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少密码本规则 ID')
  }
  if (!userId) throw new MemberScopeError('未登录，无法修改密码本')
  await getPasswordRuleOrThrow(ruleId, userId)

  const fields: string[] = []
  const params: unknown[] = []
  if (input.label !== undefined) {
    fields.push('label = ?')
    params.push(assertText(input.label, '规则名称'))
  }
  if (input.holder_id !== undefined) {
    fields.push('holder_id = ?')
    params.push(input.holder_id)
  }
  if (input.bank_id !== undefined) {
    fields.push('bank_id = ?')
    params.push(input.bank_id)
  }
  if (input.bank_keyword !== undefined) {
    fields.push('bank_keyword = ?')
    params.push(input.bank_keyword?.trim() || null)
  }
  if (input.hint !== undefined) {
    fields.push('hint = ?')
    params.push(input.hint?.trim() || null)
  }
  if (input.password !== undefined) {
    fields.push('password_ciphertext = ?')
    params.push(await encryptVaultPassword(assertText(input.password, '密码', 200), userId))
  }
  if (fields.length === 0) {
    throw new RpcDomainError('VALIDATION_FAILED', '没有需要更新的字段')
  }
  fields.push('updated_at = ?')
  params.push(new Date().toISOString(), ruleId)
  const { error } = await execute(
    `UPDATE statement_password_vault SET ${fields.join(', ')} WHERE id = ?`,
    params,
  )
  if (error) throw new Error(error.message)
  return getPasswordRuleOrThrow(ruleId, userId)
}

export async function deletePasswordRule(ruleId: string, userId: string): Promise<{ ok: true }> {
  if (typeof ruleId !== 'string' || !ruleId) {
    throw new RpcDomainError('VALIDATION_FAILED', '缺少密码本规则 ID')
  }
  if (!userId) throw new MemberScopeError('未登录，无法删除密码本')
  await getPasswordRuleOrThrow(ruleId, userId)
  const { error } = await execute('DELETE FROM statement_password_vault WHERE id = ?', [ruleId])
  if (error) throw new Error(error.message)
  return { ok: true }
}

async function getPasswordRuleOrThrow(
  ruleId: string,
  userId: string,
): Promise<StatementPasswordRuleDto> {
  const { data, error } = await queryOne<StatementPasswordRule>(
    'SELECT * FROM statement_password_vault WHERE id = ?',
    [ruleId],
  )
  if (error) throw new Error(error.message)
  // 归属校验在读取边界完成：不是本人的规则一律 403，且不区分「不存在」。
  if (!data || data.user_id !== userId) {
    throw new MemberScopeError('无权访问其他用户的密码本规则')
  }
  return toDto(data)
}
