import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const DIR = path.resolve('design/app-icon');
// Xcode 资产目录：主图标直接落到 appiconset，避免与 design/ 下的副本漂移。
const APPICONSET = path.resolve('ios/WorldCredit/Assets.xcassets/AppIcon.appiconset');
const svgPath = path.join(DIR, 'worldcredit-app-icon.svg');
const svgBuffer = fs.readFileSync(svgPath);

const sizes = [
  { name: 'AppIcon-1024.png', size: 1024 },
  { name: 'AppIcon-180.png', size: 180 },
  { name: 'AppIcon-120.png', size: 120 },
  { name: 'AppIcon-167.png', size: 167 },
  { name: 'AppIcon-152.png', size: 152 },
];

async function generate() {
  console.log('Generating iOS app icons from SVG...');
  fs.mkdirSync(APPICONSET, { recursive: true });

  for (const { name, size } of sizes) {
    const outPath = path.join(DIR, name);
    await sharp(svgBuffer)
      .resize(size, size)
      .png({ quality: 100, compressionLevel: 9 })
      .toFile(outPath);
    console.log(`✓ Generated ${name} (${size}x${size})`);

    // 1024 主图标同时写入 Xcode 资产目录，保证两边永不漂移。
    if (size === 1024) {
      await sharp(svgBuffer)
        .resize(1024, 1024)
        .png({ quality: 100, compressionLevel: 9 })
        .toFile(path.join(APPICONSET, name));
      console.log(`✓ Synced ${name} -> ios/WorldCredit/Assets.xcassets/AppIcon.appiconset/`);
    }
  }

  // 生成一张带 iOS 连续平滑超椭圆圆角 (Squircle) 的预览图 (512x512)
  // iOS App Icon 圆角率大约为 22.37% (在 512 下对应约 rx=114)
  const squircleMaskSvg = Buffer.from(`
    <svg width="512" height="512" viewBox="0 0 512 512">
      <rect x="0" y="0" width="512" height="512" rx="114" fill="#fff"/>
    </svg>
  `);

  const previewBase = await sharp(svgBuffer)
    .resize(512, 512)
    .composite([{ input: squircleMaskSvg, blend: 'dest-in' }])
    .png()
    .toBuffer();

  // 放置在深色壁纸背景上，加一层柔和弥散阴影
  const wallpaperSvg = Buffer.from(`
    <svg width="800" height="800" viewBox="0 0 800 800" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="wall" cx="50%" cy="30%" r="80%">
          <stop offset="0%" stop-color="#1E293B"/>
          <stop offset="60%" stop-color="#0F172A"/>
          <stop offset="100%" stop-color="#020617"/>
        </radialGradient>
        <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%">
          <feDropShadow dx="0" dy="24" stdDeviation="30" flood-color="#000" flood-opacity="0.6"/>
        </filter>
      </defs>
      <rect width="800" height="800" fill="url(#wall)"/>
      <g filter="url(#shadow)">
        <rect x="144" y="144" width="512" height="512" rx="114" fill="none"/>
      </g>
    </svg>
  `);

  // 合成 iOS 桌面渲染图
  const previewPath = path.join(DIR, 'AppIcon-mockup.png');
  await sharp(wallpaperSvg)
    .composite([
      {
        input: previewBase,
        top: 144,
        left: 144,
      }
    ])
    .png()
    .toFile(previewPath);

  console.log(`✓ Generated AppIcon-mockup.png (800x800)`);
}

generate().catch(err => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
