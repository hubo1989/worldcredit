// lib/api/banks.server.ts — 公开只读的银行目录（成员可用，不含任何用户数据）。
import { query } from '../db'

export interface BankOption {
  id: string
  name: string
}

/** 启用中的银行，按名称排序；供固定支出等表单选择归属银行。 */
export async function getBankNames(): Promise<BankOption[]> {
  const { data, error } = await query<BankOption>(
    'SELECT id, name FROM banks WHERE is_active = 1 ORDER BY name'
  )
  if (error) throw new Error(error.message)
  return data ?? []
}
