import { describe, it, expect } from 'vitest'
import {
  extractNameFromBody,
  isEmlAttachment,
  normalizeName,
  resolveHolder,
  stripHonorificSuffix,
  type HolderRecord,
} from '../src/holders'
import type { RawAttachment } from '../src/types'

const enc = (s: string) => new TextEncoder().encode(s)

const holder = (id: string, name: string, aliases: string[] = []): HolderRecord => ({ id, name, aliases })

describe('normalizeName / stripHonorificSuffix', () => {
  it('归一化去空白并小写，但不剥称谓', () => {
    expect(normalizeName(' 张 改 菊 ')).toBe('张改菊')
    expect(normalizeName('Zhang GAI Ju')).toBe('zhanggaiju')
    // 库里存的可能带称谓，归一化刻意保留它
    expect(normalizeName('张改菊女士')).toBe('张改菊女士')
  })

  it('剥称谓只在调用方显式需要时发生', () => {
    expect(stripHonorificSuffix('张改菊女士')).toBe('张改菊')
    expect(stripHonorificSuffix('呼博先生')).toBe('呼博')
    expect(stripHonorificSuffix('张改菊')).toBeNull()
  })
})

describe('extractNameFromBody', () => {
  it('识别「尊敬的X先生/女士」与「亲爱的X，」', () => {
    expect(extractNameFromBody('尊敬的高敏女士，您好')).toBe('高敏')
    expect(extractNameFromBody('亲爱的呼博，您本期账单如下')).toBe('呼博')
  })

  it('不把占位称呼当名字', () => {
    expect(extractNameFromBody('尊敬的用户，您好')).toBeNull()
    expect(extractNameFromBody('尊敬的客户：')).toBeNull()
  })

  it('不把正文里的普通词当名字', () => {
    expect(extractNameFromBody('【精致生活，便捷还款】优惠活动')).toBeNull()
  })
})

describe('resolveHolder', () => {
  const holders = [holder('h1', '张改菊', ['张改菊女士']), holder('h2', '高敏'), holder('h3', '呼博')]
  const base = { holders, defaultHolderId: 'h1' }

  it('To 头显示名优先', () => {
    const r = resolveHolder({ ...base, headerName: '高敏', bodyName: '呼博' })
    expect(r).toEqual({ holderId: 'h2', source: 'header_name' })
  })

  it('To 头取不到时用正文称呼', () => {
    // bodyName 的契约是 extractNameFromBody 的返回值（已剥掉称谓的姓名）
    const bodyName = extractNameFromBody('尊敬的呼博先生，您好')
    const r = resolveHolder({ ...base, headerName: null, bodyName })
    expect(r).toEqual({ holderId: 'h3', source: 'body_honorific' })
  })

  it('都匹配不上时回落默认持卡人，并如实标注来源', () => {
    const r = resolveHolder({ ...base, headerName: '王小明', bodyName: null })
    expect(r).toEqual({ holderId: 'h1', source: 'default_holder' })
  })

  it('没有默认持卡人时返回 unknown', () => {
    const r = resolveHolder({ holders, defaultHolderId: null, headerName: null, bodyName: null })
    expect(r).toEqual({ holderId: null, source: 'unknown' })
  })

  it('同姓陷阱：前缀能对上多个人时回落默认，不猜', () => {
    // 「呼博」与「呼金堂」共享姓氏前缀，来件只写「呼」，不能任选一个
    const ambiguous = [holder('h1', '呼博'), holder('h2', '呼金堂')]
    const r = resolveHolder({ holders: ambiguous, defaultHolderId: 'h1', headerName: '呼', bodyName: null })
    expect(r.source).toBe('default_holder')
    expect(r.holderId).toBe('h1')
  })

  it('前缀唯一命中时才采纳', () => {
    const r = resolveHolder({ ...base, headerName: '张改菊', bodyName: null })
    expect(r).toEqual({ holderId: 'h1', source: 'header_name' })
  })
})

describe('isEmlAttachment', () => {
  const attachment = (filename: string, contentType: string, bytes: Uint8Array): RawAttachment => ({
    filename,
    contentType,
    bytes,
    contentId: null,
  })

  const emlBytes = enc('From: bill@bank.com\r\nTo: me@x.com\r\nSubject: bill\r\n\r\nbody')
  const pdfBytes = enc('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')
  const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const plainBytes = enc('just some text without headers')

  it('Content-Type 明确是邮件时采纳', () => {
    expect(isEmlAttachment(attachment('x', 'message/rfc822', plainBytes))).toBe(true)
    expect(isEmlAttachment(attachment('x', 'application/eml', plainBytes))).toBe(true)
  })

  it('.eml 后缀且内容像邮件时采纳', () => {
    expect(isEmlAttachment(attachment('bill.eml', 'application/octet-stream', emlBytes))).toBe(true)
  })

  it('.eml 后缀但内容是 PDF 时否掉（防误标）', () => {
    expect(isEmlAttachment(attachment('bill.eml', 'application/octet-stream', pdfBytes))).toBe(false)
  })

  it('.eml 后缀但内容既非二进制也非邮件时否掉', () => {
    // 只有后缀不足以判定：内容里没有任何邮件头就不是嵌套账单
    expect(isEmlAttachment(attachment('not-really.eml', 'application/octet-stream', plainBytes))).toBe(false)
  })

  it('裸名「attachment」+ 内容像邮件时采纳（Gmail 转发常见）', () => {
    expect(isEmlAttachment(attachment('attachment', 'application/octet-stream', emlBytes))).toBe(true)
  })

  it('空文件名 + 内容像邮件时采纳', () => {
    expect(isEmlAttachment(attachment('', '', emlBytes))).toBe(true)
  })

  it('已知非邮件后缀直接排除，不做内容嗅探', () => {
    expect(isEmlAttachment(attachment('bill.pdf', 'application/pdf', pdfBytes))).toBe(false)
    expect(isEmlAttachment(attachment('shot.png', 'image/png', pngBytes))).toBe(false)
    expect(isEmlAttachment(attachment('notes.txt', 'text/plain', emlBytes))).toBe(false)
  })

  it('裸名 + 内容不像邮件时否掉', () => {
    expect(isEmlAttachment(attachment('attachment', 'application/octet-stream', plainBytes))).toBe(false)
  })
})
