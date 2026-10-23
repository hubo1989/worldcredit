import { afterAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import sharp from 'sharp'

const root = fileURLToPath(new URL('../../', import.meta.url))
const source = path.join(root, 'design/app-icon')
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-icons-'))
afterAll(() => fs.rmSync(temporary, { recursive: true, force: true }))

it('generates from an unrelated cwd and copies the master byte for byte', async () => {
  const icons = path.join(temporary, 'design/app-icon')
  fs.mkdirSync(icons, { recursive: true })
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(temporary, 'node_modules'), 'dir')
  for (const name of ['generate-icons.mjs', 'worldcredit-app-icon.svg']) {
    fs.copyFileSync(path.join(source, name), path.join(icons, name))
  }
  execFileSync(process.execPath, [path.join(icons, 'generate-icons.mjs')], { cwd: os.tmpdir() })
  const master = fs.readFileSync(path.join(icons, 'AppIcon-1024.png'))
  expect(fs.readFileSync(path.join(temporary, 'ios/WorldCredit/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png'))).toEqual(master)
  for (const size of [1024, 180, 120, 167, 152]) {
    expect(await sharp(path.join(icons, `AppIcon-${size}.png`)).metadata()).toMatchObject({ width: size, height: size })
  }
  const shadow = await sharp(path.join(icons, 'AppIcon-mockup.png')).raw().toBuffer()
  const scriptPath = path.join(icons, 'generate-icons.mjs')
  fs.writeFileSync(scriptPath, fs.readFileSync(scriptPath, 'utf8').replace('rx="114" fill="#000"', 'rx="114" fill="none"'))
  execFileSync(process.execPath, [scriptPath], { cwd: icons })
  const noShadow = await sharp(path.join(icons, 'AppIcon-mockup.png')).raw().toBuffer()
  // Below the icon (ends at y=656), the drop shadow must darken the wallpaper.
  const pixel = (680 * 800 + 400) * 4
  expect(shadow[pixel] + shadow[pixel + 1] + shadow[pixel + 2])
    .toBeLessThan(noShadow[pixel] + noShadow[pixel + 1] + noShadow[pixel + 2])
})

describe('preview export feedback', () => {
  function preview(protocol = 'https:', failure?: Error) {
    const html = fs.readFileSync(path.join(source, 'preview.html'), 'utf8')
    const script = html.match(/<script>([\s\S]*?)<\/script>/)![1]
    const images: Array<{ onload?: () => void; onerror?: () => void }> = []
    const click = vi.fn()
    const canvas = {
      getContext: () => ({ clearRect: vi.fn(), drawImage: vi.fn() }),
      toDataURL: () => { if (failure) throw failure; return 'data:image/png;base64,test' },
    }
    const alert = vi.fn()
    const context = vm.createContext({
      location: { protocol }, alert,
      Image: class { constructor() { images.push(this) } },
      document: { getElementById: () => canvas, createElement: () => ({ click }) },
    })
    vm.runInContext(script, context)
    vm.runInContext("downloadCanvas(180, 'AppIcon-180.png')", context)
    return { image: images[0] ?? {}, click, alert }
  }

  it('explains file protocol restrictions without a silent failed export', () => {
    const { image, alert, click } = preview('file:')
    image.onload?.()
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('HTTP'))
    expect(click).not.toHaveBeenCalled()
  })
  it('reports image loading failure', () => {
    const { image, alert } = preview()
    image.onerror?.()
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('加载失败'))
  })
  it('reports canvas export failure', () => {
    const { image, alert } = preview('https:', new Error('SecurityError'))
    image.onload?.()
    expect(alert).toHaveBeenCalledWith(expect.stringContaining('导出失败'))
  })
  it('downloads a PNG after a successful render', () => {
    const { image, click, alert } = preview()
    image.onload?.()
    expect(click).toHaveBeenCalledOnce()
    expect(alert).not.toHaveBeenCalled()
  })
})
