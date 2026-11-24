import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { decryptPDF, isExtractedPdfTextUsable, prepareStatementPdf } from '../email-core/pdf'
import { decryptVaultPassword, encryptVaultPassword } from '../email-core/vault-crypto'
import { parseMultimodalStatement } from '../email-core/multimodal'
import { createOpportunityDb } from './helpers/sqlite-d1'

const password = 'fixture-7491'
const secret = 'test-only-vault-secret'
const config = { baseURL: 'https://example.test/v1', apiKey: 'test-key', model: 'test-model' }
const sampleText = 'Statement date 2026-10-16, Account Ending 7491, Total amount due 1234.56 USD, payment due 2026-11-10.'

function encryptedFixture(algorithm: string) {
  // Synthetic PDF generated with pdf-lib and encrypted with pypdf.
  return new Uint8Array(readFileSync(new URL(
    `../../email-worker/__tests__/fixtures/statement-${algorithm}.pdf`, import.meta.url,
  )))
}

afterEach(() => vi.unstubAllGlobals())

describe('PDF preparation', () => {
  it('extracts the first six pages and the last page without consuming the source bytes', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (let index = 0; index < 9; index++) {
      doc.addPage().drawText(`Marker_${index} ${sampleText}`, { font, x: 10, y: 600, size: 9 })
    }
    const bytes = await doc.save()
    const prepared = await prepareStatementPdf(bytes, { userId: 'u' })
    expect(prepared).toMatchObject({ status: 'ready', visionBytes: null })
    if (prepared.status !== 'ready') throw new Error('PDF was not ready')
    expect(prepared.text).toContain('Marker_5')
    expect(prepared.text).toContain('Marker_8')
    expect(prepared.text).not.toMatch(/Marker_[67]/)
    expect(bytes.byteLength).toBeGreaterThan(0)
    expect(isExtractedPdfTextUsable('\uFFFD'.repeat(100) + '1234')).toBe(false)
  })

  it.each(['rc4-128', 'aes-128', 'aes-256'])('validates and unlocks a %s statement', async algorithm => {
    const bytes = encryptedFixture(algorithm)
    expect(await decryptPDF(bytes, 'wrong')).toEqual({ ok: false, reason: 'wrong_password' })
    const unlocked = await decryptPDF(bytes, password)
    expect(unlocked.ok).toBe(true)
    if (!unlocked.ok) throw new Error('fixture failed to unlock')
    expect((await PDFDocument.load(unlocked.bytes)).isEncrypted).toBe(false)
    expect(await prepareStatementPdf(bytes, { userId: 'u' })).toEqual({ status: 'needs_password', suggestedHint: null })
    expect(await prepareStatementPdf(bytes, { userId: 'u', adhocPassword: password })).toMatchObject({
      status: 'ready', text: expect.stringContaining('1234.56 USD'), visionBytes: null,
    })
  })

  it('limits the dictionary to eight scoped entries and counts only the match', async () => {
    const db = createOpportunityDb()
    try {
      db.exec(`INSERT INTO users (id, email, password_hash) VALUES ('u', 'u@example.test', 'x'), ('v', 'v@example.test', 'x');
        INSERT INTO card_holders (id, created_by, managed_by, name) VALUES ('h', 'u', 'u', 'Holder')`)
      const salt = await encryptVaultPassword(password, secret, 'u')
      const anotherUser = await encryptVaultPassword(password, secret, 'v')
      db.exec(`INSERT INTO statement_password_vault (id, user_id, label, holder_id, bank_keyword, password_ciphertext)
        VALUES ('foreign', 'v', 'foreign', NULL, NULL, '${anotherUser}'),
          ('winner', 'u', 'holder only', 'h', 'chase', '${salt}')`)
      db.exec(`INSERT INTO statement_password_vault (id, user_id, label, password_ciphertext, created_at)
        VALUES ('ninth', 'u', 'excluded by limit', '${salt}', '2099-01-01')`)
      for (let i = 0; i < 8; i++) {
        const ciphertext = await encryptVaultPassword('wrong-' + i, secret, 'u')
        await db.prepare(
          "INSERT INTO statement_password_vault (id, user_id, label, password_ciphertext) VALUES (?, 'u', 'test', ?)",
        ).bind(`wrong-${i}`, ciphertext).run()
      }
      const options = { db: db as unknown as D1Database, userId: 'u', secret, context: 'Chase monthly statement' }
      expect(await prepareStatementPdf(encryptedFixture('aes-128'), options)).toMatchObject({ status: 'needs_password' })
      expect(await prepareStatementPdf(encryptedFixture('aes-128'), { ...options, holderId: 'h' })).toMatchObject({ status: 'ready' })
      expect(db.raw.prepare('SELECT id, use_count FROM statement_password_vault WHERE use_count > 0').all())
        .toEqual([{ id: 'winner', use_count: 1 }])
    } finally {
      db.close()
    }
  })

  it('crops a large textless PDF and sends it as a file without passing the password', async () => {
    const doc = await PDFDocument.create()
    for (let index = 0; index < 8; index++) doc.addPage()
    const source = await doc.save({ useObjectStreams: false })
    // Insert a large legal PDF comment before %%EOF, keeping the original xref offsets.
    const eof = source.length - '%%EOF'.length
    const large = new Uint8Array(source.length + 4 * 1024 * 1024)
    large.set(source.subarray(0, eof))
    const filler = new TextEncoder().encode('% statement scan padding\n'.repeat(161_320))
    for (let offset = eof; offset < large.length - 5; offset += filler.length) {
      large.set(filler.subarray(0, Math.min(filler.length, large.length - 5 - offset)), offset)
    }
    large[large.length - 6] = 10
    large.set(source.subarray(eof), large.length - 5)
    const model = vi.fn(async (_url: string, init?: RequestInit) => {
      const request = String(init?.body)
      expect(request).not.toContain(password)
      const part = JSON.parse(request).messages[1].content[1]
      expect(part.type).toBe('file')
      const vision = await PDFDocument.load(Buffer.from(part.file.file_data.split(',')[1], 'base64'))
      expect(vision.getPageCount()).toBe(5)
      return Response.json({ choices: [{ message: { content: JSON.stringify({
        is_bill: true, email_kind: 'statement', statements: [{ currency: 'CNY', bill_amount: 300 }, { currency: 'USD', bill_amount: 15 }],
      }) } }] })
    })
    vi.stubGlobal('fetch', model)
    const outcome = await parseMultimodalStatement({
      config, userId: 'u', pdf: { bytes: large, contentType: 'application/pdf' }, adhocPassword: password,
    })
    expect(outcome).toMatchObject({
      status: 'ready', envelope: { statements: [{ currency: 'CNY', bill_amount: 300 }, { currency: 'USD', bill_amount: 15 }] },
    })
    expect(model).toHaveBeenCalledOnce()
  })

  it('passes representable screenshots as image messages', async () => {
    const model = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body)).messages[1].content[1]).toMatchObject({
        type: 'image_url', image_url: { url: expect.stringMatching(/^data:image\/png;base64,/) },
      })
      return Response.json({ choices: [{ message: { content: '{"is_bill":false}' } }] })
    })
    vi.stubGlobal('fetch', model)
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgLsAAAAASUVORK5CYII=', 'base64'))
    expect(await parseMultimodalStatement({
      config, userId: 'u', images: [{ bytes: png, contentType: 'image/png' }],
    })).toMatchObject({ status: 'ready', envelope: { is_bill: false } })
    expect(model).toHaveBeenCalledOnce()
  })
})

it('encrypts with fresh IVs and rejects tampering, the wrong user and the wrong secret', async () => {
  const ciphertext = await encryptVaultPassword(password, secret, 'u')
  expect(ciphertext).toMatch(/^v1:[A-Za-z0-9_-]+$/)
  expect(ciphertext).not.toContain(password)
  expect(await encryptVaultPassword(password, secret, 'u')).not.toBe(ciphertext)
  await expect(decryptVaultPassword(ciphertext, secret, 'u')).resolves.toBe(password)
  await expect(decryptVaultPassword(ciphertext, secret, 'v')).rejects.toThrow()
  await expect(decryptVaultPassword(ciphertext, 'wrong', 'u')).rejects.toThrow()
  const tampered = ciphertext.slice(0, 8) + (ciphertext[8] === 'A' ? 'B' : 'A') + ciphertext.slice(9)
  await expect(decryptVaultPassword(tampered, secret, 'u')).rejects.toThrow()
})
