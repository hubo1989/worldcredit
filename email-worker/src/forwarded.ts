import { ingestStatementEmail, type EmailIngestOptions } from '../../lib/email-core/ingest'
import { parseRawMessage } from '../../lib/email-core/mime'

/** A forwarded bundle and a standalone statement share the same ingestion path. */
export async function processEmailDelivery(
  raw: Uint8Array<ArrayBuffer>,
  options: Omit<EmailIngestOptions, 'top' | 'deliveryId'>,
) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', raw))
  const deliveryId = 'email:' + Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')
  return ingestStatementEmail({ ...options, top: parseRawMessage(raw), deliveryId })
}
