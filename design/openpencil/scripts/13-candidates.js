// 13 · Candidates — 候选稿构建脚本（P0-2 样例试运行）
// 运行: op design @design/openpencil/scripts/13-candidates.js
//
// 约定:
//   - 候选 frame 一律 candidate.* 前缀，与 Current（screen.*）不混名。
//   - 语义契约（_contract.json）按 applyTo 自动覆盖 candidate 角色：
//     字段/动作锚点必须齐全，布局与文案表达可以重排——本样例即验证这一点。
//   - 颜色只走 $token；数值布局属性用字面值（OpenPencil 不接受数字变量）。
//   - 视觉方向（EXECUTION_PLAN 第 1 节）：逾期风险条前置回答「现在有何风险」，
//     hero 改白底 + 品牌色描边（替代 Current 的深蓝大色块），信息架构不变。

const s = (c) => [{ type: 'solid', color: c }];
const C = {
  // 方向 D 暗色探索用字面值（Nickelfox 风格）；批准后正式 token 化并进漂移门禁
  canvas: '#0A0F1E', surface: '#131A2A', subtle: '#1A2334', neutral: '#1A2334',
  navy: '#F5F7FA', navy600: '#5B8DEF', blue400: '#7AADFF',
  gold: '#F0C75E', gold700: '#D9A93F', goldSoft: '#332A14',
  primary: '#5B8DEF', primaryDark: '#7AADFF',
  border: '#26304A', text: '#F5F7FA', text2: '#9AA6BC', onDark: '#FFFFFF',
  success: '#34D399', successInk: '#6EE7A0', successSoft: '#12271C',
  warningInk: '#FFC46B', warningSoft: '#33270F',
  dangerInk: '#FF8A8A', dangerSoft: '#331720', dangerOnDark: '#FF9B9B',
  infoInk: '#7CB8FF', infoSoft: '#122438',
  skeleton: '#1A2334',
};
const SB_H = 48, NAV_H = 90, NAV_CONTENT_H = 56, SAFE_H = 34, PAD = 20;

const statusBar = (parent, w) => {
  const sb = I(parent, { type: 'frame', name: 'status bar', x: 0, y: 0, width: w, height: SB_H, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, PAD] });
  I(sb, { type: 'text', content: '9:41', fontSize: 13, fontWeight: 600, fill: s(C.text) });
  const r = I(sb, { type: 'frame', name: 'trailing', layout: 'horizontal', gap: 6, alignItems: 'center' });
  for (const i of ['signal', 'wifi', 'battery-full']) I(r, { type: 'icon_font', iconFontName: i, width: 15, height: 15, fill: s(C.text) });
};

const bottomNav = (parent, w, h, active) => {
  const nav = I(parent, {
    type: 'frame', name: 'bottom nav', x: 0, y: h - NAV_H, width: w, height: NAV_H,
    layout: 'vertical', fill: s('#10162A'), stroke: { thickness: 1, fill: s('#1C2438') },
  });
  const tabs = I(nav, { type: 'frame', name: 'nav tabs', width: 'fill_container', height: NAV_CONTENT_H, layout: 'horizontal', justifyContent: 'space_around', alignItems: 'center' });
  const center = I(tabs, { type: 'frame', name: 'nav center action', width: 44, height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s('#3B6FE0'), effects: [{ type: 'shadow', offsetX: 0, offsetY: 4, blur: 16, spread: 0, color: 'rgba(59,111,224,0.45)' }] });
  I(center, { type: 'icon_font', iconFontName: 'plus', width: 20, height: 20, fill: s('#FFFFFF') });
  for (const [icon, label] of [['home', '首页'], ['receipt', '账单'], ['user', '我的']]) {
    const isActive = label === active;
    const tab = I(tabs, { type: 'frame', name: 'tab / ' + label, layout: 'vertical', gap: 4, alignItems: 'center', padding: [8, 12] });
    if (isActive) I(tab, { type: 'rectangle', name: 'active indicator', width: 20, height: 2, cornerRadius: 999, fill: s(C.gold) });
    I(tab, { type: 'icon_font', iconFontName: icon, width: 22, height: 22, fill: s(isActive ? C.blue400 : C.text2) });
    I(tab, { type: 'text', content: label, fontSize: 11, fontWeight: isActive ? 700 : 400, fill: s(isActive ? C.blue400 : C.text2) });
  }
  I(nav, { type: 'rectangle', name: 'safe area', width: 'fill_container', height: SAFE_H, fill: s('#10162A') });
  return nav;
};

const statusPill = (parent, label) => {
  const map = {
    '逾期': { bg: C.dangerSoft, fg: C.dangerInk },
    '部分还款': { bg: C.warningSoft, fg: C.warningInk },
    '待还款': { bg: C.infoSoft, fg: C.infoInk },
    '未出账单': { bg: C.successSoft, fg: C.successInk },
  };
  const st = map[label] || { bg: C.neutral, fg: C.text2 };
  const el = I(parent, { type: 'frame', name: 'status / ' + label, layout: 'horizontal', padding: [3, 10], cornerRadius: 999, fill: s(st.bg) });
  I(el, { type: 'text', content: label, fontSize: 11, fontWeight: 700, fill: s(st.fg) });
};

const candidateDashboard = (w, h) => {
  const phone = I(null, { type: 'frame', name: 'candidate.mobile.dashboard · ' + w + '×' + h, width: w, height: h, layout: 'none', clipContent: true, fill: s(C.canvas) });
  statusBar(phone, w);

  // 页头：头像 + 问候 + 隐私开关（44 触控，方向 D 的 gear 位）
  const header = I(phone, { type: 'frame', name: 'page header', x: 0, y: SB_H, width: w, height: 64, layout: 'horizontal', alignItems: 'center', gap: 12, padding: [0, PAD] });
  const avatar = I(header, { type: 'frame', name: 'avatar', width: 40, height: 40, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(C.primary) });
  I(avatar, { type: 'text', content: '呼', fontSize: 15, fontWeight: 700, fill: s('#FFFFFF') });
  const hl = I(header, { type: 'frame', name: 'heading', width: 'fill_container', layout: 'vertical', gap: 2 });
  I(hl, { type: 'text', content: '概览', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(hl, { type: 'text', content: '呼博', fontSize: 15, fontWeight: 700, fill: s(C.text), textGrowth: 'fixed-width' });
  const privacy = I(header, { type: 'frame', name: 'btn / toggle amount visibility', width: 44, height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  I(privacy, { type: 'icon_font', name: 'hide visible amounts', iconFontName: 'eye-off', width: 18, height: 18, fill: s(C.text) });

  const content = I(phone, {
    type: 'frame', name: 'content', x: 0, y: SB_H + 64, width: w, height: h - SB_H - 64 - NAV_H,
    layout: 'vertical', gap: 12, padding: [0, PAD], clipContent: true, fill: s(C.canvas),
  });

  // ① 居中大余额（方向 D 视觉主角）+ 涨跌曲线点缀
  const hero = I(content, { type: 'frame', name: 'hero / total pending', width: 'fill_container', layout: 'vertical', alignItems: 'center', gap: 8 });
  I(hero, { type: 'text', content: '总待还款', fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
  const amountRow = I(hero, { type: 'frame', name: 'amount row', layout: 'horizontal', gap: 14, alignItems: 'center' });
  I(amountRow, { type: 'icon_font', iconFontName: 'chevron-left', width: 16, height: 16, fill: s(C.text2) });
  I(amountRow, { type: 'text', content: '¥47,317.21', fontSize: 34, fontWeight: 700, fontFamily: '$font.family.amount', fill: s('#FFFFFF') });
  I(amountRow, { type: 'icon_font', iconFontName: 'chevron-right', width: 16, height: 16, fill: s(C.text2) });
  const heroSub = I(hero, { type: 'frame', name: 'hero sub', layout: 'horizontal', gap: 24, alignItems: 'center' });
  const kv1 = I(heroSub, { type: 'frame', name: 'kv / 含逾期', layout: 'horizontal', gap: 6, alignItems: 'center' });
  I(kv1, { type: 'text', content: '含逾期', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(kv1, { type: 'text', content: '¥7,361.1', fontSize: 13, fontWeight: 600, fontFamily: '$font.family.amount', fill: s(C.dangerInk), textGrowth: 'fixed-width' });
  const kv2 = I(heroSub, { type: 'frame', name: 'kv / 未来 7 天', layout: 'horizontal', gap: 6, alignItems: 'center' });
  I(kv2, { type: 'text', content: '未来 7 天', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(kv2, { type: 'text', content: '¥12,804.98', fontSize: 13, fontWeight: 600, fontFamily: '$font.family.amount', fill: s(C.text), textGrowth: 'fixed-width' });
  const dots = I(hero, { type: 'frame', name: 'chart dots', layout: 'horizontal', gap: 12, alignItems: 'end', padding: [4, 24, 0, 24] });
  for (const [dh, dc] of [[8, C.blue400], [16, '#E5484D'], [26, C.blue400], [12, '#E5484D'], [30, C.blue400], [10, '#E5484D'], [22, C.blue400], [28, '#E5484D'], [12, C.blue400], [20, '#E5484D']]) {
    I(dots, { type: 'rectangle', width: 5, height: dh, cornerRadius: 999, fill: s(dc) });
  }

  // ② 逾期风险条（暗色危险面板）
  const risk = I(content, { type: 'frame', name: 'risk strip', width: 'fill_container', layout: 'horizontal', gap: 10, alignItems: 'center', padding: [10, 14], cornerRadius: 12, fill: s(C.dangerSoft) });
  I(risk, { type: 'icon_font', iconFontName: 'alert-triangle', width: 18, height: 18, fill: s(C.dangerInk) });
  const riskTxt = I(risk, { type: 'frame', name: 'risk text', width: 'fill_container', layout: 'vertical', gap: 2 });
  I(riskTxt, { type: 'text', content: '2 笔账单已逾期', fontSize: 12, fontWeight: 700, fill: s(C.dangerInk), textGrowth: 'fixed-width' });
  I(riskTxt, { type: 'text', content: '待还合计 ¥7,361.1 · 建议今日处理', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  const repayAll = I(risk, { type: 'frame', name: 'btn / 一键全部还款', width: 'fit_content', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', padding: [0, 14], cornerRadius: 999, fill: s('#E5484D') });
  I(repayAll, { type: 'text', content: '一键全部还款', fontSize: 12, fontWeight: 600, fill: s('#FFFFFF') });

  // ③ 当天需还款（B0-2 修订需求）：金=临期语义
  const dueToday = I(content, { type: 'frame', name: 'due today block', width: 'fill_container', layout: 'vertical', gap: 10, padding: [14, 14], cornerRadius: 14, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.gold700) }, effects: [{ type: 'shadow', offsetX: 0, offsetY: 6, blur: 18, spread: 0, color: 'rgba(0,0,0,0.35)' }] });
  const dueHead = I(dueToday, { type: 'frame', name: 'due head', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  I(dueHead, { type: 'text', content: '今天需还款 09-30', fontSize: 13, fontWeight: 700, fill: s(C.text), textGrowth: 'fixed-width' });
  I(dueHead, { type: 'text', content: '1 笔', fontSize: 11, fontWeight: 600, fill: s(C.gold), textGrowth: 'fixed-width' });
  const dueRow = I(dueToday, { type: 'frame', name: 'due row', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', gap: 10 });
  const dueL = I(dueRow, { type: 'frame', name: 'due left', layout: 'vertical', gap: 3 });
  I(dueL, { type: 'text', content: '中国建设银行 · 尾号 9003', fontSize: 13, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  I(dueL, { type: 'text', content: '本期还款日 今天 · ¥8,000.00', fontSize: 11, fill: s(C.gold), textGrowth: 'fixed-width' });
  const dueBtn = I(dueRow, { type: 'frame', name: 'btn / 结清今日', width: 'fit_content', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', padding: [0, 16], cornerRadius: 999, fill: s(C.gold) });
  I(dueBtn, { type: 'text', content: '立即还款', fontSize: 12, fontWeight: 600, fill: s('#0A0F1E') });

  // ④ 今日可享优惠（B0-2 修订需求）：统计 + 入口
  const offers = I(content, { type: 'frame', name: 'offers today block', width: 'fill_container', layout: 'horizontal', gap: 12, alignItems: 'center', padding: [14, 16], cornerRadius: 14, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  const offIc = I(offers, { type: 'frame', name: 'offers icon', width: 40, height: 40, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 12, fill: s(C.goldSoft) });
  I(offIc, { type: 'icon_font', iconFontName: 'tag', width: 20, height: 20, fill: s(C.gold) });
  const offTxt = I(offers, { type: 'frame', name: 'offers text', width: 'fill_container', layout: 'vertical', gap: 2 });
  I(offTxt, { type: 'text', content: '今日可享优惠', fontSize: 13, fontWeight: 700, fill: s(C.text), textGrowth: 'fixed-width' });
  I(offTxt, { type: 'text', content: '3 张卡可享 · 5 项优惠有效期内', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(offers, { type: 'icon_font', iconFontName: 'chevron-right', width: 16, height: 16, fill: s(C.text2) });

  // ⑤ 持卡人筛选
  const filters = I(content, { type: 'frame', name: 'holder filters', width: 'fill_container', layout: 'horizontal', gap: 8, alignItems: 'center' });
  for (const [label, active] of [['全部', true], ['呼', false]]) {
    const p = I(filters, { type: 'frame', name: 'pill / ' + label, layout: 'horizontal', padding: [7, 18], cornerRadius: 999, fill: s(active ? C.primary : C.surface), stroke: { thickness: 1, fill: s(active ? C.primary : C.border) } });
    I(p, { type: 'text', content: label, fontSize: 13, fontWeight: active ? 600 : 400, fill: s(active ? '#FFFFFF' : C.text2) });
  }

  // ⑥ 指标 2×2（My Assets 式暗卡）
  const metrics = I(content, { type: 'frame', name: 'metrics grid', width: 'fill_container', layout: 'vertical', gap: 12 });
  const mr1 = I(metrics, { type: 'frame', name: 'metrics row 1', width: 'fill_container', layout: 'horizontal', gap: 12 });
  const overdue = I(mr1, { type: 'frame', name: 'metric / 已逾期', width: 'fill_container', layout: 'vertical', gap: 6, padding: [14, 14], cornerRadius: 14, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  I(overdue, { type: 'text', content: '已逾期', fontSize: 11, fill: s(C.dangerInk), textGrowth: 'fixed-width' });
  I(overdue, { type: 'text', content: '¥7,361.1', fontSize: 19, fontWeight: 700, fontFamily: '$font.family.amount', fill: s('#FFFFFF'), textGrowth: 'fixed-width' });
  I(overdue, { type: 'text', content: '2 笔待处理', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  const future = I(mr1, { type: 'frame', name: 'metric / 未来待还', width: 'fill_container', layout: 'vertical', gap: 6, padding: [14, 14], cornerRadius: 14, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  const fHead = I(future, { type: 'frame', name: 'future head', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  I(fHead, { type: 'text', content: '未来待还', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  const tabs = I(fHead, { type: 'frame', name: 'range tabs', layout: 'horizontal', gap: 4 });
  for (const [label, active] of [['7天', true], ['14天', false], ['30天', false]]) {
    const t = I(tabs, { type: 'frame', name: 'tab / ' + label, layout: 'horizontal', padding: [3, 8], cornerRadius: 999, fill: s(active ? C.goldSoft : C.subtle) });
    I(t, { type: 'text', content: label, fontSize: 9, fontWeight: active ? 700 : 400, fill: s(active ? C.gold : C.text2) });
  }
  I(future, { type: 'text', content: '¥12,804.98', fontSize: 19, fontWeight: 700, fontFamily: '$font.family.amount', fill: s('#FFFFFF'), textGrowth: 'fixed-width' });
  I(future, { type: 'text', content: '7 天内到期合计', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  const mr2 = I(metrics, { type: 'frame', name: 'metrics row 2', width: 'fill_container', layout: 'horizontal', gap: 12 });
  const debt = I(mr2, { type: 'frame', name: 'metric / 总欠款', width: 'fill_container', layout: 'vertical', gap: 6, padding: [14, 14], cornerRadius: 14, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  const dHead = I(debt, { type: 'frame', name: 'debt head', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  I(dHead, { type: 'text', content: '总欠款', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(dHead, { type: 'icon_font', iconFontName: 'chevron-down', width: 16, height: 16, fill: s(C.text2) });
  I(debt, { type: 'text', content: '¥47,317.21', fontSize: 19, fontWeight: 700, fontFamily: '$font.family.amount', fill: s('#FFFFFF'), textGrowth: 'fixed-width' });
  const unissued = I(mr2, { type: 'frame', name: 'metric / 未出账单', width: 'fill_container', layout: 'vertical', gap: 6, padding: [14, 14], cornerRadius: 14, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  I(unissued, { type: 'text', content: '未出账单', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(unissued, { type: 'text', content: '暂无数据', fontSize: 19, fontWeight: 700, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(unissued, { type: 'text', content: '邮件解析待接入', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });

  // ⑦ 账户 + 金刚区
  const acctHead = I(content, { type: 'frame', name: 'account header', width: 'fill_container', layout: 'horizontal', alignItems: 'center', gap: 10 });
  I(acctHead, { type: 'text', content: '账户', fontSize: 15, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  const acctPills = I(acctHead, { type: 'frame', name: 'account pills', layout: 'horizontal', gap: 8 });
  for (const [label, active] of [['31 张', true], ['呼博', false]]) {
    const p2 = I(acctPills, { type: 'frame', name: 'pill / ' + label, layout: 'horizontal', padding: [4, 12], cornerRadius: 999, fill: s(active ? C.primary : C.surface), stroke: { thickness: 1, fill: s(active ? C.primary : C.border) } });
    I(p2, { type: 'text', content: label, fontSize: 11, fontWeight: active ? 600 : 400, fill: s(active ? '#FFFFFF' : C.text2) });
  }
  const quick = I(content, { type: 'frame', name: 'quick actions', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', padding: [16, 12], cornerRadius: 14, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  for (const [icon, label] of [['pencil', '记一笔'], ['tag', '优惠'], ['award', '权益'], ['mail', '邮箱账单']]) {
    const cell = I(quick, { type: 'frame', name: 'quick / ' + label, layout: 'vertical', gap: 6, alignItems: 'center', padding: [4, 8] });
    const ic = I(cell, { type: 'frame', name: 'icon bg', width: 40, height: 40, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 12, fill: s(C.subtle) });
    I(ic, { type: 'icon_font', iconFontName: icon, width: 20, height: 20, fill: s(C.blue400) });
    I(cell, { type: 'text', content: label, fontSize: 11, fill: s(C.text), textGrowth: 'fixed-width' });
  }

  // ⑧ 逾期明细
  const overdueHead = I(content, { type: 'frame', name: 'overdue header', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  I(overdueHead, { type: 'text', content: '逾期明细', fontSize: 15, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  I(overdueHead, { type: 'text', content: '查看全部', fontSize: 12, fontWeight: 600, fill: s(C.blue400), textGrowth: 'fixed-width' });
  const billRow = I(content, { type: 'frame', name: 'overdue bill row', width: 'fill_container', layout: 'vertical', gap: 10, padding: [14, 14], cornerRadius: 14, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  const brTop = I(billRow, { type: 'frame', name: 'top', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'start', gap: 12 });
  const brL = I(brTop, { type: 'frame', name: 'left', width: 'fill_container', layout: 'vertical', gap: 3 });
  I(brL, { type: 'text', content: '中国农业银行', fontSize: 14, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  I(brL, { type: 'text', content: '尊然白金信用卡（精粹版）', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(brL, { type: 'text', content: '尾号 2016 · 2026-08', fontSize: 10, fill: s(C.text2), textGrowth: 'fixed-width' });
  statusPill(brTop, '逾期');
  I(billRow, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(C.border) });
  const brBottom = I(billRow, { type: 'frame', name: 'bottom', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  const brAmt = I(brBottom, { type: 'frame', name: 'amount', layout: 'vertical', gap: 2 });
  I(brAmt, { type: 'text', content: '待还金额', fontSize: 10, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(brAmt, { type: 'text', content: '¥3,680.55', fontSize: 17, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(C.dangerInk), textGrowth: 'fixed-width' });
  const settle = I(brBottom, { type: 'frame', name: 'btn / 全额结清', width: 'fit_content', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', padding: [0, 16], cornerRadius: 999, fill: s('#3B6FE0') });
  I(settle, { type: 'text', content: '全额结清', fontSize: 12, fontWeight: 600, fill: s('#FFFFFF') });

  bottomNav(phone, w, h, '首页');
  return phone;
};

candidateDashboard(390, 844);
candidateDashboard(430, 932);

// ============================================================
// B0-2 状态样例（独立 head + uncovered 登记：几何检查覆盖、字段契约豁免）
// ============================================================
const stateShell = (name, w, h) => {
  const phone = I(null, { type: 'frame', name, width: w, height: h, layout: 'none', clipContent: true, fill: s(C.canvas) });
  statusBar(phone, w);
  const header = I(phone, { type: 'frame', name: 'page header', x: 0, y: SB_H, width: w, height: 64, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, PAD] });
  const hl = I(header, { type: 'frame', name: 'heading', layout: 'vertical', gap: 2 });
  I(hl, { type: 'text', content: '概览', fontSize: 20, fontWeight: 700, fill: s(C.navy), textGrowth: 'fixed-width' });
  I(hl, { type: 'text', content: '管控信用卡资产与还款日程', fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
  const content = I(phone, {
    type: 'frame', name: 'content', x: 0, y: SB_H + 64, width: w, height: h - SB_H - 64 - NAV_H,
    layout: 'vertical', alignItems: 'center', justifyContent: 'center', gap: 12, padding: [0, PAD], clipContent: true, fill: s(C.canvas),
  });
  bottomNav(phone, w, h, '首页');
  return content;
};

// 加载：骨架占位（skeleton token）
const loading = stateShell('candidate.state.dashboard-loading · 390×844', 390, 844);
const loadBox = I(loading, { type: 'frame', name: 'loading block', width: 'fill_container', layout: 'vertical', gap: 12, padding: [16, 16], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
I(loadBox, { type: 'rectangle', name: 'skeleton title', width: 120, height: 14, cornerRadius: 999, fill: s('$color.bg.skeleton') });
for (const bw of [280, 240, 260, 180]) {
  I(loadBox, { type: 'rectangle', name: 'skeleton row', width: bw, height: 12, cornerRadius: 999, fill: s('$color.bg.skeleton') });
}
I(loadBox, { type: 'text', content: '正在同步账单…', fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });

// 空态：引导记一笔
const empty = stateShell('candidate.state.dashboard-empty · 390×844', 390, 844);
const emptyBox = I(empty, { type: 'frame', name: 'empty block', width: 'fill_container', layout: 'vertical', gap: 10, alignItems: 'center', padding: [24, 20], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
I(emptyBox, { type: 'icon_font', iconFontName: 'inbox', width: 32, height: 32, fill: s(C.text2) });
I(emptyBox, { type: 'text', content: '还没有账单', fontSize: 15, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
I(emptyBox, { type: 'text', content: '同步邮箱或手动记一笔', fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
const emptyCta = I(emptyBox, { type: 'frame', name: 'cta', layout: 'horizontal', padding: [10, 20], cornerRadius: 999, fill: s(C.primary) });
I(emptyCta, { type: 'text', content: '记一笔', fontSize: 13, fontWeight: 600, fill: s(C.onDark) });

// 错误：可重试
const err = stateShell('candidate.state.dashboard-error · 390×844', 390, 844);
const errBox = I(err, { type: 'frame', name: 'error block', width: 'fill_container', layout: 'vertical', gap: 10, alignItems: 'center', padding: [24, 20], cornerRadius: 12, fill: s(C.dangerSoft), stroke: { thickness: 1, fill: s(C.dangerSoft) } });
I(errBox, { type: 'icon_font', iconFontName: 'alert-circle', width: 32, height: 32, fill: s(C.dangerInk) });
I(errBox, { type: 'text', content: '加载失败', fontSize: 15, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
I(errBox, { type: 'text', content: '网络异常，请重试', fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
const retryCta = I(errBox, { type: 'frame', name: 'cta', layout: 'horizontal', padding: [10, 20], cornerRadius: 999, fill: s(C.dangerInk) });
I(retryCta, { type: 'text', content: '重试', fontSize: 13, fontWeight: 600, fill: s(C.onDark) });

// ============================================================
// B0-2 低保真信息层级图（wireframe：只表达层级与分组，不做视觉）
// ============================================================
const wire = I(null, { type: 'frame', name: 'candidate.wireframe.dashboard · 390×844', width: 390, height: 844, layout: 'none', clipContent: true, fill: s(C.surface) });
const wireBox = (parent, label, x, y, w2, h2) => {
  const b = I(parent, { type: 'frame', name: 'wire / ' + label, x, y, width: w2, height: h2, layout: 'vertical', gap: 6, padding: [8, 10], cornerRadius: 6, fill: s(C.canvas), stroke: { thickness: 1, fill: s(C.border) } });
  I(b, { type: 'text', content: label, fontSize: 11, fontWeight: 600, fill: s(C.text2), textGrowth: 'fixed-width' });
  return b;
};
wireBox(wire, '状态栏', 0, 0, 390, 48);
wireBox(wire, '页头: 概览 + 头像', 0, 48, 390, 64);
wireBox(wire, '逾期风险条 + 一键全部还款(有逾期时)', 12, 120, 366, 52);
wireBox(wire, '持卡人筛选 pills', 12, 180, 366, 40);
wireBox(wire, '总待还款 hero(含逾期 / 未来 7 天) · 当天需还款 · 今日优惠入口', 12, 228, 366, 120);
wireBox(wire, '指标 2x2: 已逾期 / 未来待还(7/14/30) / 总欠款 / 未出账单', 12, 356, 366, 150);
wireBox(wire, '账户 + 持卡人 pills', 12, 514, 366, 40);
wireBox(wire, '金刚区: 记一笔 / 优惠 / 权益 / 邮箱账单', 12, 562, 366, 72);
wireBox(wire, '逾期明细: 标题 + 查看全部 + 账单行(金额 / 全额结清)', 12, 642, 366, 96);
wireBox(wire, '底部导航 56 + 安全区 34', 0, 754, 390, 90);

console.log('candidate set built: 390/430 hi-fi + loading/empty/error + wireframe');
