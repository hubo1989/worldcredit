// 11 · Mobile Details — screen.mobile.bill-detail / screen.mobile.card-detail / screen.mobile.analytics
// 运行: op design @design/openpencil/scripts/11-mobile-details.js
//
// ⚠️ 按真实基线重画（baseline/dom/{bill-detail,card-detail,analytics}/default.json）。
// bill-detail 是新的主详情母版；card-detail 保留为卡片维度详情。

const s = (c) => [{ type: 'solid', color: c }];
const C = {
  canvas: '$color.bg.canvas', surface: '$color.bg.surface', subtle: '$color.bg.subtle',
  navy: '$color.brand.navy800', navy600: '$color.brand.navy600', blue400: '$color.brand.blue400',
  gold: '$color.brand.gold500', gold700: '$color.brand.gold700',
  primary: '$color.runtime.primary', primaryDark: '$color.runtime.primaryDark',
  border: '$color.border.default', text: '$color.text.primary', text2: '$color.text.secondary', onDark: '$color.text.onDark',
  success: '$color.status.success', warning: '$color.status.warning', danger: '$color.status.danger', info: '$color.status.info',
};
const SB_H = 48, NAV_H = 90, NAV_CONTENT_H = 56, SAFE_H = 34, PAD = 20, W = 390, H = 844;

const statusBar = (p, w) => {
  const sb = I(p, { type: 'frame', name: 'status bar', x: 0, y: 0, width: w, height: SB_H, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, PAD] });
  I(sb, { type: 'text', content: '9:41', fontSize: 13, fontWeight: 600, fill: s(C.text) });
  const r = I(sb, { type: 'frame', name: 'trailing', layout: 'horizontal', gap: 6, alignItems: 'center' });
  for (const i of ['signal', 'wifi', 'battery-full']) I(r, { type: 'icon_font', iconFontName: i, width: 15, height: 15, fill: s(C.text) });
};
const navBar = (p, w, title, rightIcon) => {
  const n = I(p, { type: 'frame', name: 'nav bar', x: 0, y: SB_H, width: w, height: 56, layout: 'horizontal', alignItems: 'center', justifyContent: 'space_between', padding: [0, PAD] });
  const l = I(n, { type: 'frame', name: 'left', layout: 'horizontal', gap: 8, alignItems: 'center' });
  const back = I(l, { type: 'frame', name: 'back btn', width: 36, height: 36, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(C.navy) });
  I(back, { type: 'icon_font', iconFontName: 'chevron-left', width: 20, height: 20, fill: s(C.onDark) });
  I(l, { type: 'text', content: title, fontSize: 17, fontWeight: 700, fill: s(C.navy), textGrowth: 'fixed-width' });
  if (rightIcon) I(n, { type: 'icon_font', iconFontName: rightIcon, width: 20, height: 20, fill: s(C.navy) });
};
const bottomNav = (p, w, h, active) => {
  const nav = I(p, { type: 'frame', name: 'bottom nav', x: 0, y: h - NAV_H, width: w, height: NAV_H, layout: 'horizontal', justifyContent: 'space_around', alignItems: 'center', fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  const tabs = I(nav, { type: 'frame', name: 'nav tabs', width: 'fill_container', height: NAV_CONTENT_H, layout: 'horizontal', justifyContent: 'space_around', alignItems: 'center' });
  for (const [icon, label] of [['home', '首页'], ['receipt', '账单'], ['user', '我的']]) {
    const a = label === active;
    const t = I(tabs, { type: 'frame', name: 'tab / ' + label, layout: 'vertical', gap: 4, alignItems: 'center', padding: [8, 16] });
    if (a) I(t, { type: 'rectangle', width: 20, height: 2, cornerRadius: 999, fill: s(C.gold) });
    I(t, { type: 'icon_font', iconFontName: icon, width: 22, height: 22, fill: s(a ? C.navy : C.text2) });
    I(t, { type: 'text', content: label, fontSize: 11, fontWeight: a ? 700 : 400, fill: s(a ? C.navy : C.text2) });
  }
  I(nav, { type: 'rectangle', name: 'safe area', width: 'fill_container', height: SAFE_H, fill: s(C.surface) });
};
const statusPill = (parent, label) => {
  // 淡底 + ink 档（B0 决策 1），soft 底为 color-mix 等价字面值。
  const map = { '待还': { bg: '$color.status.infoSoft', fg: '$color.status.infoInk' }, '逾期': { bg: '$color.status.dangerSoft', fg: '$color.status.dangerInk' }, '部分还款': { bg: '$color.status.warningSoft', fg: '$color.status.warningInk' }, '已还': { bg: '$color.status.successSoft', fg: '$color.status.successInk' } };
  const st = map[label] || { bg: '#E5E7EB', fg: C.text2 };
  const el = I(parent, { type: 'frame', name: 'status / ' + label, layout: 'horizontal', padding: [3, 10], cornerRadius: 999, fill: s(st.bg) });
  I(el, { type: 'text', content: label, fontSize: 11, fontWeight: 700, fill: s(st.fg) });
};
const card = (parent, name, gap) => I(parent, { type: 'frame', name, width: 'fill_container', layout: 'vertical', gap: gap || 12, padding: [16, 16], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });

// ============================================================
// screen.mobile.bill-detail（真实基线的主详情形态）
// 标题栏 → 卡头(卡名/银行/持卡人/尾号/状态) → 四格金额(应还/最低/已还/剩余)
// → 账单周期 → 日期信息(账单日/还款日/免息 N 天) → 数据来源 → 还款记录空态
// → 底部操作(去还款 / 查看卡片详情)
// ============================================================
const billDetail = () => {
  const p = I(null, { type: 'frame', name: 'screen.mobile.bill-detail · 390×844', width: W, height: H, layout: 'none', clipContent: true, fill: s(C.canvas) });
  statusBar(p, W);
  navBar(p, W, '账单详情');

  // content 高度必须减去底部导航（NAV_H）与 sticky cta（72），否则会与 cta 重叠，
  // 导致最后一段内容被按钮遮住。便携版几何检查首次发现该缺陷。
  const c = I(p, { type: 'frame', name: 'content', x: 0, y: SB_H + 56, width: W, height: H - SB_H - 56 - 72 - NAV_H, layout: 'vertical', gap: 14, padding: [0, PAD], clipContent: true, fill: s(C.canvas) });

  // 卡头
  const head = I(c, { type: 'frame', name: 'card header', width: 'fill_container', layout: 'vertical', gap: 6, padding: [16, 16], cornerRadius: 12, fill: s(C.navy) });
  const hTop = I(head, { type: 'frame', name: 'head top', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'start' });
  const hLeft = I(hTop, { type: 'frame', name: 'left', layout: 'vertical', gap: 3 });
  I(hLeft, { type: 'text', content: '标准白金卡', fontSize: 17, fontWeight: 700, fill: s(C.onDark), textGrowth: 'fixed-width' });
  I(hLeft, { type: 'text', content: '交通银行', fontSize: 11, fill: s(C.blue400), textGrowth: 'fixed-width' });
  const hRight = I(hTop, { type: 'frame', name: 'right', layout: 'vertical', gap: 6, alignItems: 'end' });
  statusPill(hRight, '待还');
  const hMeta = I(head, { type: 'frame', name: 'meta', width: 'fill_container', layout: 'horizontal', gap: 12, alignItems: 'center' });
  I(hMeta, { type: 'text', content: '呼博', fontSize: 11, fill: s(C.blue400), textGrowth: 'fixed-width' });
  I(hMeta, { type: 'text', content: '尾号 9004', fontSize: 11, fill: s(C.blue400), textGrowth: 'fixed-width' });

  // 四格金额
  const grid = card(c, 'amount grid', 12);
  const gTop = I(grid, { type: 'frame', name: 'primary amount', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'end' });
  const gLeft = I(gTop, { type: 'frame', name: 'left', layout: 'vertical', gap: 2 });
  I(gLeft, { type: 'text', content: '应还', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(gLeft, { type: 'text', content: '¥8,000', fontSize: 26, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(C.navy), textGrowth: 'fixed-width' });
  const r1 = I(grid, { type: 'frame', name: 'grid row 1', width: 'fill_container', layout: 'horizontal', gap: 12 });
  for (const [label, value] of [['最低', '¥1,200'], ['已还', '¥0']]) {
    const kv = I(r1, { type: 'frame', name: 'kv / ' + label, width: 'fill_container', layout: 'vertical', gap: 3 });
    I(kv, { type: 'text', content: label, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
    I(kv, { type: 'text', content: value, fontSize: 15, fontWeight: 600, fontFamily: '$font.family.amount', fill: s(C.text), textGrowth: 'fixed-width' });
  }
  I(grid, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(C.border) });
  const r2 = I(grid, { type: 'frame', name: 'grid row 2', width: 'fill_container', layout: 'horizontal', gap: 12 });
  for (const [label, value, color] of [['剩余', '¥8,000', C.danger]]) {
    const kv = I(r2, { type: 'frame', name: 'kv / ' + label, width: 'fill_container', layout: 'vertical', gap: 3 });
    I(kv, { type: 'text', content: label, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
    I(kv, { type: 'text', content: value, fontSize: 15, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(color), textGrowth: 'fixed-width' });
  }

  // 账单周期
  const cycle = card(c, 'bill cycle', 6);
  I(cycle, { type: 'text', content: '账单周期', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(cycle, { type: 'text', content: '账单周期 8/6 – 9/5 · 尾号 9004', fontSize: 13, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });

  // 日期信息
  const dates = card(c, 'date info', 10);
  I(dates, { type: 'text', content: '日期信息', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  for (const [label, value] of [['账单日', '每月 5 日'], ['还款日', '每月 25 日'], ['免息', '50 天']]) {
    const r = I(dates, { type: 'frame', name: 'row / ' + label, width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
    I(r, { type: 'text', content: label, fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
    I(r, { type: 'text', content: value, fontSize: 12, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  }

  // 数据来源
  const src = I(c, { type: 'frame', name: 'source', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [12, 16], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  I(src, { type: 'text', content: '数据来源', fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
  const srcBadge = I(src, { type: 'frame', name: 'source badge', layout: 'horizontal', padding: [3, 10], cornerRadius: 999, fill: '$color.bg.skeleton' });
  I(srcBadge, { type: 'text', content: '手动', fontSize: 11, fontWeight: 700, fill: s(C.navy) });

  // 还款记录空态
  const pay = card(c, 'payments', 10);
  I(pay, { type: 'text', content: '还款记录', fontSize: 13, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
  const empty = I(pay, { type: 'frame', name: 'payments empty', width: 'fill_container', layout: 'vertical', gap: 6, alignItems: 'center', padding: [16, 0] });
  I(empty, { type: 'icon_font', iconFontName: 'wallet', width: 24, height: 24, fill: s(C.text2) });
  I(empty, { type: 'text', content: '尚未还款', fontSize: 13, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  I(empty, { type: 'text', content: '点击下方「去还款」登记第一笔还款', fontSize: 11, fill: s(C.text2), textAlign: 'center', textGrowth: 'fixed-width' });

  // 底部操作
  const cta = I(p, { type: 'frame', name: 'sticky cta', x: 0, y: H - NAV_H - 72, width: W, height: 72, layout: 'horizontal', gap: 12, alignItems: 'center', padding: [12, PAD], fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  const primary = I(cta, { type: 'frame', name: 'btn / 去还款', width: 'fill_container', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 8, fill: s(C.primary) });
  I(primary, { type: 'text', content: '去还款', fontSize: 14, fontWeight: 600, fill: s(C.onDark) });
  const ghost = I(cta, { type: 'frame', name: 'btn / 查看卡片详情', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', padding: [0, 14], cornerRadius: 8, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  I(ghost, { type: 'text', content: '查看卡片详情', fontSize: 13, fontWeight: 600, fill: s(C.primaryDark) });

  bottomNav(p, W, H, '账单');
};

// ============================================================
// screen.mobile.card-detail（卡片维度详情，保留原形态但按真实字段校正）
// ============================================================
const cardDetail = () => {
  const p = I(null, { type: 'frame', name: 'screen.mobile.card-detail · 390×844', width: W, height: H, layout: 'none', clipContent: true, fill: s(C.canvas) });
  statusBar(p, W);
  navBar(p, W, '卡片详情', 'pencil');
  const c = I(p, { type: 'frame', name: 'content', x: 0, y: SB_H + 56, width: W, height: H - SB_H - 56 - NAV_H, layout: 'vertical', gap: 14, padding: [0, PAD], clipContent: true, fill: s(C.canvas) });

  // 卡面（真实：银行 / 卡名 / 持卡人 / 卡片类型）
  const face = I(c, { type: 'frame', name: 'card visual', width: 'fill_container', height: 170, layout: 'vertical', justifyContent: 'space_between', padding: [20, 20], cornerRadius: 16, fill: s(C.navy) });
  const fTop = I(face, { type: 'frame', name: 'top', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'start' });
  const fL = I(fTop, { type: 'frame', name: 'bank', layout: 'vertical', gap: 4 });
  I(fL, { type: 'text', content: '中国银行', fontSize: 12, fill: s(C.blue400), textGrowth: 'fixed-width' });
  I(fL, { type: 'text', content: '中国银行 普卡', fontSize: 16, fontWeight: 700, fill: s(C.onDark), textGrowth: 'fixed-width' });
  I(fTop, { type: 'icon_font', iconFontName: 'credit-card', width: 26, height: 26, fill: s(C.gold) });
  const fB = I(face, { type: 'frame', name: 'bottom', width: 'fill_container', layout: 'vertical', gap: 6 });
  I(fB, { type: 'text', content: '•••• •••• •••• 4810', fontSize: 17, fontWeight: 600, fontFamily: '$font.family.mono', fill: s(C.onDark), textGrowth: 'fixed-width' });
  I(fB, { type: 'text', content: '呼博 · 信用卡', fontSize: 11, fill: s(C.blue400), textGrowth: 'fixed-width' });

  // 额度三格
  const limit = card(c, 'limit', 12);
  const lRow = I(limit, { type: 'frame', name: 'limit row', width: 'fill_container', layout: 'horizontal', gap: 12 });
  for (const [label, value, color] of [['总额度', '¥0', C.text], ['已用', '¥0', C.text], ['可用', '¥0', C.success]]) {
    const kv = I(lRow, { type: 'frame', name: 'kv / ' + label, width: 'fill_container', layout: 'vertical', gap: 3 });
    I(kv, { type: 'text', content: label, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
    I(kv, { type: 'text', content: value, fontSize: 16, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(color), textGrowth: 'fixed-width' });
  }

  // 日期与费用（真实字段：账单日/还款日/最长免息/年费/币种）
  const head = I(c, { type: 'frame', name: 'date section header', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  I(head, { type: 'text', content: '日期与费用', fontSize: 15, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
  I(head, { type: 'icon_font', iconFontName: 'pencil', width: 16, height: 16, fill: s(C.text2) });
  const dates = card(c, 'date info', 10);
  for (const [label, value] of [['账单日', '每月 10 日'], ['还款日', '账单日后 20 天'], ['最长免息', '—'], ['年费', '¥0'], ['币种', 'CNY']]) {
    const r = I(dates, { type: 'frame', name: 'row / ' + label, width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
    I(r, { type: 'text', content: label, fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
    I(r, { type: 'text', content: value, fontSize: 12, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  }

  // 最近账单空态
  I(c, { type: 'text', content: '最近账单', fontSize: 15, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
  const recent = card(c, 'recent bills', 8);
  const emptyBox = I(recent, { type: 'frame', name: 'empty', width: 'fill_container', layout: 'vertical', gap: 6, alignItems: 'center', padding: [20, 0] });
  const circle = I(emptyBox, { type: 'frame', name: 'icon circle', width: 56, height: 56, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: '$color.bg.skeleton' });
  I(circle, { type: 'icon_font', iconFontName: 'home', width: 26, height: 26, fill: s(C.navy) });
  I(emptyBox, { type: 'text', content: '暂无账单', fontSize: 14, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  I(emptyBox, { type: 'text', content: '这张卡还没有录入账单', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });

  bottomNav(p, W, H, '账单');
};

// ============================================================
// screen.mobile.analytics（真实：时间范围 + 持卡人筛选 + 风险提示 + 4 指标 + 趋势 + 分类）
// ============================================================
const analytics = () => {
  const p = I(null, { type: 'frame', name: 'screen.mobile.analytics · 390×844', width: W, height: H, layout: 'none', clipContent: true, fill: s(C.canvas) });
  statusBar(p, W);
  navBar(p, W, '消费与负债分析');
  const c = I(p, { type: 'frame', name: 'content', x: 0, y: SB_H + 56, width: W, height: H - SB_H - 56 - NAV_H, layout: 'vertical', gap: 14, padding: [0, PAD], clipContent: true, fill: s(C.canvas) });

  // 两个筛选条：时间范围 / 持卡人
  for (const [label, value] of [['时间范围', '近 6 个月'], ['持卡人', '全部 持卡人']]) {
    const bar = I(c, { type: 'frame', name: 'filter / ' + label, width: 'fill_container', height: 40, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, 14], cornerRadius: 10, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
    I(bar, { type: 'text', content: label, fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
    const v = I(bar, { type: 'frame', name: 'value', layout: 'horizontal', gap: 6, alignItems: 'center' });
    I(v, { type: 'text', content: value, fontSize: 12, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
    I(v, { type: 'icon_font', iconFontName: 'chevron-down', width: 14, height: 14, fill: s(C.text2) });
  }

  // 风险提示
  const risk = I(c, { type: 'frame', name: 'risk notice', width: 'fill_container', layout: 'horizontal', gap: 10, alignItems: 'start', padding: [12, 14], cornerRadius: 10, fill: '$color.status.warningSoft', stroke: { thickness: 1, fill: s(C.gold) } });
  I(risk, { type: 'icon_font', iconFontName: 'alert-triangle', width: 18, height: 18, fill: s(C.gold700) });
  const rTxt = I(risk, { type: 'frame', name: 'text', width: 'fill_container', layout: 'vertical', gap: 3 });
  I(rTxt, { type: 'text', content: '风险提示', fontSize: 12, fontWeight: 700, fill: s(C.text), textGrowth: 'fixed-width' });
  I(rTxt, { type: 'text', content: '有 1 笔逾期账单 · 上月消费激增', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(c, { type: 'text', content: '金额已折算为 CNY', fontSize: 10, fill: s(C.text2), textGrowth: 'fixed-width' });

  // 4 指标
  const kpis = card(c, 'kpis', 12);
  const k1 = I(kpis, { type: 'frame', name: 'kpi row 1', width: 'fill_container', layout: 'horizontal', gap: 12 });
  for (const [label, value] of [['账单总额', '¥69,104.23'], ['待还金额', '¥69,104.23']]) {
    const kv = I(k1, { type: 'frame', name: 'kpi / ' + label, width: 'fill_container', layout: 'vertical', gap: 3 });
    I(kv, { type: 'text', content: label, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
    I(kv, { type: 'text', content: value, fontSize: 16, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(C.navy), textGrowth: 'fixed-width' });
  }
  I(kpis, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(C.border) });
  const k2 = I(kpis, { type: 'frame', name: 'kpi row 2', width: 'fill_container', layout: 'horizontal', gap: 12 });
  for (const [label, value, color] of [['已还金额', '¥21,791.87', C.success], ['额度使用率', '7.8%', C.text]]) {
    const kv = I(k2, { type: 'frame', name: 'kpi / ' + label, width: 'fill_container', layout: 'vertical', gap: 3 });
    I(kv, { type: 'text', content: label, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
    I(kv, { type: 'text', content: value, fontSize: 16, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(color), textGrowth: 'fixed-width' });
  }

  // 月度趋势
  I(c, { type: 'text', content: '月度账单趋势', fontSize: 15, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
  const trend = card(c, 'trend', 14);
  const legend = I(trend, { type: 'frame', name: 'legend', width: 'fill_container', layout: 'horizontal', gap: 14, alignItems: 'center' });
  for (const [label, color] of [['已还金额', C.navy], ['账单金额', C.blue400]]) {
    const lg = I(legend, { type: 'frame', name: 'legend / ' + label, layout: 'horizontal', gap: 5, alignItems: 'center' });
    I(lg, { type: 'rectangle', width: 10, height: 10, cornerRadius: 3, fill: s(color) });
    I(lg, { type: 'text', content: label, fontSize: 10, fill: s(C.text2), textGrowth: 'fixed-width' });
  }
  const bars = I(trend, { type: 'frame', name: 'bars', width: 'fill_container', height: 150, layout: 'horizontal', gap: 24, alignItems: 'end', justifyContent: 'center' });
  for (const [label, h1, h2] of [['2026-08', 0, 0], ['2026-09', 100, 42]]) {
    const col = I(bars, { type: 'frame', name: 'col / ' + label, width: 'fill_container', layout: 'vertical', gap: 6, alignItems: 'center', justifyContent: 'end' });
    const pair = I(col, { type: 'frame', name: 'pair', layout: 'horizontal', gap: 5, alignItems: 'end' });
    I(pair, { type: 'frame', name: 'bill bar', width: 26, height: Math.max(4, h1), cornerRadius: 4, fill: s(C.blue400) });
    I(pair, { type: 'frame', name: 'paid bar', width: 26, height: Math.max(4, h2), cornerRadius: 4, fill: s(C.navy) });
    I(col, { type: 'text', content: label, fontSize: 10, fill: s(C.text2) });
  }

  // 分类详情
  I(c, { type: 'text', content: '分类详情', fontSize: 15, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
  const cats = card(c, 'categories', 10);
  for (const [label, amount, pct, color] of [['购物', '¥18,420.00', '27%', C.navy], ['旅行', '¥16,800.00', '24%', C.primary], ['餐饮', '¥9,640.00', '14%', C.info], ['其他', '¥24,244.23', '35%', C.blue400]]) {
    const row = I(cats, { type: 'frame', name: 'cat / ' + label, width: 'fill_container', layout: 'vertical', gap: 6 });
    const top = I(row, { type: 'frame', name: 'top', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
    const l = I(top, { type: 'frame', name: 'left', layout: 'horizontal', gap: 8, alignItems: 'center' });
    I(l, { type: 'rectangle', width: 8, height: 8, cornerRadius: 999, fill: s(color) });
    I(l, { type: 'text', content: label, fontSize: 12, fill: s(C.text), textGrowth: 'fixed-width' });
    const r = I(top, { type: 'frame', name: 'right', layout: 'horizontal', gap: 10, alignItems: 'center' });
    I(r, { type: 'text', content: amount, fontSize: 12, fontWeight: 600, fontFamily: '$font.family.amount', fill: s(C.text), textGrowth: 'fixed-width' });
    I(r, { type: 'text', content: pct, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  }

  bottomNav(p, W, H, '我的');
};

billDetail();
cardDetail();
analytics();
console.log('mobile details rebuilt from baseline');
