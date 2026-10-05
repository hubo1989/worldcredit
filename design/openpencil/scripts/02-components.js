// 01 · Components — 组件母版清单
// 运行: op design @design/openpencil/scripts/02-components.js
// 约定: 颜色走 $token；数值布局属性用字面值（OpenPencil 不接受数字变量）。

const s = (c) => [{ type: 'solid', color: c }];
const C = {
  canvas: '$color.bg.canvas', surface: '$color.bg.surface', subtle: '$color.bg.subtle',
  navy: '$color.brand.navy800', navy600: '$color.brand.navy600', gold: '$color.brand.gold500', gold700: '$color.brand.gold700',
  primary: '$color.runtime.primary', primaryDark: '$color.runtime.primaryDark', secondary: '$color.runtime.secondary',
  border: '$color.border.default', borderInput: '$color.border.input',
  text: '$color.text.primary', text2: '$color.text.secondary', textDisabled: '$color.text.disabled', onDark: '$color.text.onDark',
  success: '$color.status.success', warning: '$color.status.warning', danger: '$color.status.danger', info: '$color.status.info',
};

const board = (title, subtitle, width) => {
  const b = I(null, {
    type: 'frame', name: title, width: width || 1180, layout: 'vertical',
    padding: [32, 32], gap: 24, fill: s(C.canvas),
  });
  const h = I(b, { type: 'frame', name: 'header', width: 'fill_container', layout: 'vertical', gap: 4 });
  I(h, { type: 'text', content: title, fontSize: 26, fontWeight: 700, fill: s(C.navy), textGrowth: 'fixed-width' });
  if (subtitle) I(h, { type: 'text', content: subtitle, fontSize: 13, fill: s(C.text2), textGrowth: 'fixed-width' });
  return b;
};

const group = (parent, title, note) => {
  const g = I(parent, {
    type: 'frame', name: 'Group / ' + title, width: 'fill_container', layout: 'vertical', gap: 14,
    padding: [20, 20], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) },
  });
  const gh = I(g, { type: 'frame', name: 'group header', width: 'fill_container', layout: 'vertical', gap: 2 });
  I(gh, { type: 'text', content: title, fontSize: 14, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
  if (note) I(gh, { type: 'text', content: note, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  return g;
};

const row = (parent, gap) => I(parent, { type: 'frame', name: 'row', width: 'fill_container', layout: 'horizontal', gap: gap || 12, alignItems: 'center' });

const labeled = (parent, label, nodeFn) => {
  const c = I(parent, { type: 'frame', name: 'cell / ' + label, layout: 'vertical', gap: 8, alignItems: 'center' });
  nodeFn(c);
  I(c, { type: 'text', content: label, fontSize: 10, fill: s(C.text2) });
  return c;
};

const b = board('WorldCredit · Component Masters', '组件先于页面：页面通过 ref 实例化，禁止在页面里复制粘贴卡片再逐个微调。');

// ---------- Button ----------
const btnG = group(b, 'Button', '高度 40 · 圆角 8 · fontSize 14 / 600 · 无阴影 · hover 描边加深 · pressed 实底加深 · focus 2px 外描边');
const btnRow = row(btnG, 16);
const button = (parent, label, kind) => labeled(parent, label, (c) => {
  const styles = {
    primary: { fill: s(C.primary), text: C.onDark, stroke: null },
    secondary: { fill: s(C.primaryDark), text: C.onDark, stroke: null },
    outline: { fill: s(C.surface), text: C.primaryDark, stroke: { thickness: 1, fill: s(C.primaryDark) } },
    ghost: { fill: s(C.surface), text: C.primaryDark, stroke: null },
    danger: { fill: s(C.danger), text: C.onDark, stroke: null },
    disabled: { fill: s(C.subtle), text: C.textDisabled, stroke: { thickness: 1, fill: s(C.border) } },
  }[kind];
  if (!styles) throw new Error(`Unsupported button kind: ${kind}`);
  const node = { type: 'frame', name: 'Button / ' + label, width: 128, height: 40, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 8, fill: styles.fill };
  if (styles.stroke) node.stroke = styles.stroke;
  const el = I(c, node);
  I(el, { type: 'text', content: label, fontSize: 14, fontWeight: 600, fill: s(styles.text) });
});
for (const [l, k] of [['主要操作', 'primary'], ['强调', 'secondary'], ['次要', 'outline'], ['文字按钮', 'ghost'], ['危险操作', 'danger'], ['禁用', 'disabled']]) button(btnRow, l, k);
// 交互态实体（B0-1 补缺口）：hover / pressed / focus 必须有可审查的画法
const btnStateRow = row(btnG, 16);
const stateButton = (parent, label, kind) => labeled(parent, label, (c) => {
  if (kind === 'focus') {
    const ring = I(c, { type: 'frame', name: 'Button / ' + label + ' ring', width: 136, height: 48, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 10, stroke: { thickness: 2, fill: s(C.secondary) } });
    const el = I(ring, { type: 'frame', name: 'Button / ' + label, width: 128, height: 40, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 8, fill: s(C.primary) });
    I(el, { type: 'text', content: '主要操作', fontSize: 14, fontWeight: 600, fill: s(C.onDark) });
    return;
  }
  const styles = {
    hover: { fill: s(C.primary), stroke: { thickness: 1, fill: s(C.primaryDark) } },
    pressed: { fill: s(C.primaryDark), stroke: null },
  }[kind];
  if (!styles) throw new Error(`Unsupported button state kind: ${kind}`);
  const node = { type: 'frame', name: 'Button / ' + label, width: 128, height: 40, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 8, fill: styles.fill };
  if (styles.stroke) node.stroke = styles.stroke;
  const el = I(c, node);
  I(el, { type: 'text', content: '主要操作', fontSize: 14, fontWeight: 600, fill: s(C.onDark) });
});
stateButton(btnStateRow, '悬停 hover', 'hover');
stateButton(btnStateRow, '按下 pressed', 'pressed');
stateButton(btnStateRow, '聚焦 focus', 'focus');

// ---------- Input ----------
const inputG = group(b, 'Input', '高度 40 · 圆角 8 · label 常驻左上（不做浮动 label）· 校验 on blur');
const inputRow = row(inputG, 16);
const inputCell = (label, value, state) => labeled(inputRow, state, (c) => {
  const wrap = I(c, { type: 'frame', name: 'field', width: 240, layout: 'vertical', gap: 6 });
  I(wrap, { type: 'text', content: label, fontSize: 12, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  const strokeColor = state === 'error' ? C.danger : state === 'focus' ? C.primary : C.borderInput;
  const box = I(wrap, {
    type: 'frame', name: 'input', width: 'fill_container', height: 40, layout: 'horizontal', alignItems: 'center',
    padding: [8, 12], cornerRadius: 8, fill: s(state === 'disabled' ? C.subtle : C.surface), stroke: { thickness: state === 'focus' ? 2 : 1, fill: s(strokeColor) },
  });
  const valueColor = state === 'disabled' ? C.textDisabled : value === placeholder ? C.text2 : C.text;
  I(box, { type: 'text', content: value, fontSize: 14, fill: s(valueColor), textGrowth: 'fixed-width' });
  if (state === 'error') I(wrap, { type: 'text', content: '必填项', fontSize: 11, fill: s(C.danger), textGrowth: 'fixed-width' });
});
const placeholder = '请输入';
inputCell('持卡人', placeholder, 'default');
inputCell('卡号后四位', '4821', 'focus');
inputCell('账单金额', placeholder, 'error');
inputCell('备注', '不可编辑', 'disabled');

// ---------- Badge ----------
const badgeG = group(b, 'Status Badge', '淡底 + ink 文字（B0 决策 1，与 app WcBadge 同配方）· success 12% / warn 18% / danger 12% / info 10% / gold 18%');
const badgeRow = row(badgeG, 12);
// soft 底 = color-mix 等价字面值；文字用 ink 档（AI 徽章用 navy，gold700 压金底 4.22 不达 AA）。
const badgeStyle = (label) => ({
  '已还清': { bg: '$color.status.successSoft', fg: '$color.status.successInk' },
  '部分还款': { bg: '$color.status.warningSoft', fg: '$color.status.warningInk' },
  '已逾期': { bg: '$color.status.dangerSoft', fg: '$color.status.dangerInk' },
  '待还': { bg: '$color.status.infoSoft', fg: '$color.status.infoInk' },
  'AI 识别': { bg: '$color.brand.goldSoft', fg: C.navy },
  '邮件来源': { bg: '$color.status.infoSoft', fg: '$color.status.infoInk' },
}[label]);
for (const label of ['已还清', '部分还款', '已逾期', '待还', 'AI 识别', '邮件来源']) {
  const st = badgeStyle(label);
  const el = I(badgeRow, { type: 'frame', name: 'Badge / ' + label, layout: 'horizontal', padding: [4, 12], cornerRadius: 999, fill: s(st.bg) });
  I(el, { type: 'text', content: label, fontSize: 12, fontWeight: 700, fill: s(st.fg) });
}

// ---------- Metric Card ----------
const metricG = group(b, 'Metric Card', '浅底 + 边框 + 等宽数字；逾期红 / 临期金 / 正常深蓝');
const metricRow = row(metricG, 16);
for (const [label, value, color] of [['总欠款', '¥42,180.00', C.navy], ['本月应还', '¥8,640.50', C.navy], ['临期账单', '¥2,300.00', C.gold700], ['已逾期', '¥1,280.00', C.danger]]) {
  const el = I(metricRow, {
    type: 'frame', name: 'MetricCard / ' + label, width: 'fill_container', layout: 'vertical', gap: 8,
    padding: [16, 16], cornerRadius: 12, fill: s(C.subtle), stroke: { thickness: 1, fill: s(C.border) },
  });
  I(el, { type: 'text', content: label, fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(el, { type: 'text', content: value, fontSize: 22, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(color), textGrowth: 'fixed-width' });
}

// ---------- List Item / Bill Card ----------
const listG = group(b, 'List Item & Bill Card', '白底圆角卡片 + 悬浮阴影；第一行账户信息，第二行账单日 / 还款日 / 免息；点击进详情');
const billCard = I(listG, {
  type: 'frame', name: 'BillCard', width: 'fill_container', layout: 'vertical', gap: 12,
  padding: [16, 16], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) },
  effects: [{ type: 'shadow', offsetX: 0, offsetY: 2, blur: 8, spread: 0, color: 'rgba(10,31,68,0.06)' }],
});
const bcTop = row(billCard, 12);
const bcLeft = I(bcTop, { type: 'frame', name: 'left', width: 'fill_container', layout: 'vertical', gap: 4 });
I(bcLeft, { type: 'text', content: '招商银行 · 经典白金', fontSize: 15, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
I(bcLeft, { type: 'text', content: '尾号 4821 · 持卡人 呼博', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
const bcRight = I(bcTop, { type: 'frame', name: 'right', layout: 'vertical', gap: 4, alignItems: 'end' });
I(bcRight, { type: 'text', content: '¥8,640.50', fontSize: 18, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(C.text), textGrowth: 'fixed-width' });
const bcBadge = I(bcRight, { type: 'frame', name: 'badge', layout: 'horizontal', padding: [2, 10], cornerRadius: 999, fill: s('$color.status.infoSoft') });
I(bcBadge, { type: 'text', content: '待还', fontSize: 11, fontWeight: 700, fill: s('$color.status.infoInk') });
I(billCard, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(C.border) });
const bcSub = row(billCard, 16);
I(bcSub, { type: 'text', content: '账单日 09-05', fontSize: 11, fill: s(C.text2) });
I(bcSub, { type: 'text', content: '还款日 09-25', fontSize: 11, fill: s(C.text2) });
I(bcSub, { type: 'text', content: '免息 20 天', fontSize: 11, fill: s(C.text2) });

const listG2 = group(b, 'Grouped List Row', '后台与设置页共用：左侧标签 + 右侧值 + 可选箭头');
const listRow = (parent, label, value, chevron) => {
  const r = I(parent, { type: 'frame', name: 'ListRow / ' + label, width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [14, 0] });
  I(r, { type: 'text', content: label, fontSize: 14, fill: s(C.text), textGrowth: 'fixed-width' });
  const right = I(r, { type: 'frame', name: 'right', layout: 'horizontal', gap: 8, alignItems: 'center' });
  I(right, { type: 'text', content: value, fontSize: 14, fill: s(C.text2), textGrowth: 'fixed-width' });
  if (chevron) I(right, { type: 'icon_font', iconFontName: 'chevron-right', width: 16, height: 16, fill: s(C.text2) });
  return r;
};
listRow(listG2, '默认持卡人', '呼博', true);
I(listG2, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(C.border) });
listRow(listG2, '账单币种', 'CNY', true);
I(listG2, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(C.border) });
listRow(listG2, '邮件账单同步', '已开启', false);

// ---------- States ----------
const stateG = group(b, 'States', '每个列表/表单必须覆盖：加载骨架 / 空态 / 错误态；错误必须保留用户输入并可重试');
const stateRow = row(stateG, 16);
const stateCol = (kind) => labeled(stateRow, kind, (c) => {
  const box = I(c, {
    type: 'frame', name: 'StateHolder / ' + kind, width: 300, height: 180, layout: 'vertical', gap: 12,
    padding: [20, 20], justifyContent: 'center', alignItems: 'center',
    cornerRadius: 12, fill: s(kind === '错误' ? '$color.status.dangerSoft' : C.surface),
    stroke: { thickness: 1, fill: s(kind === '错误' ? C.danger : C.border) },
  });
  if (kind === '加载') {
    for (const w of [180, 240, 140]) I(box, { type: 'rectangle', width: w, height: 14, cornerRadius: 999, fill: s('$color.bg.skeleton') });
  } else {
    I(box, { type: 'icon_font', iconFontName: kind === '空态' ? 'inbox' : 'alert-circle', width: 32, height: 32, fill: s(kind === '空态' ? C.text2 : C.danger) });
    I(box, { type: 'text', content: kind === '空态' ? '还没有账单' : '加载失败', fontSize: 15, fontWeight: 600, fill: s(C.text) });
    I(box, { type: 'text', content: kind === '空态' ? '同步邮件或手动记一笔' : '网络异常，请重试', fontSize: 12, fill: s(C.text2), textAlign: 'center', textGrowth: 'fixed-width' });
    const act = I(box, { type: 'frame', name: 'cta', layout: 'horizontal', padding: [10, 20], cornerRadius: 999, fill: s(kind === '空态' ? C.primary : C.danger) });
    I(act, { type: 'text', content: kind === '空态' ? '记一笔' : '重试', fontSize: 13, fontWeight: 600, fill: s(C.onDark) });
  }
});
stateCol('加载'); stateCol('空态'); stateCol('错误');

console.log('components built');
