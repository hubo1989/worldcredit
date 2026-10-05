// 00 · Foundations — 从 vars/foundations.json 重建 token 可视化
// 运行: op design @design/openpencil/scripts/01-foundations.js

const T = {
  canvas: '$color.bg.canvas',
  surface: '$color.bg.surface',
  border: '$color.border.default',
  textPrimary: '$color.text.primary',
  textSecondary: '$color.text.secondary',
};

const s = (c) => [{ type: 'solid', color: c }];
const V = (v) => '$' + v;

const page = I(null, {
  type: 'frame',
  name: '00 · Foundations',
  width: 1200,
  layout: 'vertical',
  padding: [40, 40],
  gap: 40,
  fill: s(T.canvas),
});

// ---------- 标题 ----------
const header = I(page, {
  type: 'frame', name: 'Header', width: 'fill_container',
  layout: 'vertical', gap: 6,
});
I(header, { type: 'text', content: 'WorldCredit · Foundations v1', fontSize: 30, fontWeight: 700, fill: s('$color.brand.navy800'), textGrowth: 'fixed-width' });
I(header, { type: 'text', content: 'token 真源: design/openpencil/vars/foundations.json — 与 lib/theme.ts 命名对齐', fontSize: 14, fill: s(T.textSecondary), textGrowth: 'fixed-width' });

// ---------- 通用 section ----------
const section = (name, subtitle) => {
  const box = I(page, {
    type: 'frame', name, width: 'fill_container',
    layout: 'vertical', gap: 16, padding: [24, 24],
    cornerRadius: 12, fill: s(T.surface),
    stroke: { thickness: 1, fill: s(T.border) },
  });
  I(box, { type: 'text', content: name, fontSize: 18, fontWeight: 600, fill: s('$color.brand.navy800'), textGrowth: 'fixed-width' });
  if (subtitle) I(box, { type: 'text', content: subtitle, fontSize: 12, fill: s(T.textSecondary), textGrowth: 'fixed-width' });
  return box;
};

// ---------- 颜色 ----------
const colorSection = section('Color', '品牌色 / 运行色 / 背景 / 文字 / 边框 / 语义色');
const swatch = (parent, name, token) => {
  const cell = I(parent, {
    type: 'frame', name, width: 'fill_container',
    layout: 'vertical', gap: 8,
  });
  I(cell, {
    type: 'rectangle', name: name + ' chip', width: 'fill_container', height: 56,
    cornerRadius: 8, fill: s(V(token)),
    stroke: { thickness: 1, fill: s(T.border) },
  });
  // 色块内不写字：浅色与深色 token 都无法保证统一前景对比度，
  // 名称与 token 一律放在白底卡片上（深色文字，稳定达标）。
  I(cell, { type: 'text', content: name, fontSize: 12, fontWeight: 600, fill: s(T.textPrimary), textGrowth: 'fixed-width' });
  I(cell, { type: 'text', content: '--' + token, fontSize: 10, fill: s(T.textSecondary), textGrowth: 'fixed-width' });
  return cell;
};
const colorGroup = (title, tokens) => {
  const g = I(colorSection, { type: 'frame', name: title, width: 'fill_container', layout: 'vertical', gap: 12 });
  I(g, { type: 'text', content: title, fontSize: 13, fontWeight: 600, fill: s(T.textPrimary), textGrowth: 'fixed-width' });
  const row = I(g, { type: 'frame', name: title + ' row', width: 'fill_container', layout: 'horizontal', gap: 12 });
  for (const t of tokens) swatch(row, t.split('.').slice(-1)[0], t);
  return g;
};
colorGroup('Brand', ['color.brand.navy800', 'color.brand.navy600', 'color.brand.blue400', 'color.brand.gold500', 'color.brand.gold700']);
colorGroup('Runtime', ['color.runtime.primary', 'color.runtime.primaryDark', 'color.runtime.secondary', 'color.runtime.adminPrimary', 'color.runtime.adminAccent']);
colorGroup('Background', ['color.bg.canvas', 'color.bg.surface', 'color.bg.subtle', 'color.bg.skeleton', 'color.bg.admin.canvas', 'color.bg.admin.surface', 'color.bg.admin.panel']);
colorGroup('Text', ['color.text.primary', 'color.text.secondary', 'color.text.disabled', 'color.text.adminMuted', 'color.text.adminFaint', 'color.text.link', 'color.text.onDark']);
colorGroup('Border', ['color.border.default', 'color.border.input', 'color.border.onDark']);
colorGroup('Status', ['color.status.success', 'color.status.warning', 'color.status.danger', 'color.status.info', 'color.status.successDark', 'color.status.dangerDark']);
colorGroup('Status Ink', ['color.status.successInk', 'color.status.warningInk', 'color.status.dangerInk', 'color.status.infoInk']);
colorGroup('Status Soft', ['color.status.successSoft', 'color.status.warningSoft', 'color.status.dangerSoft', 'color.status.infoSoft', 'color.brand.goldSoft', 'color.status.dangerOnDark']);

// ---------- 字体 ----------
const typeSection = section('Typography', '正文 Noto Sans SC 栈（--font-sans） · 金额 Inter Tight · 代码 JetBrains Mono；字重仅 400/600/700');
const ramp = [
  ['Display', 22, 700, 'Inter Tight'],
  ['Section', 19, 600, 'Inter Tight'],
  ['Card title', 15, 600, 'Inter Tight'],
  ['Body', 14.5, 400, undefined],
  ['Caption', 11, 400, undefined],
  ['Amount', 22, 700, 'Inter Tight'],
  ['Mono', 13, 400, 'Inter Tight'],
];
for (const [label, size, weight, family] of ramp) {
  const row = I(typeSection, { type: 'frame', name: 'Type / ' + label, width: 'fill_container', layout: 'horizontal', gap: 16, alignItems: 'center' });
  const meta = I(row, { type: 'frame', name: 'meta', width: 150, layout: 'vertical', gap: 2 });
  I(meta, { type: 'text', content: label, fontSize: 12, fontWeight: 600, fill: s(T.textPrimary), textGrowth: 'fixed-width' });
  I(meta, { type: 'text', content: size + 'px / ' + weight, fontSize: 10, fill: s(T.textSecondary), textGrowth: 'fixed-width' });
  const sample = { type: 'text', content: '¥12,480.50 信用卡账单', fontSize: size, fontWeight: weight, fill: s(T.textPrimary), textGrowth: 'fixed-width' };
  if (family) sample.fontFamily = family;
  I(row, sample);
}

// ---------- 间距 / 圆角 ----------
const spaceSection = section('Spacing & Radius', '间距 4px 基准：4/8/12/16/20/32（space.5 与 app --sp-5 对齐为 20） · 卡片 12px · 输入 8px · 胶囊 999px · 底部弹层 16px');
const spaceRow = I(spaceSection, { type: 'frame', name: 'space scale', width: 'fill_container', layout: 'horizontal', gap: 16, alignItems: 'end' });
for (const [t, px] of [['space.1', 4], ['space.2', 8], ['space.3', 12], ['space.4', 16], ['space.5', 20], ['space.6', 32]]) {
  const cell = I(spaceRow, { type: 'frame', name: 'space / ' + t, layout: 'vertical', gap: 8, alignItems: 'center' });
  I(cell, { type: 'rectangle', width: px + 16, height: px + 16, fill: s('$color.brand.navy600'), cornerRadius: 2 });
  I(cell, { type: 'text', content: t + ' = ' + px, fontSize: 10, fill: s(T.textSecondary) });
}
const radiusRow = I(spaceSection, { type: 'frame', name: 'radius scale', width: 'fill_container', layout: 'horizontal', gap: 16 });
for (const t of ['radius.input', 'radius.card', 'radius.sheet', 'radius.pill']) {
  const cell = I(radiusRow, { type: 'frame', name: 'radius / ' + t, layout: 'vertical', gap: 8, alignItems: 'center' });
  I(cell, {
    type: 'rectangle', width: 72, height: 48, cornerRadius: 12,
    fill: s('$color.bg.subtle'), stroke: { thickness: 1, fill: s('$color.brand.navy600') },
  });
  I(cell, { type: 'text', content: t, fontSize: 10, fill: s(T.textSecondary) });
}

// ---------- 阴影 ----------
const elevSection = section('Elevation', 'shadow.card 常规卡片 · shadow.raised 弹层与浮起态');
const elevRow = I(elevSection, { type: 'frame', name: 'elevation row', width: 'fill_container', layout: 'horizontal', gap: 24 });
for (const [label, token] of [['Card', 'shadow.card'], ['Raised', 'shadow.raised']]) {
  const cell = I(elevRow, { type: 'frame', name: 'elevation / ' + label, width: 'fill_container', layout: 'vertical', gap: 8, alignItems: 'center' });
  I(cell, {
    type: 'rectangle', width: 'fill_container', height: 72, cornerRadius: 12,
    fill: s(T.surface), stroke: { thickness: 1, fill: s(T.border) },
    effects: [{ type: 'shadow', offsetX: 0, offsetY: 4, blur: 12, spread: 0, color: 'rgba(10,31,68,0.10)' }],
  });
  I(cell, { type: 'text', content: label + ' · ' + token, fontSize: 11, fill: s(T.textSecondary) });
}

// ---------- 布局 ----------
const layoutSection = section('Layout', '移动 390×844 / 430×932 · 后台 1440×900 · 触控 ≥44 · 状态栏 48 · 页面头 64 · 底部导航 56 + 安全区 34');
const layoutRow = I(layoutSection, { type: 'frame', name: 'layout specs', width: 'fill_container', layout: 'horizontal', gap: 24 });
for (const [label, w, h] of [['Mobile', 390, 844], ['Mobile LG', 430, 932], ['Admin', 1440, 900]]) {
  const scale = label === 'Admin' ? 0.18 : 0.16;
  const cell = I(layoutRow, { type: 'frame', name: 'layout / ' + label, layout: 'vertical', gap: 8, alignItems: 'center' });
  I(cell, {
    type: 'rectangle', width: Math.round(w * scale), height: Math.round(h * scale),
    cornerRadius: 6, fill: s('$color.bg.subtle'),
    stroke: { thickness: 1, fill: s('$color.brand.navy600') },
  });
  I(cell, { type: 'text', content: label + ' ' + w + '×' + h, fontSize: 10, fill: s(T.textSecondary) });
}

console.log('foundations built');
