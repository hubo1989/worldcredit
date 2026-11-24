import { md5, RC4, concat } from '@pdfsmaller/pdf-decrypt'
import {
  PDFArray, PDFDict, PDFDocument, PDFHexString, PDFName, PDFNumber, PDFRawStream, PDFRef, PDFString,
  type PDFObject,
} from 'pdf-lib'
import type { PdfDecryptResult } from './pdf'

const padding = new Uint8Array([
  0x28, 0xbf, 0x4e, 0x5e, 0x4e, 0x75, 0x8a, 0x41, 0x64, 0x00, 0x4e, 0x56, 0xff, 0xfa, 0x01, 0x08,
  0x2e, 0x2e, 0x00, 0xb6, 0xd0, 0x68, 0x3e, 0x80, 0x2f, 0x0c, 0xa9, 0xfe, 0x64, 0x53, 0x69, 0x7a,
])
const aesSalt = new Uint8Array([0x73, 0x41, 0x6c, 0x54])

function pdfBytes(value: PDFObject | undefined): Uint8Array | undefined {
  if (value instanceof PDFString || value instanceof PDFHexString) return value.asBytes()
}

function stretchedMd5(bytes: Uint8Array): Uint8Array {
  let key = md5(bytes)
  for (let round = 0; round < 50; round++) key = md5(key)
  return key
}

function rc4Rounds(bytes: Uint8Array, key: Uint8Array, backwards: boolean): Uint8Array {
  let result = bytes
  for (let round = 0; round < 20; round++) {
    result = new RC4(key.map(value => value ^ (backwards ? 19 - round : round))).process(result)
  }
  return result
}

type CryptMethod = '/AESV2' | '/V2' | '/None'
function cryptMethod(dict: PDFDict, field: string): CryptMethod {
  const filter = dict.lookup(PDFName.of(field))?.toString() ?? '/Identity'
  if (filter === '/Identity') return '/None'
  const filters = dict.lookup(PDFName.of('CF'), PDFDict)
  const method = filters.lookup(PDFName.of(filter.slice(1)), PDFDict).lookup(PDFName.of('CFM'))?.toString()
  if (method === '/AESV2' || method === '/V2' || method === '/None') return method
  throw new Error('Unsupported crypt filter')
}

type DecryptObject = (bytes: Uint8Array, method: CryptMethod) => Promise<Uint8Array>
async function decryptStrings(object: PDFObject, method: CryptMethod, decrypt: DecryptObject): Promise<PDFObject> {
  if (method === '/None') return object
  const bytes = pdfBytes(object)
  if (bytes) {
    const decoded = await decrypt(bytes, method)
    return PDFHexString.of(Array.from(decoded, byte => byte.toString(16).padStart(2, '0')).join(''))
  }
  if (object instanceof PDFDict) {
    if (object.get(PDFName.of('Type'))?.toString() === '/Sig') return object
    for (const [key, value] of object.entries()) {
      const changed = await decryptStrings(value, method, decrypt)
      if (changed !== value) object.set(key, changed)
    }
  } else if (object instanceof PDFArray) {
    for (let index = 0; index < object.size(); index++) {
      const value = object.get(index)
      if (value) object.set(index, await decryptStrings(value, method, decrypt))
    }
  }
  return object
}

/** Standard security handler V4/R4 (AES-128 or RC4 crypt filters). */
export async function decryptLegacyPdf(input: Uint8Array, password: string): Promise<PdfDecryptResult> {
  const unsupported = { ok: false, reason: 'unsupported' } as const
  try {
    const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false })
    const { context } = doc
    const trailer = context.trailerInfo
    const dict = context.lookup(trailer.Encrypt, PDFDict)
    const readNumber = (name: string) => dict.lookup(PDFName.of(name), PDFNumber).asNumber()
    if (dict.lookup(PDFName.of('Filter'))?.toString() !== '/Standard' ||
        readNumber('V') !== 4 || readNumber('R') !== 4 || readNumber('Length') !== 128) return unsupported
    const owner = pdfBytes(dict.lookup(PDFName.of('O')))
    const user = pdfBytes(dict.lookup(PDFName.of('U')))
    const fileId = pdfBytes(context.lookup(trailer.ID, PDFArray).lookup(0))
    if (owner?.length !== 32 || user?.length !== 32 || !fileId) return unsupported
    const permissions = new Uint8Array(4)
    new DataView(permissions.buffer).setInt32(0, readNumber('P'), true)
    const encryptMetadata = dict.get(PDFName.of('EncryptMetadata'))?.toString() !== 'false'
    const metadataFlag = encryptMetadata ? new Uint8Array() : new Uint8Array(4).fill(0xff)
    const padded = concat(Uint8Array.from(password.slice(0, 32), char => char.charCodeAt(0)), padding).slice(0, 32)
    function fileKey(candidate: Uint8Array): Uint8Array | null {
      const key = stretchedMd5(concat(candidate, owner!, permissions, fileId!, metadataFlag))
      const check = rc4Rounds(md5(concat(padding, fileId!)), key, false)
      return check.every((value, index) => value === user![index]) ? key : null
    }
    const key = fileKey(padded) ?? fileKey(rc4Rounds(owner, stretchedMd5(padded), true))
    if (!key) return { ok: false, reason: 'wrong_password' }

    const streamMethod = cryptMethod(dict, 'StmF')
    const stringMethod = cryptMethod(dict, 'StrF')
    for (const [ref, object] of context.enumerateIndirectObjects()) {
      if (ref === trailer.Encrypt) continue
      const number = ref.objectNumber
      const generation = ref.generationNumber
      const suffix = new Uint8Array([number, number >> 8, number >> 16, generation, generation >> 8])
      const decrypt: DecryptObject = async (bytes, method) => {
        if (method === '/None') return bytes
        if (method === '/V2') return new RC4(md5(concat(key, suffix))).process(bytes)
        const secret = await crypto.subtle.importKey('raw', md5(concat(key, suffix, aesSalt)).slice(), 'AES-CBC', false, ['decrypt'])
        return new Uint8Array(await crypto.subtle.decrypt(
          { name: 'AES-CBC', iv: bytes.slice(0, 16) }, secret, bytes.slice(16),
        ))
      }
      if (object instanceof PDFRawStream) {
        const type = object.dict.get(PDFName.of('Type'))?.toString()
        if (type === '/XRef' || type === '/ObjStm' || type === '/Sig') {
          if (type === '/ObjStm') return unsupported
          continue
        }
        // Explicit per-stream crypt filters need their own filter chain.
        if (object.dict.get(PDFName.of('Filter'))?.toString().includes('/Crypt')) return unsupported
        const data = type === '/Metadata' && !encryptMetadata ? object.contents : await decrypt(object.contents, streamMethod)
        await decryptStrings(object.dict, stringMethod, decrypt)
        context.assign(ref, PDFRawStream.of(object.dict, data))
      } else {
        const changed = await decryptStrings(object, stringMethod, decrypt)
        if (changed !== object) context.assign(ref, changed)
      }
    }
    if (trailer.Encrypt instanceof PDFRef) context.delete(trailer.Encrypt)
    delete trailer.Encrypt
    return { ok: true, bytes: await doc.save({ useObjectStreams: false }) }
  } catch {
    return unsupported
  }
}
