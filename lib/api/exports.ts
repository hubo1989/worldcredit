// lib/api/exports.ts — client-side RPC wrappers (server: exports.server.ts).
import type * as Server from './exports.server'
import { callRpc } from './rpc-client'

export type {
  CsvRowsResult,
  ExportTable,
  FamilyExportRequest,
  FamilyStatementReport,
  StatementBill,
  StatementInstallment,
  StatementItem,
  StatementPayable,
  StatementPayment,
} from './exports.server'

export function exportFamilyCsvRows(...args: Parameters<typeof Server.exportFamilyCsvRows>) {
  return callRpc<typeof Server.exportFamilyCsvRows>('exports', 'exportFamilyCsvRows', ...args)
}

export function getStatementReport(...args: Parameters<typeof Server.getStatementReport>) {
  return callRpc<typeof Server.getStatementReport>('exports', 'getStatementReport', ...args)
}
