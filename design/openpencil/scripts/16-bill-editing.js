// 16 · Bill Editing — 账单编辑能力全景（docs/specs/13-bill-editing.md 目标设计 §6）
// 运行（op design 脚本模式：I() 是宿主内置的节点插入函数，同 13-candidates.js；
//       JSON 直插语义，不经 refine，几何不被引擎重排）:
//   op design @design/openpencil/scripts/16-bill-editing.js --page <16页ID>
//   完整说明见 screens/BILL-EDITING-REDESIGN.md
//
// 结构约定（与 15 · iOS Bills 同构，过 check-overflow-portable 的平铺规则）:
//   - 画板 layout:none，440×956，直接子节点是互不重叠的平铺块
//   - 弹窗类画板 = status bar(0..48) + scene(48..956, layout:none)；
//     压暗背景 / 遮罩 / 对话框全部放在 scene 内部（内层不再受同层重叠检查）
//   - 颜色只走 $token：dark 用 obsidian 系，light 用 bg/status 系
//
// 设计语义（spec §6 编辑矩阵）:
//   编辑一律写 override/专用列；卡与账期锁定（UNIQUE(card_id, bill_month)）；
//   状态改前按还款记录重算（允许 paid 回退）；金额低于已还给警示；
//   还款记录可改可删；草稿确认前可改金额日期；删除账单二次确认并级联还款。

const s = (c) => [{ type: 'solid', color: c }];

const T = {
  dark: {
    canvas: '$color.obsidian.canvas', surface: '$color.obsidian.surface', subtle: '$color.obsidian.subtle',
    border: '$color.obsidian.border', text: '$color.obsidian.text', text2: '$color.obsidian.muted',
    accent: '$color.obsidian.accent', onAccent: '$color.text.onDark', scrimText: '$color.obsidian.muted',
    warnInk: '$color.obsidian.warningInk', warnSoft: '$color.obsidian.goldSoft',
    dangerInk: '$color.obsidian.dangerInk', dangerSoft: '$color.obsidian.dangerSoft',
    okInk: '$color.obsidian.successInk', okSoft: '$color.obsidian.successSoft',
    disabled: '$color.obsidian.muted',
  },
  light: {
    canvas: '$color.bg.canvas', surface: '$color.bg.surface', subtle: '$color.bg.subtle',
    border: '$color.border.default', text: '$color.text.primary', text2: '$color.text.secondary',
    accent: '$color.runtime.primary', onAccent: '$color.text.onDark', scrimText: '$color.text.secondary',
    warnInk: '$color.status.warningInk', warnSoft: '$color.status.warningSoft',
    dangerInk: '$color.status.dangerInk', dangerSoft: '$color.status.dangerSoft',
    okInk: '$color.status.successInk', okSoft: '$color.status.successSoft',
    disabled: '$color.text.disabled',
  },
};

const W = 440, H = 956, SB = 48, PAD = 20, SCENE_H = H - SB; // 908
const FONT = 'PingFang SC';

// ---------- 基础片段 ----------

const statusBar = (parent, m) => {
  const sb = I(parent, {
    type: 'frame', name: 'status bar', x: 0, y: 0, width: W, height: SB,
    layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, PAD],
  });
  I(sb, { type: 'text', name: 'time', content: '9:41', fontFamily: FONT, fontSize: 13, fontWeight: 600, fill: s(m.text) });
  const r = I(sb, { type: 'frame', name: 'system indicators', layout: 'horizontal', gap: 6, alignItems: 'center' });
  for (const i of ['signal', 'wifi', 'battery-full']) {
    I(r, { type: 'icon_font', name: 'icon / ' + i, iconFontName: i, width: 16, height: 16, fill: s(m.text) });
  }
};

const navHeader = (parent, m, title, trail) => {
  const header = I(parent, {
    type: 'frame', name: 'navigation header', x: PAD, y: 66, width: W - 2 * PAD, height: 44,
    layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center',
  });
  const back = I(header, { type: 'frame', name: 'btn / back', width: 44, height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center' });
  I(back, { type: 'icon_font', name: 'icon / chevron-left', iconFontName: 'chevron-left', width: 22, height: 22, fill: s(m.text) });
  I(header, { type: 'text', name: 'page title', content: title, fontFamily: FONT, fontSize: 21, fontWeight: 600, lineHeight: 1.3, fill: s(m.text) });
  // 仅在传入 trail 时创建尾部按钮容器：无删除动作的屏幕生成同名空节点会
  // 误导契约（_contract.json 按 node 名匹配标记）与设计工具节点定位。
  if (trail) {
    const trailWrap = I(header, { type: 'frame', name: 'btn / delete bill', width: 44, height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center' });
    I(trailWrap, { type: 'icon_font', name: 'icon / ' + trail.icon, iconFontName: trail.icon, width: 20, height: 20, fill: s(trail.danger ? m.dangerInk : m.text) });
  }
};

const actionBar = (parent, m, primary, secondary) => {
  const bar = I(parent, {
    type: 'frame', name: 'action bar', x: 0, y: H - 34 - 64, width: W, height: 64,
    layout: 'horizontal', gap: 12, alignItems: 'center', padding: [10, PAD], fill: s(m.surface),
  });
  if (secondary) {
    const sec = I(bar, {
      type: 'frame', name: 'btn / ' + secondary.key, height: 44, layout: 'horizontal',
      justifyContent: 'center', alignItems: 'center', padding: [0, 18], cornerRadius: 999, fill: s(m.subtle),
    });
    I(sec, { type: 'text', content: secondary.label, fontFamily: FONT, fontSize: 15, fontWeight: 600, fill: s(m.text) });
  }
  const p = I(bar, {
    type: 'frame', name: 'btn / ' + primary.key, width: 'fill_container', height: 44, layout: 'horizontal',
    justifyContent: 'center', alignItems: 'center', gap: 6, cornerRadius: 999, fill: s(m.accent),
  });
  I(p, { type: 'text', content: primary.label, fontFamily: FONT, fontSize: 15, fontWeight: 700, fill: s(m.onAccent) });
};

const pill = (parent, m, label, kind, iconName) => {
  const map = {
    warn: [m.warnSoft, m.warnInk], danger: [m.dangerSoft, m.dangerInk], ok: [m.okSoft, m.okInk],
    neutral: [m.subtle, m.text2],
  }[kind || 'neutral'];
  const el = I(parent, {
    type: 'frame', name: 'status / ' + label, layout: 'horizontal', gap: 4, padding: [3, 10],
    cornerRadius: 999, fill: s(map[0]), alignItems: 'center',
  });
  if (iconName) I(el, { type: 'icon_font', name: 'icon / ' + iconName, iconFontName: iconName, width: 12, height: 12, fill: s(map[1]) });
  I(el, { type: 'text', content: label, fontFamily: FONT, fontSize: 11, fontWeight: 700, fill: s(map[1]) });
};

const fieldRow = (parent, m, f) => {
  const row = I(parent, {
    type: 'frame', name: 'field row / ' + f.key, width: 'fill_container', layout: 'horizontal',
    justifyContent: 'space_between', alignItems: 'center', padding: [12, 0],
  });
  const labelCol = I(row, { type: 'frame', name: 'field label / ' + f.key, layout: 'vertical', gap: 2 });
  I(labelCol, { type: 'text', content: f.label, fontFamily: FONT, fontSize: 14.5, fontWeight: 600, fill: s(f.disabled ? m.disabled : m.text) });
  if (f.hint) I(labelCol, { type: 'text', content: f.hint, fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
  const valueCol = I(row, { type: 'frame', name: 'field value / ' + f.key, layout: 'horizontal', gap: 6, alignItems: 'center' });
  if (f.pinned) {
    const pin = I(valueCol, { type: 'frame', name: 'override pin / ' + f.key, layout: 'horizontal', gap: 3, padding: [2, 7], cornerRadius: 6, fill: s(m.warnSoft) });
    I(pin, { type: 'text', content: '已手动设定', fontFamily: FONT, fontSize: 9, fontWeight: 600, fill: s(m.warnInk) });
  }
  I(valueCol, { type: 'text', name: 'field text / ' + f.key, content: f.value, fontFamily: 'Inter Tight', fontSize: f.big ? 22 : 15, fontWeight: f.big ? 700 : 500, fill: s(f.disabled ? m.disabled : m.text) });
  if (f.arrow) I(valueCol, { type: 'icon_font', name: 'icon / chevron-right', iconFontName: 'chevron-right', width: 16, height: 16, fill: s(f.disabled ? m.disabled : m.text2) });
  if (f.lock) I(valueCol, { type: 'icon_font', name: 'icon / lock', iconFontName: 'lock', width: 14, height: 14, fill: s(m.disabled) });
};

const sectionTitle = (parent, m, label, note) => {
  const row = I(parent, { type: 'frame', name: 'section / ' + label, width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  I(row, { type: 'text', content: label, fontFamily: FONT, fontSize: 13, fontWeight: 700, fill: s(m.text2) });
  if (note) I(row, { type: 'text', content: note, fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
};

const billCardHead = (parent, m, info) => {
  const col = I(parent, { type: 'frame', name: 'bill card / ' + info.bank, layout: 'vertical', gap: 4 });
  const titleRow = I(col, { type: 'frame', name: 'title row', layout: 'horizontal', gap: 8, alignItems: 'center' });
  I(titleRow, { type: 'text', name: 'bank name', content: info.bank, fontFamily: FONT, fontSize: 15, fontWeight: 700, fill: s(m.text) });
  I(titleRow, { type: 'text', name: 'card title', content: info.card, fontFamily: FONT, fontSize: 12, fill: s(m.text2) });
  const subRow = I(col, { type: 'frame', name: 'holder and period', layout: 'horizontal', gap: 8, alignItems: 'center' });
  I(subRow, { type: 'text', content: info.holder, fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
  I(subRow, { type: 'text', content: info.period, fontFamily: FONT, fontSize: 11, fontWeight: 600, fill: s(m.text2) });
};

// 弹窗画板骨架：状态栏 + scene（内部自由堆叠，不受同层重叠检查）
const sceneBoard = (key, mode) => {
  const m = T[mode];
  const f = I(null, {
    type: 'frame', name: 'candidate.ios.' + key + ' · ' + mode + ' · ' + W + '×' + H,
    width: W, height: H, layout: 'none', clipContent: true, fill: s(m.canvas),
  });
  statusBar(f, m);
  const scene = I(f, { type: 'frame', name: 'dialog scene', x: 0, y: SB, width: W, height: SCENE_H, layout: 'none', clipContent: true });
  return { f, m, scene };
};

// 压暗的背景内容 + 黑色遮罩（都在 scene 内）
const dimmedBackdrop = (scene, m, title, total, context) => {
  const bg = I(scene, {
    type: 'frame', name: 'dismiss backdrop', x: 0, y: 0, width: W, height: SCENE_H,
    layout: 'vertical', gap: 8, padding: [92, PAD], fill: s(m.canvas), opacity: 0.35,
  });
  I(bg, { type: 'text', name: 'background title', content: title, fontFamily: FONT, fontSize: 17, fontWeight: 600, fill: s(m.scrimText) });
  I(bg, { type: 'text', name: 'background total', content: total, fontFamily: 'Inter Tight', fontSize: 26, fontWeight: 700, fill: s(m.scrimText) });
  I(bg, { type: 'text', name: 'background context', content: context, fontFamily: FONT, fontSize: 12, fill: s(m.scrimText) });
  // 纯黑遮罩是刻意例外：scrim 需要 darkest-possible 压暗保证对话框对比度，
  // 两主题共用同一值（不随主题收敛），故不走 $token。
  I(scene, { type: 'frame', name: 'dialog scrim', x: 0, y: 0, width: W, height: SCENE_H, layout: 'none', fill: s('#000000'), opacity: 0.45 });
};

const dialogIn = (scene, m, title, w, h) => {
  const dialog = I(scene, {
    type: 'frame', name: 'dialog', x: (W - w) / 2, y: (SCENE_H - h) / 2 - 40, width: w, height: h,
    layout: 'vertical', padding: 20, gap: 12, cornerRadius: 18, fill: s(m.surface), clipContent: true,
  });
  const head = I(dialog, { type: 'frame', name: 'dialog header', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  I(head, { type: 'text', name: 'dialog title', content: title, fontFamily: FONT, fontSize: 18, fontWeight: 700, fill: s(m.text) });
  const close = I(head, { type: 'frame', name: 'btn / close', width: 30, height: 30, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.subtle) });
  I(close, { type: 'icon_font', name: 'icon / x', iconFontName: 'x', width: 16, height: 16, fill: s(m.text2) });
  return dialog;
};

const formBoard = (key, mode) => {
  const m = T[mode];
  const f = I(null, {
    type: 'frame', name: 'candidate.ios.' + key + ' · ' + mode + ' · ' + W + '×' + H,
    width: W, height: H, layout: 'none', clipContent: true, fill: s(m.canvas),
  });
  statusBar(f, m);
  return { f, m };
};

const amountHero = (parent, m, label, value, color) => {
  const col = I(parent, { type: 'frame', name: 'amount value / ' + label, layout: 'vertical', gap: 2 });
  I(col, { type: 'text', content: label, fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
  const line = I(col, { type: 'frame', name: 'amount line', layout: 'horizontal', gap: 4, alignItems: 'end' });
  I(line, { type: 'text', content: '¥', fontFamily: 'Inter Tight', fontSize: 15, fontWeight: 600, fill: s(color || m.text) });
  I(line, { type: 'text', content: value, fontFamily: 'Inter Tight', fontSize: 28, fontWeight: 700, lineHeight: 1.1, fill: s(color || m.text) });
};

const inputAmount = (parent, m, value) => {
  const box = I(parent, { type: 'frame', name: 'input amount', width: 'fill_container', height: 52, layout: 'horizontal', alignItems: 'center', padding: [0, 14], cornerRadius: 10, fill: s(m.subtle) });
  I(box, { type: 'text', content: '¥', fontFamily: 'Inter Tight', fontSize: 16, fontWeight: 600, fill: s(m.text) });
  I(box, { type: 'text', content: ' ' + value, fontFamily: 'Inter Tight', fontSize: 24, fontWeight: 700, fill: s(m.text) });
};

const warnIconRow = (parent, m) => {
  const row = I(parent, { type: 'frame', name: 'warn icon', width: 'fill_container', layout: 'horizontal', justifyContent: 'center', padding: [4, 0] });
  const wrap = I(row, { type: 'frame', name: 'icon wrap', width: 44, height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.dangerSoft) });
  I(wrap, { type: 'icon_font', name: 'icon / alert', iconFontName: 'triangle-alert', width: 22, height: 22, fill: s(m.dangerInk) });
};

// =====================================================================
// 1) bill-editing — 编辑表单（全字段 + 身份锁定 + 高级折叠）
// =====================================================================
const drawEditForm = (mode) => {
  const { f, m } = formBoard('bill-editing', mode);
  navHeader(f, m, '编辑账单', { icon: 'trash-2', danger: true });

  const content = I(f, { type: 'frame', name: 'content', x: 0, y: 126, width: W, height: H - 126 - 98, layout: 'vertical', gap: 10, padding: [4, PAD], clipContent: true });

  const idCard = I(content, { type: 'frame', name: 'identity card', width: 'fill_container', layout: 'vertical', gap: 6, padding: 14, cornerRadius: 12, fill: s(m.subtle) });
  billCardHead(idCard, m, { bank: '招商银行', card: '标准信用卡', holder: '持卡人 · 本人', period: '十月账期' });
  const lockRow = I(idCard, { type: 'frame', name: 'identity lock note', layout: 'horizontal', gap: 6, alignItems: 'center' });
  I(lockRow, { type: 'icon_font', name: 'icon / lock', iconFontName: 'lock', width: 13, height: 13, fill: s(m.text2) });
  I(lockRow, { type: 'text', content: '卡与账期是账单身份，不可修改；如需换卡请删除后重新录入', fontFamily: FONT, fontSize: 11, fill: s(m.text2), textGrowth: 'fixed-width' });

  const fieldsCard = I(content, { type: 'frame', name: 'fields card', width: 'fill_container', layout: 'vertical', padding: [4, 14], cornerRadius: 12, fill: s(m.surface) });
  fieldRow(fieldsCard, m, { key: 'amount', label: '账单金额', value: '4,800.00', big: true, arrow: true, pinned: true, hint: '写入手动钉住值，不会被邮件导入覆盖' });
  fieldRow(fieldsCard, m, { key: 'min-payment', label: '最低还款额', value: '480.00', arrow: true, hint: '可选' });
  fieldRow(fieldsCard, m, { key: 'statement-date', label: '账单日', value: '10月26日', arrow: true });
  fieldRow(fieldsCard, m, { key: 'due-date', label: '还款到期日', value: '11月24日', arrow: true });

  sectionTitle(content, m, '账单状态', '修改后按还款记录重算');
  const statusCard = I(content, { type: 'frame', name: 'status card', width: 'fill_container', layout: 'vertical', padding: [8, 14], cornerRadius: 12, fill: s(m.surface) });
  const statusRow = I(statusCard, { type: 'frame', name: 'status options', width: 'fill_container', layout: 'horizontal', gap: 8, alignItems: 'center' });
  for (const [label, active] of [['待还', true], ['部分还款', false], ['已结清', false], ['逾期', false]]) {
    const opt = I(statusRow, {
      type: 'frame', name: 'status option / ' + label, layout: 'horizontal', justifyContent: 'center',
      alignItems: 'center', padding: [8, 0], width: 'fill_container', cornerRadius: 999, fill: s(active ? m.accent : m.subtle),
    });
    I(opt, { type: 'text', content: label, fontFamily: FONT, fontSize: 12.5, fontWeight: active ? 700 : 500, fill: s(active ? m.onAccent : m.text2) });
  }
  const recompute = I(statusCard, { type: 'frame', name: 'recompute note', width: 'fill_container', layout: 'horizontal', gap: 6, alignItems: 'center', padding: [6, 0] });
  I(recompute, { type: 'icon_font', name: 'icon / info', iconFontName: 'info', width: 13, height: 13, fill: s(m.text2) });
  I(recompute, { type: 'text', content: '改状态前先按已还总额重算，已还 ≥ 生效金额即视为结清', fontFamily: FONT, fontSize: 11, fill: s(m.text2), textGrowth: 'fixed-width' });

  const advCard = I(content, { type: 'frame', name: 'advanced card', width: 'fill_container', layout: 'vertical', padding: [4, 14], cornerRadius: 12, fill: s(m.surface) });
  const advHead = I(advCard, { type: 'frame', name: 'advanced toggle', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [10, 0] });
  I(advHead, { type: 'text', content: '账期首末日（高级）', fontFamily: FONT, fontSize: 14.5, fontWeight: 600, fill: s(m.text2) });
  const advVal = I(advHead, { type: 'frame', name: 'advanced value', layout: 'horizontal', gap: 6, alignItems: 'center' });
  I(advVal, { type: 'text', content: '10/01 – 10/25', fontFamily: 'Inter Tight', fontSize: 13, fill: s(m.text2) });
  I(advVal, { type: 'icon_font', name: 'icon / chevron-down', iconFontName: 'chevron-down', width: 16, height: 16, fill: s(m.text2) });
  fieldRow(advCard, m, { key: 'statement-start', label: '账期首日', value: '10月1日', arrow: true });
  fieldRow(advCard, m, { key: 'statement-end', label: '账期末日', value: '10月25日', arrow: true });

  actionBar(f, m, { key: 'save', label: '保存修改' }, { key: 'revert', label: '放弃' });
  return f;
};

// =====================================================================
// 2) bill-editing-amount — 手填金额弹窗
// =====================================================================
const drawAmountDialog = (mode) => {
  const { f, m, scene } = sceneBoard('bill-editing-amount', mode);
  dimmedBackdrop(scene, m, '账单详情', '¥ 4,800.00', '招商银行 · 十月账期 · 11/24 到期');
  const dialog = dialogIn(scene, m, '手动填写金额', 400, 348);

  const src = I(dialog, { type: 'frame', name: 'source rows', width: 'fill_container', layout: 'vertical' });
  fieldRow(src, m, { key: 'imported', label: '邮件导入值', value: '4,800.00', disabled: true, lock: true });
  fieldRow(src, m, { key: 'manual', label: '手动值（优先）', value: '4,720.00', arrow: true, pinned: true });

  inputAmount(dialog, m, '4,720.00');

  const hint = I(dialog, { type: 'frame', name: 'priority hint', width: 'fill_container', layout: 'horizontal', gap: 6, alignItems: 'center', padding: [8, 10], cornerRadius: 10, fill: s(m.warnSoft) });
  I(hint, { type: 'icon_font', name: 'icon / shield', iconFontName: 'shield', width: 14, height: 14, fill: s(m.warnInk) });
  I(hint, { type: 'text', content: '手动填写的金额优先级最高，邮件导入、Gmail 同步不会覆盖它', fontFamily: FONT, fontSize: 11, fill: s(m.warnInk), textGrowth: 'fixed-width' });

  const actions = I(dialog, { type: 'frame', name: 'dialog actions', width: 'fill_container', layout: 'horizontal', gap: 10 });
  const clearBtn = I(actions, { type: 'frame', name: 'btn / clear override', width: 120, height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.subtle) });
  I(clearBtn, { type: 'text', content: '撤销钉住', fontFamily: FONT, fontSize: 14, fontWeight: 600, fill: s(m.warnInk) });
  const saveBtn = I(actions, { type: 'frame', name: 'btn / save override', width: 'fill_container', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.accent) });
  I(saveBtn, { type: 'text', content: '保存手动值', fontFamily: FONT, fontSize: 14.5, fontWeight: 700, fill: s(m.onAccent) });
  return f;
};

// =====================================================================
// 3) bill-editing-override-warning — 金额低于已还警示
// =====================================================================
const drawOverrideWarning = (mode) => {
  const { f, m, scene } = sceneBoard('bill-editing-override-warning', mode);
  dimmedBackdrop(scene, m, '手动填写金额', '¥ 1,200.00', '导入值 4,800.00 · 已还 1,600.00');
  const dialog = dialogIn(scene, m, '金额低于已还总额', 400, 306);

  warnIconRow(dialog, m);
  const body = I(dialog, { type: 'frame', name: 'warn body', width: 'fill_container', layout: 'vertical', gap: 8, alignItems: 'center' });
  I(body, { type: 'text', content: '新金额 1,200.00 低于已还总额 1,600.00', fontFamily: FONT, fontSize: 14.5, fontWeight: 600, fill: s(m.text) });
  I(body, { type: 'text', content: '保存后剩余待还为 0，后续再登记还款会被拒绝；如需修正请先调整还款记录', fontFamily: FONT, fontSize: 12, fill: s(m.text2), textGrowth: 'fixed-width', textAlign: 'center' });

  const actions = I(dialog, { type: 'frame', name: 'dialog actions', width: 'fill_container', layout: 'horizontal', gap: 10 });
  const back = I(actions, { type: 'frame', name: 'btn / back to edit', width: 'fill_container', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.subtle) });
  I(back, { type: 'text', content: '返回修改', fontFamily: FONT, fontSize: 14.5, fontWeight: 600, fill: s(m.text) });
  const confirm = I(actions, { type: 'frame', name: 'btn / confirm save', width: 150, height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.dangerSoft) });
  I(confirm, { type: 'text', content: '仍要保存', fontFamily: FONT, fontSize: 14.5, fontWeight: 700, fill: s(m.dangerInk) });
  return f;
};

// =====================================================================
// 4) bill-editing-status — 状态编辑弹窗
// =====================================================================
const drawStatusDialog = (mode) => {
  const { f, m, scene } = sceneBoard('bill-editing-status', mode);
  dimmedBackdrop(scene, m, '账单详情', '¥ 4,800.00', '已还 1,600.00 · 剩余 3,200.00');
  const dialog = dialogIn(scene, m, '账单状态', 400, 448);

  const opts = I(dialog, { type: 'frame', name: 'status options', width: 'fill_container', layout: 'vertical', gap: 8 });
  // 选中态由 active 行的描边/填充表达（见下方 row 样式），无需按语义色着色
  const items = [
    ['待还', 'unpaid', '按到期日与还款记录判定', 'circle-dashed'],
    ['部分还款', 'partial', '已还 1,600.00，剩余 3,200.00', 'circle-half-2'],
    ['已结清', 'paid', '已还 ≥ 生效金额，允许从结清回退', 'circle-check-big'],
    ['逾期', 'overdue', '到期日已过且未结清', 'circle-alert'],
  ];
  for (const [label, val, desc, iconName] of items) {
    const active = val === 'partial';
    const row = I(opts, {
      type: 'frame', name: 'status option / ' + label, width: 'fill_container', layout: 'horizontal',
      gap: 10, alignItems: 'center', padding: [10, 12], cornerRadius: 12,
      fill: s(active ? m.subtle : m.surface), stroke: { thickness: active ? 1.5 : 1, fill: s(active ? m.accent : m.border) },
    });
    I(row, { type: 'icon_font', name: 'icon / ' + iconName, iconFontName: iconName, width: 18, height: 18, fill: s(active ? m.accent : m.text2) });
    const col = I(row, { type: 'frame', name: 'option text', layout: 'vertical', gap: 2 });
    I(col, { type: 'text', content: label, fontFamily: FONT, fontSize: 14.5, fontWeight: 600, fill: s(m.text) });
    I(col, { type: 'text', content: desc, fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
    I(row, { type: 'frame', name: 'spacer', width: 'fill_container', height: 1 });
    if (active) I(row, { type: 'icon_font', name: 'icon / selected', iconFontName: 'circle-check-big', width: 18, height: 18, fill: s(m.accent) });
  }
  const note = I(dialog, { type: 'frame', name: 'recompute note', width: 'fill_container', layout: 'horizontal', gap: 6, alignItems: 'center' });
  I(note, { type: 'icon_font', name: 'icon / info', iconFontName: 'info', width: 13, height: 13, fill: s(m.text2) });
  I(note, { type: 'text', content: '状态变更会按还款记录重算后落库，修正不再受「已结清短路」限制', fontFamily: FONT, fontSize: 11, fill: s(m.text2), textGrowth: 'fixed-width' });
  const actions = I(dialog, { type: 'frame', name: 'dialog actions', width: 'fill_container', layout: 'horizontal' });
  const save = I(actions, { type: 'frame', name: 'btn / confirm status', width: 'fill_container', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.accent) });
  I(save, { type: 'text', content: '更新状态', fontFamily: FONT, fontSize: 14.5, fontWeight: 700, fill: s(m.onAccent) });
  return f;
};

// =====================================================================
// 5) bill-editing-payments — 还款记录管理
// =====================================================================
const drawPayments = (mode) => {
  const { f, m } = formBoard('bill-editing-payments', mode);
  navHeader(f, m, '还款记录');

  const content = I(f, { type: 'frame', name: 'content', x: 0, y: 126, width: W, height: H - 126 - 98, layout: 'vertical', gap: 10, padding: [4, PAD], clipContent: true });

  const sumCard = I(content, { type: 'frame', name: 'statement summary', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', padding: 14, cornerRadius: 12, fill: s(m.subtle) });
  for (const [key, label, val, color] of [['original value', '应还', '4,800.00', m.text], ['paid value', '已还', '1,600.00', m.okInk], ['remaining value', '剩余', '3,200.00', m.warnInk]]) {
    const c = I(sumCard, { type: 'frame', name: key, layout: 'vertical', gap: 2 });
    I(c, { type: 'text', content: label, fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
    I(c, { type: 'text', content: val, fontFamily: 'Inter Tight', fontSize: 17, fontWeight: 700, fill: s(color) });
  }

  sectionTitle(content, m, '还款记录', '共 2 笔');
  const listCard = I(content, { type: 'frame', name: 'payments list', width: 'fill_container', layout: 'vertical', padding: [2, 14], cornerRadius: 12, fill: s(m.surface) });
  const pays = [
    ['mobile-bank', '手机银行', '10月28日 · 登记后剩余 4,200.00', '600.00'],
    ['wechat-pay', '微信支付', '10月26日 · 登记后剩余 4,800.00', '1,000.00'],
  ];
  for (const [key, channel, meta, amt] of pays) {
    const row = I(listCard, { type: 'frame', name: 'payment row / ' + key, width: 'fill_container', layout: 'horizontal', gap: 10, alignItems: 'center', padding: [12, 0] });
    const col = I(row, { type: 'frame', name: 'payment info', layout: 'vertical', gap: 2 });
    I(col, { type: 'text', content: channel, fontFamily: FONT, fontSize: 14.5, fontWeight: 600, fill: s(m.text) });
    I(col, { type: 'text', content: meta, fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
    I(row, { type: 'frame', name: 'spacer', width: 'fill_container', height: 1 });
    I(row, { type: 'text', name: 'amount value / ' + key, content: '¥ ' + amt, fontFamily: 'Inter Tight', fontSize: 15, fontWeight: 700, fill: s(m.okInk) });
    const edit = I(row, { type: 'frame', name: 'btn / edit payment', width: 36, height: 36, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.subtle) });
    I(edit, { type: 'icon_font', name: 'icon / pencil', iconFontName: 'pencil', width: 16, height: 16, fill: s(m.text2) });
    const del = I(row, { type: 'frame', name: 'btn / delete payment', width: 36, height: 36, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.dangerSoft) });
    I(del, { type: 'icon_font', name: 'icon / trash-2', iconFontName: 'trash-2', width: 16, height: 16, fill: s(m.dangerInk) });
  }
  const recalc = I(content, { type: 'frame', name: 'recalc note', width: 'fill_container', layout: 'horizontal', gap: 6, alignItems: 'center', padding: [8, 12], cornerRadius: 10, fill: s(m.subtle) });
  I(recalc, { type: 'icon_font', name: 'icon / refresh-cw', iconFontName: 'refresh-cw', width: 13, height: 13, fill: s(m.text2) });
  I(recalc, { type: 'text', content: '修改或删除还款后自动重算账单状态；删除不可恢复但可重新登记', fontFamily: FONT, fontSize: 11, fill: s(m.text2), textGrowth: 'fixed-width' });

  actionBar(f, m, { key: 'add payment', label: '登记还款' });
  return f;
};

// =====================================================================
// 6) bill-editing-payment-edit — 单笔还款编辑弹窗
// =====================================================================
const drawPaymentEdit = (mode) => {
  const { f, m, scene } = sceneBoard('bill-editing-payment-edit', mode);
  dimmedBackdrop(scene, m, '还款记录', '¥ 600.00', '10月28日 · 手机银行');
  const dialog = dialogIn(scene, m, '编辑还款', 400, 444);

  inputAmount(dialog, m, '640.00');
  I(dialog, { type: 'text', name: 'input constraint', content: '金额需大于 0，且不超过剩余可还（重算前为 3,200.00）', fontFamily: FONT, fontSize: 11, fill: s(m.text2), textGrowth: 'fixed-width' });

  const rows = I(dialog, { type: 'frame', name: 'form rows', width: 'fill_container', layout: 'vertical' });
  fieldRow(rows, m, { key: 'pay-date', label: '还款日期', value: '10月28日', arrow: true });
  fieldRow(rows, m, { key: 'pay-channel', label: '渠道', value: '手机银行', arrow: true });
  fieldRow(rows, m, { key: 'pay-note', label: '备注', value: '部分还款', arrow: true });

  const preview = I(dialog, { type: 'frame', name: 'after payment', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', padding: [10, 12], cornerRadius: 10, fill: s(m.subtle) });
  const p1 = I(preview, { type: 'frame', name: 'after payment paid', layout: 'vertical', gap: 2 });
  I(p1, { type: 'text', content: '改后累计已还', fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
  I(p1, { type: 'text', content: '1,640.00', fontFamily: 'Inter Tight', fontSize: 15, fontWeight: 700, fill: s(m.okInk) });
  const p2 = I(preview, { type: 'frame', name: 'after payment remaining', layout: 'vertical', gap: 2 });
  I(p2, { type: 'text', content: '改后剩余', fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
  I(p2, { type: 'text', content: '3,160.00', fontFamily: 'Inter Tight', fontSize: 15, fontWeight: 700, fill: s(m.warnInk) });
  const p3 = I(preview, { type: 'frame', name: 'after payment status', layout: 'vertical', gap: 2 });
  I(p3, { type: 'text', content: '状态预览', fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
  pill(p3, m, '部分还款', 'warn');

  const actions = I(dialog, { type: 'frame', name: 'dialog actions', width: 'fill_container', layout: 'horizontal', gap: 10 });
  const del = I(actions, { type: 'frame', name: 'btn / delete payment', width: 110, height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', gap: 6, cornerRadius: 999, fill: s(m.dangerSoft) });
  I(del, { type: 'icon_font', name: 'icon / trash-2', iconFontName: 'trash-2', width: 16, height: 16, fill: s(m.dangerInk) });
  I(del, { type: 'text', content: '删除', fontFamily: FONT, fontSize: 14, fontWeight: 600, fill: s(m.dangerInk) });
  const save = I(actions, { type: 'frame', name: 'btn / save payment', width: 'fill_container', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.accent) });
  I(save, { type: 'text', content: '保存修改', fontFamily: FONT, fontSize: 14.5, fontWeight: 700, fill: s(m.onAccent) });
  return f;
};

// =====================================================================
// 7) bill-editing-delete — 删除账单确认
// =====================================================================
const drawDeleteConfirm = (mode) => {
  const { f, m, scene } = sceneBoard('bill-editing-delete', mode);
  dimmedBackdrop(scene, m, '编辑账单', '招商银行 · 十月账期', '删除前需确认：还款记录将一并删除');
  const dialog = dialogIn(scene, m, '删除账单', 400, 322);

  warnIconRow(dialog, m);
  const body = I(dialog, { type: 'frame', name: 'warn body', width: 'fill_container', layout: 'vertical', gap: 8, alignItems: 'center' });
  I(body, { type: 'text', content: '删除招商银行十月账单？', fontFamily: FONT, fontSize: 15, fontWeight: 600, fill: s(m.text) });
  I(body, { type: 'text', content: '2 笔还款记录（合计 1,600.00）会一并删除，统计与 iOS 离线缓存将同步收敛。此操作不可恢复。', fontFamily: FONT, fontSize: 12, fill: s(m.text2), textGrowth: 'fixed-width', textAlign: 'center' });

  const actions = I(dialog, { type: 'frame', name: 'dialog actions', width: 'fill_container', layout: 'horizontal', gap: 10 });
  const cancel = I(actions, { type: 'frame', name: 'btn / cancel delete', width: 'fill_container', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.subtle) });
  I(cancel, { type: 'text', content: '取消', fontFamily: FONT, fontSize: 14.5, fontWeight: 600, fill: s(m.text) });
  const del = I(actions, { type: 'frame', name: 'btn / confirm delete', width: 150, height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.dangerSoft) });
  I(del, { type: 'text', content: '删除账单', fontFamily: FONT, fontSize: 14.5, fontWeight: 700, fill: s(m.dangerInk) });
  return f;
};

// =====================================================================
// 8) bill-editing-history — 金额来源历史
// =====================================================================
const drawHistory = (mode) => {
  const { f, m } = formBoard('bill-editing-history', mode);
  navHeader(f, m, '金额来源');

  const content = I(f, { type: 'frame', name: 'content', x: 0, y: 126, width: W, height: H - 126 - 98, layout: 'vertical', gap: 10, padding: [4, PAD], clipContent: true });

  const heroCard = I(content, { type: 'frame', name: 'effective amount card', width: 'fill_container', layout: 'vertical', gap: 6, padding: 14, cornerRadius: 12, fill: s(m.subtle) });
  amountHero(heroCard, m, '当前生效金额', '4,720.00');
  const pinRow = I(heroCard, { type: 'frame', name: 'effective source', layout: 'horizontal', gap: 6, alignItems: 'center' });
  pill(pinRow, m, '已手动设定', 'warn', 'pin');
  I(pinRow, { type: 'text', content: '生效值取手动钉住，不用导入值', fontFamily: FONT, fontSize: 11, fill: s(m.text2) });

  sectionTitle(content, m, '变动历史');
  const list = I(content, { type: 'frame', name: 'source history list', width: 'fill_container', layout: 'vertical', padding: [2, 14], cornerRadius: 12, fill: s(m.surface) });
  const entries = [
    ['pin', '手动钉住 · 本人', '10月30日', '4,720.00', 'pin', true],
    ['import', '邮件导入 · 账单邮件', '10月27日', '4,800.00', 'mail', false],
    ['create', '手动录入 · 本人', '10月12日', '4,800.00', 'pencil', false],
  ];
  for (const [key, title, ts, amt, iconName, effective] of entries) {
    const row = I(list, { type: 'frame', name: 'history row / ' + key, width: 'fill_container', layout: 'horizontal', gap: 10, alignItems: 'center', padding: [12, 0] });
    const ic = I(row, { type: 'frame', name: 'history icon', width: 32, height: 32, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(m.subtle) });
    I(ic, { type: 'icon_font', name: 'icon / ' + iconName, iconFontName: iconName, width: 15, height: 15, fill: s(m.text2) });
    const col = I(row, { type: 'frame', name: 'history text', layout: 'vertical', gap: 2 });
    I(col, { type: 'text', content: title, fontFamily: FONT, fontSize: 13.5, fontWeight: 600, fill: s(m.text) });
    I(col, { type: 'text', content: ts, fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
    I(row, { type: 'frame', name: 'spacer', width: 'fill_container', height: 1 });
    I(row, { type: 'text', name: 'amount value / ' + key, content: '¥ ' + amt, fontFamily: 'Inter Tight', fontSize: 14, fontWeight: 600, fill: s(m.text) });
    if (effective) pill(row, m, '生效中', 'ok', 'circle-check-big');
  }

  const note = I(content, { type: 'frame', name: 'override rule note', width: 'fill_container', layout: 'horizontal', gap: 6, alignItems: 'center', padding: [8, 12], cornerRadius: 10, fill: s(m.subtle) });
  I(note, { type: 'icon_font', name: 'icon / shield', iconFontName: 'shield', width: 13, height: 13, fill: s(m.text2) });
  I(note, { type: 'text', content: '导入值始终保留在账单上；撤销钉住后立即回落到最新导入值', fontFamily: FONT, fontSize: 11, fill: s(m.text2), textGrowth: 'fixed-width' });
  return f;
};

// =====================================================================
// 9) bill-editing-draft — 导入草稿编辑
// =====================================================================
const drawDraft = (mode) => {
  const { f, m } = formBoard('bill-editing-draft', mode);
  navHeader(f, m, '确认导入草稿');

  const content = I(f, { type: 'frame', name: 'content', x: 0, y: 126, width: W, height: H - 126 - 98, layout: 'vertical', gap: 10, padding: [4, PAD], clipContent: true });

  const metaCard = I(content, { type: 'frame', name: 'draft meta card', width: 'fill_container', layout: 'vertical', gap: 6, padding: 14, cornerRadius: 12, fill: s(m.subtle) });
  const metaRow = I(metaCard, { type: 'frame', name: 'draft source', layout: 'horizontal', gap: 8, alignItems: 'center' });
  I(metaRow, { type: 'icon_font', name: 'icon / mail', iconFontName: 'mail', width: 16, height: 16, fill: s(m.text2) });
  I(metaRow, { type: 'text', content: '来自账单邮件 · 10月27日解析', fontFamily: FONT, fontSize: 12, fill: s(m.text2) });
  const conf = I(metaCard, { type: 'frame', name: 'draft confidence', layout: 'horizontal', gap: 6, alignItems: 'center' });
  I(conf, { type: 'text', content: '解析置信度', fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
  pill(conf, m, '高', 'ok', 'sparkles');

  sectionTitle(content, m, '草稿字段', '确认前可修改');
  const fieldsCard = I(content, { type: 'frame', name: 'fields card', width: 'fill_container', layout: 'vertical', padding: [4, 14], cornerRadius: 12, fill: s(m.surface) });
  fieldRow(fieldsCard, m, { key: 'draft-card', label: '绑定信用卡', value: '招商银行 · 标准信用卡', arrow: true });
  fieldRow(fieldsCard, m, { key: 'draft-month', label: '账单月份', value: '2026-10', arrow: true });
  fieldRow(fieldsCard, m, { key: 'draft-amount', label: '账单金额', value: '4,860.50', big: true, arrow: true });
  fieldRow(fieldsCard, m, { key: 'draft-min', label: '最低还款额', value: '486.05', arrow: true });
  fieldRow(fieldsCard, m, { key: 'draft-due', label: '还款到期日', value: '11月24日', arrow: true });
  fieldRow(fieldsCard, m, { key: 'draft-statement', label: '账单日', value: '10月26日', arrow: true });

  const note = I(content, { type: 'frame', name: 'draft note', width: 'fill_container', layout: 'horizontal', gap: 6, alignItems: 'center', padding: [8, 12], cornerRadius: 10, fill: s(m.subtle) });
  I(note, { type: 'icon_font', name: 'icon / info', iconFontName: 'info', width: 13, height: 13, fill: s(m.text2) });
  I(note, { type: 'text', content: '确认时若该卡当月已有账单会拒绝；解析出的明细暂不入库', fontFamily: FONT, fontSize: 11, fill: s(m.text2), textGrowth: 'fixed-width' });

  actionBar(f, m, { key: 'confirm draft', label: '确认入账' }, { key: 'discard draft', label: '丢弃' });
  return f;
};

// =====================================================================
// 10) bill-editing-sheet — 账单操作面板（编辑入口聚合）
// =====================================================================
const drawActionSheet = (mode) => {
  const { f, m, scene } = sceneBoard('bill-editing-sheet', mode);
  dimmedBackdrop(scene, m, '账单详情', '¥ 4,720.00', '招商银行 · 十月账期 · 11/24 到期');

  const sheet = I(scene, {
    type: 'frame', name: 'action sheet', x: 0, y: SCENE_H - 400, width: W, height: 400,
    layout: 'vertical', gap: 0, padding: [16, PAD], cornerRadius: [18, 18, 0, 0], fill: s(m.surface),
  });
  I(sheet, { type: 'frame', name: 'grabber', width: 36, height: 4, cornerRadius: 999, fill: s(m.border), layout: 'none' });
  const sheetTitle = I(sheet, { type: 'frame', name: 'sheet header', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [8, 0] });
  I(sheetTitle, { type: 'text', name: 'sheet title', content: '账单操作', fontFamily: FONT, fontSize: 16, fontWeight: 700, fill: s(m.text) });
  const sub = I(sheetTitle, { type: 'frame', name: 'bill identity', layout: 'horizontal', gap: 6, alignItems: 'center' });
  I(sub, { type: 'text', content: '招商银行 · 十月账期', fontFamily: FONT, fontSize: 12, fill: s(m.text2) });

  const items = [
    ['编辑金额与日期', '写入手动钉住值，不被邮件覆盖', 'pencil', 'accent'],
    ['修改账单状态', '按还款记录重算后落库', 'circle-half-2', 'accent'],
    ['还款记录管理', '修改或删除已登记的还款', 'receipt', 'accent'],
    ['金额来源历史', '导入值与手动值的变动记录', 'history', 'accent'],
    ['删除账单', '连同还款记录一并删除，不可恢复', 'trash-2', 'danger'],
  ];
  const listWrap = I(sheet, { type: 'frame', name: 'action list', width: 'fill_container', layout: 'vertical' });
  for (const [label, desc, iconName, kind] of items) {
    const row = I(listWrap, {
      type: 'frame', name: 'action / ' + label, width: 'fill_container', layout: 'horizontal',
      gap: 12, alignItems: 'center', padding: [12, 0],
    });
    const ic = I(row, { type: 'frame', name: 'action icon', width: 36, height: 36, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(kind === 'danger' ? m.dangerSoft : m.subtle) });
    I(ic, { type: 'icon_font', name: 'icon / ' + iconName, iconFontName: iconName, width: 17, height: 17, fill: s(kind === 'danger' ? m.dangerInk : m.text) });
    const col = I(row, { type: 'frame', name: 'action text', layout: 'vertical', gap: 2 });
    I(col, { type: 'text', content: label, fontFamily: FONT, fontSize: 14.5, fontWeight: 600, fill: s(kind === 'danger' ? m.dangerInk : m.text) });
    I(col, { type: 'text', content: desc, fontFamily: FONT, fontSize: 11, fill: s(m.text2) });
    I(row, { type: 'frame', name: 'spacer', width: 'fill_container', height: 1 });
    I(row, { type: 'icon_font', name: 'icon / chevron-right', iconFontName: 'chevron-right', width: 16, height: 16, fill: s(m.text2) });
  }
  return f;
};

// ---------- 组装（dark 在前，light 在后，与 15 页排列一致） ----------

const boards = [];
for (const mode of ['dark', 'light']) {
  boards.push(
    drawEditForm(mode),
    drawAmountDialog(mode),
    drawOverrideWarning(mode),
    drawStatusDialog(mode),
    drawPayments(mode),
    drawPaymentEdit(mode),
    drawDeleteConfirm(mode),
    drawHistory(mode),
    drawDraft(mode),
    drawActionSheet(mode),
  );
}
// 摘要走 stderr，避免混入 op design 的 JSON 输出。
console.error('bill editing set built: ' + boards.length + ' boards (dark/light × 10)');
