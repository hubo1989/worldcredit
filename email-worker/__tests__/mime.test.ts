import { describe, it, expect } from 'vitest'
import { decodeMimeHeaderValue, extractAttachments, extractHeaderDisplayName, parseRawMessage } from '../../lib/email-core/mime'

const enc = (s: string) => new TextEncoder().encode(s)

/** 真实邮件是 CRLF 分隔；用数组拼装便于看清部件的行结构。 */
const raw = (lines: string[]) => enc(lines.join('\r\n'))

// 预计算的编码向量（GBK 字节无法在 Node 里用 Buffer 编码，故硬编码）：
//   张改菊        -> gbk b64 1cW4xL7V           / gbk q =D5=C5=B8=C4=BE=D5
//   女士          -> gbk b64 xa7Kvw==
//   张改菊女士    -> gbk b64 1cW4xL7Vxa7Kvw==
//   本期应还金额合计 6000 元 -> gbk b64 sb7G2tOmu7m98Lbuus+8xiA2MDAwINSq
//   raw bytes [0,1,2,255,254,10,13,65,0,80,68,70,137,80,78,71] -> b64 AAEC//4KDUEAUERGiVBORw==
const GBK_ZHANG = '1cW4xL7V'
const GBK_NVSHI = 'xa7Kvw=='
const GBK_ZHANG_NVSHI = '1cW4xL7Vxa7Kvw=='
const GBK_BODY = 'sb7G2tOmu7m98Lbuus+8xiA2MDAwINSq'
const BINARY_B64 = 'AAEC//4KDUEAUERGiVBORw=='
const BINARY_BYTES = [0, 1, 2, 255, 254, 10, 13, 65, 0, 80, 68, 70, 137, 80, 78, 71]

describe('decodeMimeHeaderValue: RFC 2047 编码词', () => {
  it('解码 GBK 的 B 编码词', () => {
    expect(decodeMimeHeaderValue('=?gbk?B?' + GBK_ZHANG + '?=')).toBe('张改菊')
  })

  it('解码 Q 编码词，_ 代表空格', () => {
    expect(decodeMimeHeaderValue('=?gbk?Q?=D5=C5=B8=C4=BE=D5?=')).toBe('张改菊')
    expect(decodeMimeHeaderValue('=?utf-8?Q?hello_world?=')).toBe('hello world')
  })

  it('相邻编码词拼接时丢掉中间空白', () => {
    expect(
      decodeMimeHeaderValue('=?gbk?B?' + GBK_ZHANG + '?= =?gbk?B?' + GBK_NVSHI + '?=')
    ).toBe('张改菊女士')
  })

  it('单个编码词一次解出完整姓名', () => {
    expect(decodeMimeHeaderValue('=?gbk?B?' + GBK_ZHANG_NVSHI + '?=')).toBe('张改菊女士')
  })

  it('坏编码词原样保留，不静默变成空串', () => {
    // atob 拒绝的 payload：过去会被 catch 吞成空串，整个显示名随之消失
    expect(decodeMimeHeaderValue('=?gbk?B?A?=')).toBe('=?gbk?B?A?=')
    // 全是非法字符的 payload（清理后为空）
    expect(decodeMimeHeaderValue('=?gbk?B?@@@@?=')).toBe('=?gbk?B?@@@@?=')
  })

  it('坏编码词不影响同头里的正常编码词', () => {
    const decoded = decodeMimeHeaderValue('=?gbk?B?' + GBK_ZHANG + '?= =?gbk?B?A?=')
    expect(decoded).toContain('张改菊')
    expect(decoded).toContain('=?gbk?B?A?=')
  })

  it('未编码的 8bit GBK 头按字节还原', () => {
    const raw8 = String.fromCharCode(0xd5, 0xc5, 0xb8, 0xc4, 0xbe, 0xd5)
    expect(decodeMimeHeaderValue(raw8)).toBe('张改菊')
  })

  it('普通 ASCII 与空值', () => {
    expect(decodeMimeHeaderValue('Billing Statement')).toBe('Billing Statement')
    expect(decodeMimeHeaderValue(null)).toBe('')
    expect(decodeMimeHeaderValue(undefined)).toBe('')
  })
})

describe('extractHeaderDisplayName', () => {
  it('从 To 头取显示名并去掉地址部分', () => {
    expect(extractHeaderDisplayName('=?gbk?B?' + GBK_ZHANG_NVSHI + '?= <bill@bank.com>')).toBe('张改菊女士')
  })

  it('只有裸地址时不算显示名', () => {
    expect(extractHeaderDisplayName('someone@example.com')).toBeNull()
  })
})

describe('parseRawMessage: multipart 切分', () => {
  it('multipart/alternative 优先取 text/plain', () => {
    const parsed = parseRawMessage(
      raw([
        'From: a@b.com',
        'To: c@d.com',
        'Content-Type: multipart/alternative; boundary="BND"',
        '',
        '--BND',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'plain body',
        '--BND',
        'Content-Type: text/html; charset="utf-8"',
        '',
        '<p>html body</p>',
        '--BND--',
        '',
      ])
    )
    expect(parsed.text.trim()).toBe('plain body')
    expect(parsed.attachments).toHaveLength(0)
  })

  it('解析嵌套 multipart 并按声明的 GBK 字符集解码正文', () => {
    const parsed = parseRawMessage(
      raw([
        'Content-Type: multipart/mixed; boundary="OUT"',
        '',
        '--OUT',
        'Content-Type: multipart/alternative; boundary="IN"',
        '',
        '--IN',
        'Content-Type: text/plain; charset="gbk"',
        'Content-Transfer-Encoding: base64',
        '',
        GBK_BODY,
        '--IN--',
        '--OUT--',
        '',
      ])
    )
    expect(parsed.text).toContain('本期应还金额合计 6000 元')
  })

  it('base64 附件按字节还原，不被 utf-8 破坏', () => {
    const parsed = parseRawMessage(
      raw([
        'Content-Type: multipart/mixed; boundary="B"',
        '',
        '--B',
        'Content-Type: text/plain',
        '',
        'see attachment',
        '--B',
        'Content-Type: application/pdf; name="report.pdf"',
        'Content-Disposition: attachment; filename="report.pdf"',
        'Content-Transfer-Encoding: base64',
        '',
        BINARY_B64,
        '--B--',
        '',
      ])
    )
    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0].filename).toBe('report.pdf')
    expect(Array.from(parsed.attachments[0].bytes)).toEqual(BINARY_BYTES)
  })

  it('缺少收尾分隔符时仍收下最后一个部件', () => {
    // 没有 --B--：最后一个 text/plain 部件过去会被整段丢掉
    const parsed = parseRawMessage(
      raw([
        'Content-Type: multipart/mixed; boundary="B"',
        '',
        '--B',
        'Content-Type: application/pdf; name="a.pdf"',
        'Content-Disposition: attachment; filename="a.pdf"',
        'Content-Transfer-Encoding: base64',
        '',
        'AAEC',
        '--B',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'body survives truncation',
      ])
    )
    expect(parsed.text.trim()).toBe('body survives truncation')
    expect(parsed.attachments).toHaveLength(1)
  })

  it('正文部件带 name= 时不算附件', () => {
    const parsed = parseRawMessage(
      raw([
        'Content-Type: multipart/mixed; boundary="B"',
        '',
        '--B',
        'Content-Type: text/plain; charset="utf-8"; name="body.txt"',
        '',
        'the real body',
        '--B--',
        '',
      ])
    )
    expect(parsed.text.trim()).toBe('the real body')
    expect(parsed.attachments).toHaveLength(0)
  })

  it('非文本类型带文件名时仍是附件', () => {
    const parsed = parseRawMessage(
      raw([
        'Content-Type: multipart/mixed; boundary="B"',
        '',
        '--B',
        'Content-Type: text/plain; charset="utf-8"',
        '',
        'body',
        '--B',
        'Content-Type: image/png; name="shot.png"',
        'Content-Transfer-Encoding: base64',
        '',
        'AAEC',
        '--B--',
        '',
      ])
    )
    expect(parsed.text.trim()).toBe('body')
    expect(parsed.attachments.map(a => a.filename)).toEqual(['shot.png'])
  })

  it('extractAttachments 只返回附件', () => {
    const atts = extractAttachments(
      raw([
        'Content-Type: multipart/mixed; boundary="B"',
        '',
        '--B',
        'Content-Type: text/plain',
        '',
        'body',
        '--B',
        'Content-Type: application/octet-stream; name="x.bin"',
        'Content-Transfer-Encoding: base64',
        '',
        'AAEC',
        '--B--',
        '',
      ])
    )
    expect(atts).toHaveLength(1)
    expect(atts[0].contentType).toBe('application/octet-stream')
  })
})

describe('parseRawMessage: HTML 不可见内容剔除（邮储 0726 回归）', () => {
  // 只有 text/html 部件时正文才走 stripHtml
  const htmlMail = (html: string) =>
    parseRawMessage(
      raw([
        'From: a@b.com',
        'To: c@d.com',
        'Content-Type: multipart/alternative; boundary="BND"',
        '',
        '--BND',
        'Content-Type: text/html; charset="utf-8"',
        '',
        html,
        '--BND--',
        '',
      ])
    )

  it('<!-- --> 注释里的旧模板不混进正文（2025-04 旧金额/旧日期必须消失）', () => {
    const parsed = htmlMail(
      '<!-- 旧模板：尊敬的客户，您的账单已出，应还金额 ¥106.25，到期还款日 2025年04月27日 -->' +
      '<p>尊敬的客户，您的账单日 09，本期应还金额 ¥85.40，到期还款日 2026-09-29</p>'
    )
    expect(parsed.text).toContain('账单日 09')
    expect(parsed.text).toContain('2026-09-29')
    // 注释内容在浏览器不可见，正文必须与用户看到的一致
    expect(parsed.text).not.toContain('106.25')
    expect(parsed.text).not.toContain('2025')
  })

  it('display:none / visibility:hidden 的元素同样被剔除', () => {
    const parsed = htmlMail(
      '<div style="display:none">隐藏的旧账期 2025-04-27</div>' +
      '<div><span style="visibility: hidden">invisible 99.99</span>本期应还 ¥12.34</div>'
    )
    expect(parsed.text).toContain('本期应还 ¥12.34')
    expect(parsed.text).not.toContain('2025-04-27')
    expect(parsed.text).not.toContain('99.99')
  })
})
