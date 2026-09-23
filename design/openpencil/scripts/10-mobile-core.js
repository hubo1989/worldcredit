// 10 · Mobile Core — 屏母版: screen.mobile.dashboard / screen.mobile.bills
// 运行: op design @design/openpencil/scripts/10-mobile-core.js
//
// ⚠️ 本脚本按真实基线重画（design/openpencil/baseline/dom/*/default.json）。
// 结构与字段以线上为准，不再是推演稿。重画依据见 DESIGN.md 的「基线对齐」一节。
//
// shell 模型: 顶层 frame layout:none；status bar / content / bottom nav 绝对定位，
// 保证底部导航固定在视口内，与真实实现一致。

const s = (c) => [{ type: 'solid', color: c }];
const C = {
  canvas: '$color.bg.canvas', surface: '$color.bg.surface', subtle: '$color.bg.subtle',
  navy: '$color.brand.navy800', navy600: '$color.brand.navy600', blue400: '$color.brand.blue400',
  gold: '$color.brand.gold500', gold700: '$color.brand.gold700',
  primary: '$color.runtime.primary', primaryDark: '$color.runtime.primaryDark',
  border: '$color.border.default', text: '$color.text.primary', text2: '$color.text.secondary', onDark: '$color.text.onDark',
  success: '$color.status.success', warning: '$color.status.warning', danger: '$color.status.danger', info: '$color.status.info',
};
const SB_H = 48, NAV_H = 64, PAD = 20;

const statusBar = (parent, w) => {
  const sb = I(parent, { type: 'frame', name: 'status bar', x: 0, y: 0, width: w, height: SB_H, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, PAD] });
  I(sb, { type: 'text', content: '9:41', fontSize: 13, fontWeight: 600, fill: s(C.text) });
  const r = I(sb, { type: 'frame', name: 'trailing', layout: 'horizontal', gap: 6, alignItems: 'center' });
  for (const i of ['signal', 'wifi', 'battery-full']) I(r, { type: 'icon_font', iconFontName: i, width: 15, height: 15, fill: s(C.text) });
  return sb;
};

const bottomNav = (parent, w, h, active) => {
  const nav = I(parent, {
    type: 'frame', name: 'bottom nav', x: 0, y: h - NAV_H, width: w, height: NAV_H,
    layout: 'horizontal', justifyContent: 'space_around', alignItems: 'center',
    fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) },
  });
  for (const [icon, label] of [['home', '首页'], ['receipt', '账单'], ['user', '我的']]) {
    const isActive = label === active;
    const tab = I(nav, { type: 'frame', name: 'tab / ' + label, layout: 'vertical', gap: 4, alignItems: 'center', padding: [8, 16] });
    if (isActive) I(tab, { type: 'rectangle', name: 'active indicator', width: 20, height: 2, cornerRadius: 999, fill: s(C.gold) });
    I(tab, { type: 'icon_font', iconFontName: icon, width: 22, height: 22, fill: s(isActive ? C.navy : C.text2) });
    I(tab, { type: 'text', content: label, fontSize: 11, fontWeight: isActive ? 700 : 400, fill: s(isActive ? C.navy : C.text2) });
  }
  return nav;
};

// 状态徽章的语义色：与真实实现一致（逾期红 / 部分还款黄 / 待还款蓝 / 未出账单灰绿）
const statusStyle = (label) => ({
  '逾期': { bg: '#FEE2E2', fg: C.danger },
  '部分还款': { bg: '#FEF3C7', fg: C.gold700 },
  '待还款': { bg: '#DBEAFE', fg: C.primaryDark },
  '未出账单': { bg: '#DCFCE7', fg: '#166534' },
}[label] || { bg: '#E5E7EB', fg: C.text2 });

const statusPill = (parent, label) => {
  const st = statusStyle(label);
  const el = I(parent, { type: 'frame', name: 'status / ' + label, layout: 'horizontal', padding: [3, 10], cornerRadius: 999, fill: s(st.bg) });
  I(el, { type: 'text', content: label, fontSize: 11, fontWeight: 700, fill: s(st.fg) });
  return el;
};

const shell = (name, w, h) => {
  const phone = I(null, { type: 'frame', name, width: w, height: h, layout: 'none', clipContent: true, fill: s(C.canvas) });
  statusBar(phone, w);
  return phone;
};

// ============================================================
// screen.mobile.dashboard
// 真实结构: 概览头 → 持卡人筛选 pills → 总待还款 Hero(含逾期/未来7天)
//          → 2×2 指标(已逾期/未来待还含 7·14·30 天/总欠款可折叠/未出账单)
//          → 账户(计数 + 持卡人 pill) → 金刚区 → 逾期明细 + 账单行
// ============================================================
const dashboard = (w, h) => {
  const phone = shell('screen.mobile.dashboard · ' + w + '×' + h, w, h);

  // 页头：真实实现右侧是用户头像 pill（不是铃铛/设置）
  const header = I(phone, { type: 'frame', name: 'page header', x: 0, y: SB_H, width: w, height: 64, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, PAD] });
  const hl = I(header, { type: 'frame', name: 'heading', layout: 'vertical', gap: 2 });
  I(hl, { type: 'text', content: '概览', fontSize: 20, fontWeight: 700, fill: s(C.navy), textGrowth: 'fixed-width' });
  I(hl, { type: 'text', content: '管控信用卡资产与还款日程', fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
  const avatar = I(header, { type: 'frame', name: 'avatar pill', width: 40, height: 40, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  I(avatar, { type: 'text', content: '呼', fontSize: 15, fontWeight: 700, fill: s(C.navy) });

  const content = I(phone, {
    type: 'frame', name: 'content', x: 0, y: SB_H + 64, width: w, height: h - SB_H - 64 - NAV_H,
    layout: 'vertical', gap: 16, padding: [0, PAD], clipContent: true, fill: s(C.canvas),
  });

  // 持卡人筛选 pills（真实：全部 / 呼）
  const filters = I(content, { type: 'frame', name: 'holder filters', width: 'fill_container', layout: 'horizontal', gap: 8, alignItems: 'center' });
  for (const [label, active] of [['全部', true], ['呼', false]]) {
    const p = I(filters, { type: 'frame', name: 'pill / ' + label, layout: 'horizontal', padding: [7, 18], cornerRadius: 999, fill: s(active ? C.navy : C.surface), stroke: { thickness: 1, fill: s(active ? C.navy : C.border) } });
    I(p, { type: 'text', content: label, fontSize: 13, fontWeight: active ? 600 : 400, fill: s(active ? C.onDark : C.text2) });
  }

  // Hero：总待还款 + 含逾期 / 未来 7 天
  const hero = I(content, { type: 'frame', name: 'hero / total pending', width: 'fill_container', layout: 'vertical', gap: 14, padding: [22, 20], cornerRadius: 14, fill: s(C.navy) });
  I(hero, { type: 'text', content: '总待还款', fontSize: 12, fill: s(C.blue400), textGrowth: 'fixed-width' });
  I(hero, { type: 'text', content: '¥47,317.21', fontSize: 32, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(C.onDark), textGrowth: 'fixed-width' });
  const heroSub = I(hero, { type: 'frame', name: 'hero sub', width: 'fill_container', layout: 'horizontal', gap: 28 });
  for (const [label, value, color] of [['含逾期', '¥7,361.1', '#FF9B9B'], ['未来 7 天', '¥12,804.98', C.gold]]) {
    const kv = I(heroSub, { type: 'frame', name: 'kv / ' + label, layout: 'vertical', gap: 3 });
    I(kv, { type: 'text', content: label, fontSize: 11, fill: s(C.blue400), textGrowth: 'fixed-width' });
    I(kv, { type: 'text', content: value, fontSize: 15, fontWeight: 600, fontFamily: '$font.family.amount', fill: s(color), textGrowth: 'fixed-width' });
  }

  // 2×2 指标
  const metrics = I(content, { type: 'frame', name: 'metrics grid', width: 'fill_container', layout: 'vertical', gap: 12 });
  const mr1 = I(metrics, { type: 'frame', name: 'metrics row 1', width: 'fill_container', layout: 'horizontal', gap: 12 });
  // 已逾期：数字 + 笔数描述
  const overdue = I(mr1, { type: 'frame', name: 'metric / 已逾期', width: 'fill_container', layout: 'vertical', gap: 6, padding: [14, 14], cornerRadius: 12, fill: s(C.subtle), stroke: { thickness: 1, fill: s(C.border) } });
  I(overdue, { type: 'text', content: '已逾期', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(overdue, { type: 'text', content: '¥7,361.1', fontSize: 19, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(C.danger), textGrowth: 'fixed-width' });
  I(overdue, { type: 'text', content: '2 笔待处理', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  // 未来待还：7/14/30 天 tab + 金额 + 说明
  const future = I(mr1, { type: 'frame', name: 'metric / 未来待还', width: 'fill_container', layout: 'vertical', gap: 6, padding: [14, 14], cornerRadius: 12, fill: s(C.subtle), stroke: { thickness: 1, fill: s(C.border) } });
  const fHead = I(future, { type: 'frame', name: 'future head', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  I(fHead, { type: 'text', content: '未来待还', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  const tabs = I(fHead, { type: 'frame', name: 'range tabs', layout: 'horizontal', gap: 4 });
  for (const [label, active] of [['7天', true], ['14天', false], ['30天', false]]) {
    const t = I(tabs, { type: 'frame', name: 'tab / ' + label, layout: 'horizontal', padding: [2, 7], cornerRadius: 999, fill: s(active ? '#FEF3C7' : C.subtle) });
    I(t, { type: 'text', content: label, fontSize: 9, fontWeight: active ? 700 : 400, fill: s(active ? C.gold700 : C.text2) });
  }
  I(future, { type: 'text', content: '¥12,804.98', fontSize: 19, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(C.navy), textGrowth: 'fixed-width' });
  I(future, { type: 'text', content: '7 天内到期合计', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });

  const mr2 = I(metrics, { type: 'frame', name: 'metrics row 2', width: 'fill_container', layout: 'horizontal', gap: 12 });
  // 总欠款：带展开箭头
  const debt = I(mr2, { type: 'frame', name: 'metric / 总欠款', width: 'fill_container', layout: 'vertical', gap: 6, padding: [14, 14], cornerRadius: 12, fill: s(C.subtle), stroke: { thickness: 1, fill: s(C.border) } });
  const dHead = I(debt, { type: 'frame', name: 'debt head', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  I(dHead, { type: 'text', content: '总欠款', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(dHead, { type: 'icon_font', iconFontName: 'chevron-down', width: 16, height: 16, fill: s(C.text2) });
  I(debt, { type: 'text', content: '¥47,317.21', fontSize: 19, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(C.navy), textGrowth: 'fixed-width' });
  // 未出账单：暂无可接入
  const unissued = I(mr2, { type: 'frame', name: 'metric / 未出账单', width: 'fill_container', layout: 'vertical', gap: 6, padding: [14, 14], cornerRadius: 12, fill: s(C.subtle), stroke: { thickness: 1, fill: s(C.border) } });
  I(unissued, { type: 'text', content: '未出账单', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(unissued, { type: 'text', content: '暂无数据', fontSize: 19, fontWeight: 700, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(unissued, { type: 'text', content: '邮件解析待接入', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });

  // 账户区
  const acctHead = I(content, { type: 'frame', name: 'account header', width: 'fill_container', layout: 'horizontal', alignItems: 'center', gap: 10 });
  I(acctHead, { type: 'text', content: '账户', fontSize: 15, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
  const acctPills = I(acctHead, { type: 'frame', name: 'account pills', layout: 'horizontal', gap: 8 });
  for (const [label, active] of [['31 张', true], ['呼博', false]]) {
    const p = I(acctPills, { type: 'frame', name: 'pill / ' + label, layout: 'horizontal', padding: [4, 12], cornerRadius: 999, fill: s(active ? C.navy : C.surface), stroke: { thickness: 1, fill: s(active ? C.navy : C.border) } });
    I(p, { type: 'text', content: label, fontSize: 11, fontWeight: active ? 600 : 400, fill: s(active ? C.onDark : C.text2) });
  }

  // 金刚区：真实为 记一笔 / 优惠 / 权益 / 邮箱账单
  const quick = I(content, { type: 'frame', name: 'quick actions', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', padding: [16, 12], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  for (const [icon, label] of [['pencil', '记一笔'], ['tag', '优惠'], ['award', '权益'], ['mail', '邮箱账单']]) {
    const cell = I(quick, { type: 'frame', name: 'quick / ' + label, layout: 'vertical', gap: 6, alignItems: 'center', padding: [4, 8] });
    const ic = I(cell, { type: 'frame', name: 'icon bg', width: 40, height: 40, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 12, fill: s(C.subtle) });
    I(ic, { type: 'icon_font', iconFontName: icon, width: 20, height: 20, fill: s(C.navy) });
    I(cell, { type: 'text', content: label, fontSize: 11, fill: s(C.text), textGrowth: 'fixed-width' });
  }

  // 逾期明细：标题 + 一键全部还款 + 查看全部
  const overdueHead = I(content, { type: 'frame', name: 'overdue header', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  I(overdueHead, { type: 'text', content: '逾期明细', fontSize: 15, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
  const ohRight = I(overdueHead, { type: 'frame', name: 'actions', layout: 'horizontal', gap: 10, alignItems: 'center' });
  const payAll = I(ohRight, { type: 'frame', name: 'btn / 一键全部还款', layout: 'horizontal', padding: [6, 12], cornerRadius: 999, fill: s(C.danger) });
  I(payAll, { type: 'text', content: '一键全部还款', fontSize: 11, fontWeight: 600, fill: s(C.onDark) });
  I(ohRight, { type: 'text', content: '查看全部', fontSize: 11, fill: s(C.primaryDark), textGrowth: 'fixed-width' });

  // 逾期账单行（真实字段：银行 / 卡名 / 尾号 · 账期 / 状态 / 待还金额 / 全额结清）
  const billRow = I(content, { type: 'frame', name: 'overdue bill row', width: 'fill_container', layout: 'vertical', gap: 10, padding: [14, 14], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) }, effects: [{ type: 'shadow', offsetX: 0, offsetY: 2, blur: 8, spread: 0, color: 'rgba(10,31,68,0.06)' }] });
  const brTop = I(billRow, { type: 'frame', name: 'top', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'start', gap: 12 });
  const brL = I(brTop, { type: 'frame', name: 'left', width: 'fill_container', layout: 'vertical', gap: 3 });
  I(brL, { type: 'text', content: '中国农业银行', fontSize: 14, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  I(brL, { type: 'text', content: '尊然白金信用卡（精粹版）', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  const brMeta = I(brL, { type: 'frame', name: 'meta', layout: 'horizontal', gap: 6, alignItems: 'center' });
  I(brMeta, { type: 'text', content: '尾号 2016', fontSize: 10, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(brMeta, { type: 'text', content: '·', fontSize: 10, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(brMeta, { type: 'text', content: '2026-08', fontSize: 10, fill: s(C.text2), textGrowth: 'fixed-width' });
  statusPill(brTop, '逾期');
  I(billRow, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(C.border) });
  const brBottom = I(billRow, { type: 'frame', name: 'bottom', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  const brAmt = I(brBottom, { type: 'frame', name: 'amount', layout: 'vertical', gap: 2 });
  I(brAmt, { type: 'text', content: '待还金额', fontSize: 10, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(brAmt, { type: 'text', content: '¥3,680.55', fontSize: 17, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(C.danger), textGrowth: 'fixed-width' });
  const settle = I(brBottom, { type: 'frame', name: 'btn / 全额结清', layout: 'horizontal', padding: [8, 16], cornerRadius: 999, fill: s(C.primary) });
  I(settle, { type: 'text', content: '全额结清', fontSize: 12, fontWeight: 600, fill: s(C.onDark) });

  bottomNav(phone, w, h, '首页');
  return phone;
};

// ============================================================
// screen.mobile.bills
// 真实结构: 卡片与账单头(刷新) → 逾期汇总横幅(一键还清) → 筛选条
//          → 固定支出区 → 逐卡账单卡(持卡人/银行/卡名/尾号/状态/金额/日期/折叠)
//          → 未出账单卡(填写金额/下期还款约/今日刷卡免息 N 天)
// ⚠️ 真实实现是「逐卡平铺」，不是按持卡人分蓝色组头。
// ============================================================
const bills = (w, h) => {
  const phone = shell('screen.mobile.bills · ' + w + '×' + h, w, h);

  const header = I(phone, { type: 'frame', name: 'page header', x: 0, y: SB_H, width: w, height: 60, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, PAD] });
  I(header, { type: 'text', content: '卡片与账单', fontSize: 20, fontWeight: 700, fill: s(C.navy), textGrowth: 'fixed-width' });
  const refresh = I(header, { type: 'frame', name: 'btn / refresh', width: 44, height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(C.primary) });
  I(refresh, { type: 'icon_font', iconFontName: 'refresh-cw', width: 20, height: 20, fill: s(C.onDark) });

  const content = I(phone, {
    type: 'frame', name: 'content', x: 0, y: SB_H + 60, width: w, height: h - SB_H - 60 - NAV_H,
    layout: 'vertical', gap: 14, padding: [0, PAD], clipContent: true, fill: s(C.canvas),
  });

  // 逾期汇总横幅：存在 N 笔未结清 + 待还合计 + 一键还清
  const banner = I(content, { type: 'frame', name: 'overdue banner', width: 'fill_container', layout: 'horizontal', gap: 10, alignItems: 'center', padding: [12, 14], cornerRadius: 12, fill: '#FEF2F2', stroke: { thickness: 1, fill: s(C.danger) } });
  I(banner, { type: 'icon_font', iconFontName: 'alert-triangle', width: 18, height: 18, fill: s(C.danger) });
  const bTxt = I(banner, { type: 'frame', name: 'text', width: 'fill_container', layout: 'vertical', gap: 2 });
  I(bTxt, { type: 'text', content: '存在 2 笔历史逾期账单未结清', fontSize: 12, fontWeight: 700, fill: s(C.text), textGrowth: 'fixed-width' });
  I(bTxt, { type: 'text', content: '待还合计：¥7,361.1', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  const payAll = I(banner, { type: 'frame', name: 'btn / 一键还清', layout: 'horizontal', padding: [8, 14], cornerRadius: 999, fill: s(C.danger) });
  I(payAll, { type: 'text', content: '一键还清', fontSize: 12, fontWeight: 600, fill: s(C.onDark) });

  // 筛选条：筛选下拉 + 条件回显
  const filterBar = I(content, { type: 'frame', name: 'filter bar', width: 'fill_container', height: 40, layout: 'horizontal', alignItems: 'center', gap: 10, padding: [0, 14], cornerRadius: 999, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  const fLeft = I(filterBar, { type: 'frame', name: 'filter trigger', layout: 'horizontal', gap: 6, alignItems: 'center' });
  I(fLeft, { type: 'icon_font', iconFontName: 'sliders-horizontal', width: 16, height: 16, fill: s(C.navy) });
  I(fLeft, { type: 'text', content: '筛选', fontSize: 13, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
  I(fLeft, { type: 'icon_font', iconFontName: 'chevron-down', width: 14, height: 14, fill: s(C.text2) });
  I(filterBar, { type: 'rectangle', width: 1, height: 18, fill: s(C.border) });
  I(filterBar, { type: 'text', content: '全部卡片 · 按持卡人 · 全部持卡人 · 逾期优先', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });

  // 固定支出区
  const payHead = I(content, { type: 'frame', name: 'payables header', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  I(payHead, { type: 'text', content: '固定支出', fontSize: 15, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
  const addPay = I(payHead, { type: 'frame', name: 'btn / 添加', layout: 'horizontal', gap: 4, alignItems: 'center' });
  I(addPay, { type: 'icon_font', iconFontName: 'plus', width: 16, height: 16, fill: s(C.navy) });
  I(addPay, { type: 'text', content: '添加', fontSize: 13, fill: s(C.navy), textGrowth: 'fixed-width' });
  const payEmpty = I(content, { type: 'frame', name: 'payables empty', width: 'fill_container', padding: [16, 16], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  I(payEmpty, { type: 'text', content: '还没有固定支出。房租、贷款这类每月固定要付的可以加在这里。', fontSize: 12, fill: s(C.text2), textAlign: 'center', textGrowth: 'fixed-width' });

  // 逐卡账单卡（逾期：含历史明细折叠）
  const billCard = (opts) => {
    const { bank, cardName, tail, status, amountLabel, amount, currency, dueLine, distanceLine, hasHistory, amountEditable, interestFree } = opts;
    const card = I(content, { type: 'frame', name: 'bill card / ' + bank, width: 'fill_container', layout: 'vertical', gap: 10, padding: [14, 14], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) }, effects: [{ type: 'shadow', offsetX: 0, offsetY: 2, blur: 8, spread: 0, color: 'rgba(10,31,68,0.06)' }] });
    // 持卡人 + 状态
    const top = I(card, { type: 'frame', name: 'top', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
    const holder = I(top, { type: 'frame', name: 'holder', layout: 'horizontal', gap: 6, alignItems: 'center' });
    I(holder, { type: 'icon_font', iconFontName: 'user', width: 15, height: 15, fill: s(C.text2) });
    I(holder, { type: 'text', content: '呼博', fontSize: 14, fontWeight: 700, fill: s(C.text), textGrowth: 'fixed-width' });
    if (status) statusPill(top, status);
    // 银行徽章 + 卡名 + 尾号
    const bankRow = I(card, { type: 'frame', name: 'bank row', width: 'fill_container', layout: 'horizontal', gap: 8, alignItems: 'center' });
    const bankBadge = I(bankRow, { type: 'frame', name: 'bank badge', layout: 'horizontal', gap: 4, alignItems: 'center', padding: [3, 8], cornerRadius: 999, fill: '#E8EDF5' });
    I(bankBadge, { type: 'icon_font', iconFontName: 'landmark', width: 12, height: 12, fill: s(C.navy) });
    I(bankBadge, { type: 'text', content: bank, fontSize: 11, fontWeight: 600, fill: s(C.navy), textGrowth: 'fixed-width' });
    I(bankRow, { type: 'text', content: cardName, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
    I(bankRow, { type: 'text', content: '···· ' + tail, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
    // 金额行
    const amtRow = I(card, { type: 'frame', name: 'amount row', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
    const amtLeft = I(amtRow, { type: 'frame', name: 'amount left', layout: 'vertical', gap: 3 });
    I(amtLeft, { type: 'text', content: amountLabel, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
    const amtLine = I(amtLeft, { type: 'frame', name: 'amount line', layout: 'horizontal', gap: 6, alignItems: 'center' });
    I(amtLine, { type: 'text', content: (currency || '¥') + amount, fontSize: 21, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(status === '逾期' ? C.danger : status === '部分还款' ? C.gold700 : C.navy), textGrowth: 'fixed-width' });
    if (amountEditable) I(amtLine, { type: 'text', content: '修改金额', fontSize: 11, fill: s(C.primaryDark), textGrowth: 'fixed-width' });
    if (status && status !== '未出账单') {
      const payBtn = I(amtRow, { type: 'frame', name: 'btn / 登记还款', layout: 'horizontal', padding: [9, 16], cornerRadius: 999, fill: s(C.primary) });
      I(payBtn, { type: 'text', content: '登记还款', fontSize: 12, fontWeight: 600, fill: s(C.onDark) });
    } else if (status === '未出账单') {
      I(amtRow, { type: 'text', content: '填写金额', fontSize: 12, fontWeight: 600, fill: s(C.primaryDark), textGrowth: 'fixed-width' });
    }
    // 日期区
    const dateBox = I(card, { type: 'frame', name: 'date block', width: 'fill_container', layout: 'vertical', gap: 4, padding: [10, 12], cornerRadius: 10, fill: s(C.subtle) });
    I(dateBox, { type: 'text', content: dueLine, fontSize: 11, fill: s(C.text), textGrowth: 'fixed-width' });
    if (distanceLine) {
      const dist = I(dateBox, { type: 'frame', name: 'distance', layout: 'horizontal', gap: 5, alignItems: 'center' });
      I(dist, { type: 'icon_font', iconFontName: status === '逾期' ? 'alert-circle' : 'clock', width: 13, height: 13, fill: s(status === '逾期' ? C.danger : C.text2) });
      I(dist, { type: 'text', content: distanceLine, fontSize: 11, fontWeight: 600, fill: s(status === '逾期' ? C.danger : C.text2), textGrowth: 'fixed-width' });
    }
    if (interestFree) I(dateBox, { type: 'text', content: interestFree, fontSize: 11, fontWeight: 600, fill: s('#166534'), textGrowth: 'fixed-width' });
    // 历史明细折叠
    if (hasHistory) {
      I(card, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(C.border) });
      const hist = I(card, { type: 'frame', name: 'history toggle', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
      const hl = I(hist, { type: 'frame', name: 'label', layout: 'horizontal', gap: 6, alignItems: 'center' });
      I(hl, { type: 'icon_font', iconFontName: 'history', width: 14, height: 14, fill: s(C.text2) });
      I(hl, { type: 'text', content: '历史账单明细 (1 期)', fontSize: 12, fill: s(C.text), textGrowth: 'fixed-width' });
      I(hist, { type: 'icon_font', iconFontName: 'chevron-down', width: 16, height: 16, fill: s(C.text2) });
    }
    return card;
  };

  // ① 逾期：中国农业银行（有历史明细）
  billCard({ bank: '中国农业银行', cardName: '尊然白金信用卡（精粹版）', tail: '2016', status: '逾期', amountLabel: '当前待还金额', amount: '3,680.55', dueLine: '账单日 每月 29 日 · 本期还款日 09-08', distanceLine: '逾期 14 日', hasHistory: true });
  // ② 逾期：中国建设银行
  billCard({ bank: '中国建设银行', cardName: '龙卡全球支付', tail: '9003', status: '逾期', amountLabel: '当前待还金额', amount: '3,680.55', dueLine: '账单日 每月 20 日 · 本期还款日 09-08', distanceLine: '逾期 14 日', hasHistory: true });
  // ③ 部分还款：汇丰银行（HKD，多币种分支）
  billCard({ bank: '汇丰银行', cardName: 'Visa Signature', tail: '9002', status: '部分还款', amountLabel: '当前待还金额', amount: '15,000', currency: 'HK$', dueLine: '账单日 每月 12 日 · 本期还款日 09-28', distanceLine: '距离还款日 6 日', hasHistory: true });
  // ④ 待还款：American Express（USD，多币种分支）
  billCard({ bank: 'American Express', cardName: 'Platinum Card', tail: '9001', status: '待还款', amountLabel: '当前待还金额', amount: '2,860', currency: 'US$', dueLine: '账单日 每月 8 日 · 本期还款日 10-10', distanceLine: '距离还款日 18 日', hasHistory: true });
  // ⑤ 待还款 + 手动改过金额：交通银行
  billCard({ bank: '交通银行', cardName: '标准白金卡', tail: '9004', status: '待还款', amountLabel: '当前待还金额', amount: '8,000', dueLine: '账单日 每月 5 日 · 本期还款日 11-06', distanceLine: '距离还款日 45 日', hasHistory: true, amountEditable: true });
  // ⑥ 未出账单：中国邮政储蓄银行
  billCard({ bank: '中国邮政储蓄银行', cardName: '普卡', tail: '3293', status: '未出账单', amountLabel: '本期待还', amount: '0', dueLine: '账单日 每月 22 日 · 下期还款约 10-12', interestFree: '今日刷卡免息 20 天' });

  bottomNav(phone, w, h, '账单');
  return phone;
};

dashboard(390, 844);
dashboard(430, 932);
bills(390, 844);
bills(430, 932);
console.log('mobile core rebuilt from baseline');
