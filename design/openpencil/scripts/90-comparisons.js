// 90 · Comparisons — 现状 / 候选 / Approved 对比槽位
// 运行: op design @design/openpencil/scripts/90-comparisons.js
// 说明: 现状基线通过 op import:html 或浏览器截图导入后放在这里，
//       脚本只搭建三栏结构与评审记录区，避免把基线数据写成第二份真源。

const s = (c) => [{ type: 'solid', color: c }];
const C = {
  canvas: '$color.bg.canvas', surface: '$color.bg.surface', subtle: '$color.bg.subtle',
  navy: '$color.brand.navy800', border: '$color.border.default',
  text: '$color.text.primary', text2: '$color.text.secondary',
  success: '$color.status.success', warning: '$color.brand.gold700',
};

const board = (name, subtitle) => {
  const b = I(null, {
    type: 'frame', name, width: 1440, layout: 'vertical', padding: [32, 32], gap: 24, fill: s(C.canvas),
  });
  const h = I(b, { type: 'frame', name: 'header', width: 'fill_container', layout: 'vertical', gap: 6 });
  I(h, { type: 'text', content: name, fontSize: 28, fontWeight: 700, fill: s(C.navy), textGrowth: 'fixed-width' });
  I(h, { type: 'text', content: subtitle, fontSize: 13, fill: s(C.text2), textGrowth: 'fixed-width' });
  return b;
};

const column = (parent, title, note, accent) => {
  const col = I(parent, {
    type: 'frame', name: 'column / ' + title, width: 'fill_container', layout: 'vertical', gap: 12,
    padding: [16, 16], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) },
  });
  const ch = I(col, { type: 'frame', name: 'col header', width: 'fill_container', layout: 'vertical', gap: 3 });
  I(ch, { type: 'text', content: title, fontSize: 14, fontWeight: 700, fill: s(accent), textGrowth: 'fixed-width' });
  I(ch, { type: 'text', content: note, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  const slot = I(col, {
    type: 'frame', name: 'slot / ' + title, width: 'fill_container', height: 844, layout: 'horizontal',
    justifyContent: 'center', alignItems: 'center', cornerRadius: 8,
    fill: s(C.subtle), stroke: { thickness: 2, fill: s(C.border), dashPattern: [6, 4] },
  });
  if (title !== 'Candidate') {
    I(slot, { type: 'text', content: '导入基线或接入导帧', fontSize: 11, fill: s(C.text2) });
  }
  return col;
};

const b = board('90 · Comparisons · screen.mobile.dashboard', '每个母版留三栏：现状 / 候选 / Approved；Approved 后把对应导帧复制到 exports/approved。');
const cols = I(b, { type: 'frame', name: 'columns', width: 'fill_container', layout: 'horizontal', gap: 16, alignItems: 'start' });
column(cols, 'Current', '线上现状（截图 / import:html 基线）', C.text2);
column(cols, 'Candidate', '可重建样例：candidate.mobile.dashboard · 390×844', C.warning);
column(cols, 'Approved', '已确认，作为实现基线', C.success);

const checklist = I(b, {
  type: 'frame', name: 'review checklist', width: 'fill_container', layout: 'vertical', gap: 10,
  padding: [20, 20], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) },
});
I(checklist, { type: 'text', content: 'Approved 前必须逐项确认', fontSize: 14, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
for (const item of [
  '信息层级：首屏可见的关键指标与主 CTA 是否正确',
  '字段完整性：金额、日期、状态、来源徽章一个不少',
  '危险操作：删除 / 停用 / 覆盖均有二次确认',
  '状态覆盖：loading / empty / error / 长中文 / 金额溢出',
  '触控与安全区：移动端 ≥44pt，底部导航避让 Home Indicator',
  '弹层层级：Dialog / ActionSheet 走 Portal，不被手机壳裁切',
  '业务语义：账单状态、还款口径、汇率缺失提示与原实现一致',
]) {
  const r = I(checklist, { type: 'frame', name: 'item', width: 'fill_container', layout: 'horizontal', gap: 8, alignItems: 'start' });
  I(r, { type: 'icon_font', iconFontName: 'square', width: 15, height: 15, fill: s(C.border) });
  I(r, { type: 'text', content: item, fontSize: 12, fill: s(C.text), textGrowth: 'fixed-width' });
}
console.log('comparisons built');
