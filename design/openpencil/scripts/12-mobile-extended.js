// 12 · Mobile Extended — screen.mobile.benefits / screen.mobile.gmail-ledger / screen.mobile.settings
// 运行: op design @design/openpencil/scripts/12-mobile-extended.js
//
// ⚠️ 按真实基线重画（baseline/dom/{benefits,gmail-ledger,settings}/default.json）。

const s = (c) => [{ type: 'solid', color: c }];
const C = {
  canvas: '$color.bg.canvas', surface: '$color.bg.surface', subtle: '$color.bg.subtle',
  navy: '$color.brand.navy800', navy600: '$color.brand.navy600', blue400: '$color.brand.blue400',
  gold: '$color.brand.gold500', gold700: '$color.brand.gold700',
  primary: '$color.runtime.primary', primaryDark: '$color.runtime.primaryDark',
  border: '$color.border.default', text: '$color.text.primary', text2: '$color.text.secondary', onDark: '$color.text.onDark',
  success: '$color.status.success', warning: '$color.status.warning', warningInk: '$color.status.warningInk',
  danger: '$color.status.danger', dangerInk: '$color.status.dangerInk', info: '$color.status.info',
};
const SB_H = 48, NAV_H = 90, NAV_CONTENT_H = 56, SAFE_H = 34, PAD = 20, W = 390, H = 844;

const statusBar = (p, w) => {
  const sb = I(p, { type: 'frame', name: 'status bar', x: 0, y: 0, width: w, height: SB_H, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, PAD] });
  I(sb, { type: 'text', content: '9:41', fontSize: 13, fontWeight: 600, fill: s(C.text) });
  const r = I(sb, { type: 'frame', name: 'trailing', layout: 'horizontal', gap: 6, alignItems: 'center' });
  for (const i of ['signal', 'wifi', 'battery-full']) I(r, { type: 'icon_font', iconFontName: i, width: 15, height: 15, fill: s(C.text) });
};
const bottomNav = (p, w, h, active) => {
  const nav = I(p, { type: 'frame', name: 'bottom nav', x: 0, y: h - NAV_H, width: w, height: NAV_H, layout: 'vertical', justifyContent: 'space_around', alignItems: 'center', fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
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
const pageHeader = (p, w, title, subtitle, icons) => {
  const h = I(p, { type: 'frame', name: 'page header', x: 0, y: SB_H, width: w, height: 64, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, PAD] });
  const l = I(h, { type: 'frame', name: 'heading', layout: 'vertical', gap: 2 });
  I(l, { type: 'text', content: title, fontSize: 20, fontWeight: 700, fill: s(C.navy), textGrowth: 'fixed-width' });
  if (subtitle) I(l, { type: 'text', content: subtitle, fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
  const r = I(h, { type: 'frame', name: 'actions', layout: 'horizontal', gap: 10, alignItems: 'center' });
  for (const ic of icons || []) {
    if (ic.kind === 'primary') {
      const b = I(r, { type: 'frame', name: 'btn / ' + ic.label, layout: 'horizontal', gap: 5, alignItems: 'center', padding: [8, 14], cornerRadius: 999, fill: s(C.primary) });
      I(b, { type: 'icon_font', iconFontName: ic.icon, width: 15, height: 15, fill: s(C.onDark) });
      I(b, { type: 'text', content: ic.label, fontSize: 12, fontWeight: 600, fill: s(C.onDark) });
    } else if (ic.kind === 'ghost') {
      const b = I(r, { type: 'frame', name: 'btn / ' + ic.label, layout: 'horizontal', gap: 5, alignItems: 'center', padding: [8, 14], cornerRadius: 999, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
      I(b, { type: 'text', content: ic.label, fontSize: 12, fontWeight: 600, fill: s(C.primaryDark) });
    } else {
      I(r, { type: 'icon_font', iconFontName: ic.icon, width: 20, height: 20, fill: s(C.navy) });
    }
  }
};
const card = (parent, name, gap) => I(parent, { type: 'frame', name, width: 'fill_container', layout: 'vertical', gap: gap || 12, padding: [16, 16], cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
const shell = (name, w, h) => {
  const p = I(null, { type: 'frame', name, width: w, height: h, layout: 'none', clipContent: true, fill: s(C.canvas) });
  statusBar(p, w);
  return p;
};

// ============================================================
// screen.mobile.benefits（真实：我的权益 + 空态 + AI 搜集入口）
// ============================================================
const benefits = () => {
  const p = shell('screen.mobile.benefits · 390×844', W, H);
  // 390 宽度下页头放不下两个按钮（会溢出裁切），因此标题行只放标题，
  // 操作按钮单独一行 —— 与真实页面的纵向排布一致。
  pageHeader(p, W, '我的权益', '智能追踪与享用您的信用卡专属权益', []);
  const c = I(p, { type: 'frame', name: 'content', x: 0, y: SB_H + 64, width: W, height: H - SB_H - 64 - NAV_H, layout: 'vertical', gap: 14, padding: [0, PAD], clipContent: true, fill: s(C.canvas) });

  const actions = I(c, { type: 'frame', name: 'benefit actions', width: 'fill_container', layout: 'horizontal', gap: 10, alignItems: 'center' });
  const aiBtn = I(actions, { type: 'frame', name: 'btn / AI 搜集权益', layout: 'horizontal', gap: 6, alignItems: 'center', padding: [9, 16], cornerRadius: 999, fill: s(C.primary) });
  I(aiBtn, { type: 'icon_font', iconFontName: 'sparkles', width: 15, height: 15, fill: s(C.onDark) });
  I(aiBtn, { type: 'text', content: 'AI 搜集权益', fontSize: 13, fontWeight: 600, fill: s(C.onDark) });
  const manualBtn = I(actions, { type: 'frame', name: 'btn / 手动添加', layout: 'horizontal', gap: 6, alignItems: 'center', padding: [9, 16], cornerRadius: 999, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
  I(manualBtn, { type: 'icon_font', iconFontName: 'plus', width: 15, height: 15, fill: s(C.primaryDark) });
  I(manualBtn, { type: 'text', content: '手动添加', fontSize: 13, fontWeight: 600, fill: s(C.primaryDark) });

  const empty = card(c, 'empty state', 10);
  const box = I(empty, { type: 'frame', name: 'empty box', width: 'fill_container', layout: 'vertical', gap: 8, alignItems: 'center', padding: [28, 0] });
  const circle = I(box, { type: 'frame', name: 'icon circle', width: 64, height: 64, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(C.subtle) });
  I(circle, { type: 'icon_font', iconFontName: 'award', width: 28, height: 28, fill: s(C.navy) });
  I(box, { type: 'text', content: '暂无可用权益', fontSize: 15, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  I(box, { type: 'text', content: '点击"AI 搜集权益"自动检索卡片权益或手动添加', fontSize: 11, fill: s(C.text2), textAlign: 'center', textGrowth: 'fixed-width' });
  const cta = I(box, { type: 'frame', name: 'btn / 一键 AI 自动搜集', layout: 'horizontal', gap: 6, alignItems: 'center', padding: [10, 18], cornerRadius: 999, fill: s(C.primary) });
  I(cta, { type: 'icon_font', iconFontName: 'sparkles', width: 16, height: 16, fill: s(C.onDark) });
  I(cta, { type: 'text', content: '一键 AI 自动搜集', fontSize: 13, fontWeight: 600, fill: s(C.onDark) });

  bottomNav(p, W, H, '我的');
};

// ============================================================
// screen.mobile.gmail-ledger（真实：流水 + 6 项统计 + tabs + 批量行 + 三操作）
// ============================================================
const ledger = () => {
  const p = shell('screen.mobile.gmail-ledger · 390×844', W, H);
  pageHeader(p, W, '邮箱账单流水', '2', [{ kind: 'ghost', label: '全部' }]);
  const c = I(p, { type: 'frame', name: 'content', x: 0, y: SB_H + 64, width: W, height: H - SB_H - 64 - NAV_H, layout: 'vertical', gap: 12, padding: [0, PAD], clipContent: true, fill: s(C.canvas) });

  // 统计：全部/未还/部分/已清
  const stats = I(c, { type: 'frame', name: 'stats', width: 'fill_container', layout: 'horizontal', gap: 10 });
  for (const [label, n, color] of [['全部', '2', C.navy], ['未还', '2', C.danger], ['部分', '0', C.text2], ['已清', '0', C.success]]) {
    const st = I(stats, { type: 'frame', name: 'stat / ' + label, width: 'fill_container', layout: 'vertical', gap: 4, padding: [10, 10], cornerRadius: 10, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
    I(st, { type: 'text', content: label, fontSize: 10, fill: s(C.text2), textGrowth: 'fixed-width' });
    I(st, { type: 'text', content: n, fontSize: 18, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(color), textGrowth: 'fixed-width' });
  }

  // 金额汇总
  const sums = card(c, 'sums', 10);
  const sr = I(sums, { type: 'frame', name: 'sum row', width: 'fill_container', layout: 'horizontal', gap: 12 });
  for (const [label, value, color] of [['账单总额', '¥30,588.57', C.navy], ['待还金额', '¥30,588.57', C.danger]]) {
    const kv = I(sr, { type: 'frame', name: 'kv / ' + label, width: 'fill_container', layout: 'vertical', gap: 3 });
    I(kv, { type: 'text', content: label, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
    I(kv, { type: 'text', content: value, fontSize: 16, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(color), textGrowth: 'fixed-width' });
  }

  // tabs
  const tabs = I(c, { type: 'frame', name: 'tabs', width: 'fill_container', height: 40, layout: 'horizontal', gap: 6, padding: 4, cornerRadius: 999, fill: s(C.subtle) });
  for (const [label, active] of [['全部(2)', true], ['未还(2)', false], ['部分(0)', false], ['已清(0)', false]]) {
    const t = I(tabs, { type: 'frame', name: 'tab / ' + label, width: 'fill_container', layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(active ? C.navy : C.subtle) });
    I(t, { type: 'text', content: label, fontSize: 11, fontWeight: active ? 600 : 400, fill: s(active ? C.onDark : C.text2) });
  }

  // 待补金额 + 全选
  const bulk = I(c, { type: 'frame', name: 'bulk bar', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  const pending = I(bulk, { type: 'frame', name: 'pending chip', layout: 'horizontal', gap: 5, alignItems: 'center', padding: [5, 12], cornerRadius: 999, fill: '$color.status.warningSoft' });
  I(pending, { type: 'text', content: '待补金额(3)', fontSize: 11, fontWeight: 600, fill: s(C.warningInk) });
  const sel = I(bulk, { type: 'frame', name: 'select all', layout: 'horizontal', gap: 6, alignItems: 'center' });
  I(sel, { type: 'frame', name: 'checkbox', width: 16, height: 16, cornerRadius: 4, fill: s(C.surface), stroke: { thickness: 2, fill: C.primary } });
  I(sel, { type: 'text', content: '全选 (2 条未还)', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });

  // 流水行（真实：银行 / **** 尾号 / 持卡人 / 状态 / 金额 / 逾期天数 / 三操作）
  const row = (bank, tail, amount, overdue) => {
    const r = card(c, 'ledger row / ' + bank, 10);
    const top = I(r, { type: 'frame', name: 'top', width: 'fill_container', layout: 'horizontal', alignItems: 'center', gap: 10 });
    I(top, { type: 'frame', name: 'checkbox', width: 16, height: 16, cornerRadius: 4, fill: s(C.surface), stroke: { thickness: 2, fill: C.primary } });
    const l = I(top, { type: 'frame', name: 'left', width: 'fill_container', layout: 'vertical', gap: 3 });
    I(l, { type: 'text', content: bank, fontSize: 13, fontWeight: 700, fill: s(C.text), textGrowth: 'fixed-width' });
    const meta = I(l, { type: 'frame', name: 'meta', layout: 'horizontal', gap: 6, alignItems: 'center' });
    I(meta, { type: 'text', content: '**** ' + tail, fontSize: 10, fontFamily: '$font.family.mono', fill: s(C.text2), textGrowth: 'fixed-width' });
    I(meta, { type: 'text', content: '呼博', fontSize: 10, fill: s(C.text2), textGrowth: 'fixed-width' });
    const rSide = I(top, { type: 'frame', name: 'right', layout: 'vertical', gap: 4, alignItems: 'end' });
    const st = I(rSide, { type: 'frame', name: 'status', layout: 'horizontal', padding: [2, 9], cornerRadius: 999, fill: '$color.status.dangerSoft' });
    I(st, { type: 'text', content: '未还款', fontSize: 10, fontWeight: 700, fill: s(C.dangerInk) });
    I(rSide, { type: 'text', content: amount, fontSize: 15, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(C.text), textGrowth: 'fixed-width' });
    const od = I(r, { type: 'frame', name: 'overdue', layout: 'horizontal', gap: 5, alignItems: 'center' });
    I(od, { type: 'icon_font', iconFontName: 'alert-circle', width: 12, height: 12, fill: s(C.danger) });
    I(od, { type: 'text', content: overdue, fontSize: 10, fontWeight: 600, fill: s(C.danger), textGrowth: 'fixed-width' });
    // 三操作
    const acts = I(r, { type: 'frame', name: 'actions', width: 'fill_container', layout: 'horizontal', gap: 8, justifyContent: 'end' });
    const b1 = I(acts, { type: 'frame', name: 'btn / 标记还款', layout: 'horizontal', padding: [6, 12], cornerRadius: 999, fill: s(C.primary) });
    I(b1, { type: 'text', content: '标记还款', fontSize: 11, fontWeight: 600, fill: s(C.onDark) });
    for (const label of ['全额已还', '部分还款', '详情']) {
      const b = I(acts, { type: 'frame', name: 'btn / ' + label, layout: 'horizontal', padding: [6, 12], cornerRadius: 999, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
      I(b, { type: 'text', content: label, fontSize: 11, fill: s(C.text2) });
    }
    return r;
  };
  row('北京银行', '1838', '¥30,334.51', '已逾期 74 天');
  row('北京银行', '1838', '¥254.06', '已逾期 13 天');

  bottomNav(p, W, H, '首页');
};

// ============================================================
// screen.mobile.settings（真实是「我的」页：权限卡 + 功能入口列表 + 退出登录）
// ============================================================
const settings = () => {
  const p = shell('screen.mobile.settings · 390×844', W, H);
  pageHeader(p, W, '我的', null, []);
  const c = I(p, { type: 'frame', name: 'content', x: 0, y: SB_H + 64, width: W, height: H - SB_H - 64 - NAV_H, layout: 'vertical', gap: 12, padding: [0, PAD], clipContent: true, fill: s(C.canvas) });

  // 账号
  const account = card(c, 'account', 6);
  const ar = I(account, { type: 'frame', name: 'account row', width: 'fill_container', layout: 'horizontal', gap: 12, alignItems: 'center' });
  const av = I(ar, { type: 'frame', name: 'avatar', width: 48, height: 48, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(C.navy) });
  I(av, { type: 'text', content: 'H', fontSize: 20, fontWeight: 700, fill: s(C.onDark) });
  const al = I(ar, { type: 'frame', name: 'left', width: 'fill_container', layout: 'vertical', gap: 3 });
  I(al, { type: 'text', content: 'hubo1989@gmail.com', fontSize: 13, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  I(al, { type: 'text', content: '系统管理员权限', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });

  // 管理员卡（含进入后台）
  const admin = I(c, { type: 'frame', name: 'admin card', width: 'fill_container', layout: 'vertical', gap: 10, padding: [14, 16], cornerRadius: 12, fill: s(C.navy) });
  I(admin, { type: 'text', content: '系统管理员权限', fontSize: 13, fontWeight: 700, fill: s(C.onDark), textGrowth: 'fixed-width' });
  I(admin, { type: 'text', content: '管理全平台银行、卡产品、公共权益与 AI 配置', fontSize: 11, fill: s(C.blue400), textGrowth: 'fixed-width' });
  const enter = I(admin, { type: 'frame', name: 'btn / 进入后台', layout: 'horizontal', gap: 6, alignItems: 'center', padding: [9, 16], width: 'fit_content', cornerRadius: 999, fill: s(C.primary) });
  I(enter, { type: 'icon_font', iconFontName: 'shield', width: 15, height: 15, fill: s(C.onDark) });
  I(enter, { type: 'text', content: '进入后台', fontSize: 12, fontWeight: 600, fill: s(C.onDark) });

  // 功能入口（真实：家庭管理 / 优惠活动 / 我的权益 / 邮箱账单导入 / 提醒偏好 / 设置）
  const listSection = (items) => {
    const box = card(c, 'list', 0);
    items.forEach(([icon, title, desc, badge], i) => {
      const r = I(box, { type: 'frame', name: 'row / ' + title, width: 'fill_container', layout: 'horizontal', gap: 12, alignItems: 'center', padding: [12, 0] });
      const ic = I(r, { type: 'frame', name: 'icon', width: 36, height: 36, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 10, fill: s(C.subtle) });
      I(ic, { type: 'icon_font', iconFontName: icon, width: 18, height: 18, fill: s(C.navy) });
      const l = I(r, { type: 'frame', name: 'text', width: 'fill_container', layout: 'vertical', gap: 2 });
      I(l, { type: 'text', content: title, fontSize: 13, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
      I(l, { type: 'text', content: desc, fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });
      if (badge) {
        const b = I(r, { type: 'frame', name: 'badge', layout: 'horizontal', padding: [2, 9], cornerRadius: 999, fill: '$color.status.successSoft' });
        I(b, { type: 'text', content: badge, fontSize: 10, fontWeight: 700, fill: s('$color.status.successInk') });
      }
      I(r, { type: 'icon_font', iconFontName: 'chevron-right', width: 16, height: 16, fill: s(C.text2) });
      if (i < items.length - 1) I(box, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(C.border) });
    });
    return box;
  };
  listSection([
    ['users', '家庭管理', '持卡人与卡片管理', null],
    ['tag', '优惠活动', '可用优惠', null],
    ['award', '我的权益', '权益使用进度', null],
    ['mail', '邮箱账单导入', '专属地址直传，免登记来源邮箱', '专属就绪'],
    ['bell', '提醒偏好', '还款提醒通道与节点', null],
    ['settings', '设置', '界面显示偏好与隐私模式', null],
  ]);

  // 退出登录
  const logout = I(c, { type: 'frame', name: 'btn / 退出登录', width: 'fill_container', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 8, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.danger) } });
  I(logout, { type: 'text', content: '退出登录', fontSize: 14, fontWeight: 600, fill: s(C.danger) });

  bottomNav(p, W, H, '我的');
};

benefits();
ledger();
settings();
console.log('mobile extended rebuilt from baseline');
