// 01 · Components 追加：Review Board（长文案 / 金额对齐 / 可访问性检查项）
// 运行: op design @design/openpencil/scripts/03-review-board.js

const s = (c) => [{ type: 'solid', color: c }];
const C = {
  canvas: '$color.bg.canvas', surface: '$color.bg.surface', subtle: '$color.bg.subtle',
  navy: '$color.brand.navy800', navy600: '$color.brand.navy600', gold: '$color.brand.gold500',
  primary: '$color.runtime.primary', border: '$color.border.default',
  text: '$color.text.primary', text2: '$color.text.secondary', onDark: '$color.text.onDark',
  success: '$color.status.success', warning: '$color.status.warning', danger: '$color.status.danger',
};

const b = I(null, {
  type: 'frame', name: 'WorldCredit · Review Board', width: 1180, layout: 'vertical',
  padding: [32, 32], gap: 24, fill: s(C.canvas),
});
const h = I(b, { type: 'frame', name: 'header', width: 'fill_container', layout: 'vertical', gap: 4 });
I(h, { type: 'text', content: 'Review Board', fontSize: 26, fontWeight: 700, fill: s(C.navy), textGrowth: 'fixed-width' });
I(h, { type: 'text', content: '每个母版评审时逐项过：信息层级 / 字段完整性 / CTA / 危险操作 / 状态覆盖 / 长中文 / 金额对齐 / 安全区 / 弹层层级', fontSize: 13, fill: s(C.text2), textGrowth: 'fixed-width' });

const card = (title, note) => {
  const g = I(b, {
    type: 'frame', name: 'Review / ' + title, width: 'fill_container', layout: 'vertical', gap: 14,
    padding: [20, 20], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) },
  });
  const gh = I(g, { type: 'frame', name: 'gh', width: 'fill_container', layout: 'vertical', gap: 2 });
  I(gh, { type: 'text', content: title, fontSize: 14, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
  I(gh, { type: 'text', content: note, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  return g;
};

// 长中文
const longG = card('长中文与截断', '标题单行省略，副标题两行截断；禁止用固定高度裁掉金额或状态徽章');
const longRow = I(longG, { type: 'frame', name: 'long row', width: 'fill_container', layout: 'horizontal', gap: 12, alignItems: 'center' });
const longCard = I(longRow, {
  type: 'frame', name: 'long bill card', width: 'fill_container', layout: 'vertical', gap: 6,
  padding: [16, 16], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) },
});
I(longCard, { type: 'text', content: '中国工商银行·宇宙星座信用卡（白金卡等级）', fontSize: 15, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
I(longCard, { type: 'text', content: '尾号 8842 · 持卡人 胡波 · 本期含境外消费与分期本金', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
const longAmt = I(longRow, { type: 'frame', name: 'amount', layout: 'vertical', gap: 4, alignItems: 'end' });
I(longAmt, { type: 'text', content: '¥128,400.00', fontSize: 18, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(C.text), textGrowth: 'fixed-width' });
const longBadge = I(longAmt, { type: 'frame', name: 'badge', layout: 'horizontal', padding: [2, 10], cornerRadius: 999, fill: s(C.warning) });
I(longBadge, { type: 'text', content: '部分还款', fontSize: 11, fontWeight: 700, fill: s(C.navy) });

// 金额对齐
const amtG = card('金额 tabular 对齐', '金额必须右对齐 + font-variant-numeric: tabular-nums，位数不同也要逐位对齐');
const amtCol = I(amtG, { type: 'frame', name: 'amount list', width: 'fill_container', layout: 'vertical', gap: 8 });
for (const [label, value] of [['本期应还', '¥8,640.50'], ['最低还款', '¥864.05'], ['已还金额', '¥0.00'], ['总欠款（含分期）', '¥128,400.00']]) {
  const r = I(amtCol, { type: 'frame', name: 'amt / ' + label, width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between' });
  I(r, { type: 'text', content: label, fontSize: 13, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(r, { type: 'text', content: value, fontSize: 15, fontWeight: 600, fontFamily: '$font.family.amount', fill: s(C.text), textGrowth: 'fixed-width' });
}

// 状态覆盖清单
const stateG = card('State Coverage Checklist', '列表 / 详情 / 表单三类页面各自的必查状态');
const cols = I(stateG, { type: 'frame', name: 'cols', width: 'fill_container', layout: 'horizontal', gap: 16, alignItems: 'start' });
const checklist = (title, items) => {
  const c = I(cols, { type: 'frame', name: 'check / ' + title, width: 'fill_container', layout: 'vertical', gap: 8 });
  I(c, { type: 'text', content: title, fontSize: 13, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
  for (const it of items) {
    const r = I(c, { type: 'frame', name: 'item', width: 'fill_container', layout: 'horizontal', gap: 8, alignItems: 'start' });
    I(r, { type: 'icon_font', iconFontName: 'check', width: 14, height: 14, fill: s(C.success) });
    I(r, { type: 'text', content: it, fontSize: 12, fill: s(C.text), textGrowth: 'fixed-width' });
  }
};
checklist('列表', ['loading 骨架（350ms 起）', 'empty 插画 + CTA', 'error 原因 + 重试', 'overdue / partial / paid', '长银行名与多持卡人']);
checklist('详情', ['loading / error', '金额四格网格', '来源徽章（邮件 / 手动 / AI）', '附件与空附件', '危险操作二次确认']);
checklist('表单', ['金额空 → 保存禁用', 'on blur 校验', '服务端错误保留输入', '提交中防重复', '键盘弹起不遮挡']);

// 安全区
const safeG = card('安全区与触控', '底部导航避开 Home Indicator；所有可点区域 ≥44pt；Dialog 走 Portal 不受手机壳裁切');
const safeRow = I(safeG, { type: 'frame', name: 'safe row', width: 'fill_container', layout: 'horizontal', gap: 24, alignItems: 'center' });
const phone = I(safeRow, {
  type: 'frame', name: 'phone frame', width: 240, height: 420, layout: 'vertical', gap: 0,
  cornerRadius: 24, fill: s(C.subtle), stroke: { thickness: 2, fill: s(C.navy600) },
});
const status = I(phone, { type: 'frame', name: 'status bar', width: 'fill_container', height: 32, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, 16] });
I(status, { type: 'text', content: '9:41', fontSize: 11, fontWeight: 600, fill: s(C.text) });
I(status, { type: 'icon_font', iconFontName: 'battery-full', width: 14, height: 14, fill: s(C.text) });
const body = I(phone, { type: 'frame', name: 'content', width: 'fill_container', height: 'fill_container', layout: 'vertical', gap: 12, padding: [12, 16] });
for (const w of [120, 180, 90]) I(body, { type: 'rectangle', width: w, height: 12, cornerRadius: 999, fill: s('#E8EDF5') });
const nav = I(phone, { type: 'frame', name: 'bottom nav', width: 'fill_container', height: 56, layout: 'horizontal', justifyContent: 'space_around', alignItems: 'center', fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
for (const [icon, label, active] of [['home', '首页', true], ['receipt', '账单', false], ['user', '我的', false]]) {
  const t = I(nav, { type: 'frame', name: 'tab / ' + label, layout: 'vertical', gap: 4, alignItems: 'center' });
  I(t, { type: 'icon_font', iconFontName: icon, width: 20, height: 20, fill: s(active ? C.navy : C.text2) });
  I(t, { type: 'text', content: label, fontSize: 10, fontWeight: active ? 700 : 400, fill: s(active ? C.navy : C.text2) });
}
const safeNote = I(safeRow, { type: 'frame', name: 'notes', width: 'fill_container', layout: 'vertical', gap: 10 });
for (const t of ['底部导航高度 56，额外预留 safe-area-inset-bottom', '导航选中态：深蓝图标与文字 + 顶部金色短线', 'Dialog / ActionSheet 走 Portal，不嵌在手机壳内', '所有触控目标最小 44×44']) {
  const r = I(safeNote, { type: 'frame', name: 'note', width: 'fill_container', layout: 'horizontal', gap: 8, alignItems: 'start' });
  I(r, { type: 'icon_font', iconFontName: 'dot', width: 14, height: 14, fill: s(C.gold) });
  I(r, { type: 'text', content: t, fontSize: 12, fill: s(C.text), textGrowth: 'fixed-width' });
}

console.log('review board built');
