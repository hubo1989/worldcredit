// 30 · Admin — screen.admin.dashboard / screen.admin.crud / screen.admin.ledger
// 运行: op design @design/openpencil/scripts/30-admin.js
//
// ⚠️ 按真实基线重画（baseline/dom/{admin-dashboard,admin-banks,admin-email-logs}/default.json）。
// 真实侧栏 7 项 + 「返回前台 App」按钮；顶部有日期；概览为紧凑统计卡 + 模块入口 + 产品目录表。

const s = (c) => [{ type: 'solid', color: c }];
const A = {
  canvas: '$color.bg.admin.canvas', surface: '$color.bg.admin.surface', panel: '$color.bg.admin.panel',
  border: '$color.border.onDark', text: '$color.text.onDark', text2: '#9CA3AF', text3: '#6B7280',
  primary: '#4F46E5', primaryLight: '#818CF8',
  success: '$color.status.successDark', warning: '$color.status.warning', danger: '$color.status.dangerDark',
};
const W = 1440, H = 900, SIDEBAR = 236, TOPBAR = 64, PAD = 24;

// 真实侧栏：7 项导航 + 底部用户 + 返回前台 App
const sidebar = (p, active) => {
  const sb = I(p, { type: 'frame', name: 'sidebar', x: 0, y: 0, width: SIDEBAR, height: H, layout: 'vertical', gap: 6, padding: [20, 16], fill: s(A.surface), stroke: { thickness: 1, fill: s(A.border) } });
  const brand = I(sb, { type: 'frame', name: 'brand', width: 'fill_container', layout: 'horizontal', gap: 10, alignItems: 'center', padding: [0, 8, 18, 8] });
  const mark = I(brand, { type: 'frame', name: 'logo', width: 32, height: 32, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 8, fill: s(A.primary) });
  I(mark, { type: 'text', content: 'W', fontSize: 15, fontWeight: 700, fill: s(A.text) });
  const bl = I(brand, { type: 'frame', name: 'name', layout: 'vertical', gap: 1 });
  I(bl, { type: 'text', content: 'WorldCredit', fontSize: 14, fontWeight: 700, fill: s(A.text), textGrowth: 'fixed-width' });
  I(bl, { type: 'text', content: '管理控制台', fontSize: 10, fill: s(A.text2), textGrowth: 'fixed-width' });

  const navItem = (label, icon, isActive) => {
    const item = I(sb, { type: 'frame', name: 'nav / ' + label, width: 'fill_container', height: 40, layout: 'horizontal', gap: 10, alignItems: 'center', padding: [0, 12], cornerRadius: 8, fill: s(isActive ? A.panel : A.surface) });
    if (isActive) I(item, { type: 'rectangle', name: 'active bar', width: 3, height: 18, cornerRadius: 999, fill: s(A.primaryLight) });
    I(item, { type: 'icon_font', iconFontName: icon, width: 18, height: 18, fill: s(isActive ? A.primaryLight : A.text2) });
    I(item, { type: 'text', content: label, fontSize: 13, fontWeight: isActive ? 600 : 400, fill: s(isActive ? A.text : A.text2), textGrowth: 'fixed-width' });
  };
  for (const [label, icon] of [['仪表盘', 'layout-dashboard'], ['银行管理', 'landmark'], ['卡产品管理', 'credit-card'], ['优惠活动', 'ticket'], ['权益管理', 'award'], ['邮件日志', 'mail'], ['系统设置', 'settings']]) navItem(label, icon, label === active);

  // 底部：用户 + 返回前台 App（真实存在）
  const user = I(sb, { type: 'frame', name: 'user', width: 'fill_container', layout: 'horizontal', gap: 10, alignItems: 'center', padding: [10, 8] });
  const av = I(user, { type: 'frame', name: 'avatar', width: 32, height: 32, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 999, fill: s(A.primary) });
  I(av, { type: 'text', content: 'H', fontSize: 13, fontWeight: 700, fill: s(A.text) });
  const ul = I(user, { type: 'frame', name: 'text', layout: 'vertical', gap: 1 });
  I(ul, { type: 'text', content: 'hubo1989@gmail.com', fontSize: 11, fontWeight: 600, fill: s(A.text), textGrowth: 'fixed-width' });
  I(ul, { type: 'text', content: '系统管理员', fontSize: 10, fill: s(A.text2), textGrowth: 'fixed-width' });
  const back = I(sb, { type: 'frame', name: 'btn / 返回前台 App', width: 'fill_container', height: 36, layout: 'horizontal', gap: 8, justifyContent: 'center', alignItems: 'center', cornerRadius: 8, fill: s(A.panel), stroke: { thickness: 1, fill: s(A.border) } });
  I(back, { type: 'icon_font', iconFontName: 'arrow-left', width: 14, height: 14, fill: s(A.text2) });
  I(back, { type: 'text', content: '返回前台 App', fontSize: 12, fill: s(A.text2) });
  return sb;
};

const topbar = (p, title, right) => {
  const tb = I(p, { type: 'frame', name: 'topbar', x: SIDEBAR, y: 0, width: W - SIDEBAR, height: TOPBAR, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, PAD], fill: s(A.canvas), stroke: { thickness: 1, fill: s(A.border) } });
  const l = I(tb, { type: 'frame', name: 'left', layout: 'vertical', gap: 2 });
  I(l, { type: 'text', content: title, fontSize: 17, fontWeight: 700, fill: s(A.text), textGrowth: 'fixed-width' });
  I(l, { type: 'text', content: 'WorldCredit 控制台', fontSize: 11, fill: s(A.text2), textGrowth: 'fixed-width' });
  const r = I(tb, { type: 'frame', name: 'right', layout: 'horizontal', gap: 12, alignItems: 'center' });
  I(r, { type: 'text', content: '控制台', fontSize: 12, fill: s(A.text2), textGrowth: 'fixed-width' });
  I(r, { type: 'text', content: '2026年9月22日', fontSize: 12, fill: s(A.text2), textGrowth: 'fixed-width' });
  for (const a of right || []) {
    if (a.kind === 'primary') {
      const b = I(r, { type: 'frame', name: 'btn / ' + a.label, height: 36, layout: 'horizontal', gap: 8, alignItems: 'center', padding: [0, 16], cornerRadius: 8, fill: s(A.primary) });
      I(b, { type: 'icon_font', iconFontName: a.icon, width: 16, height: 16, fill: s(A.text) });
      I(b, { type: 'text', content: a.label, fontSize: 13, fontWeight: 600, fill: s(A.text) });
    } else if (a.kind === 'search') {
      const b = I(r, { type: 'frame', name: 'search', width: 260, height: 36, layout: 'horizontal', gap: 8, alignItems: 'center', padding: [0, 12], cornerRadius: 8, fill: s(A.panel), stroke: { thickness: 1, fill: s(A.border) } });
      I(b, { type: 'icon_font', iconFontName: 'search', width: 16, height: 16, fill: s(A.text2) });
      I(b, { type: 'text', content: '搜索银行名称或代码', fontSize: 12, fill: s(A.text2), textGrowth: 'fixed-width' });
    }
  }
  return tb;
};

const shell = (name, title, right, active) => {
  const p = I(null, { type: 'frame', name, width: W, height: H, layout: 'none', clipContent: true, fill: s(A.canvas) });
  sidebar(p, active);
  topbar(p, title, right);
  return p;
};

// ============================================================
// screen.admin.dashboard（真实：4 紧凑统计卡 + 4 模块入口 + 产品目录表 + 侧栏统计）
// ============================================================
const dashboard = () => {
  const p = shell('screen.admin.dashboard · 1440×900', '平台运营概览', [], '仪表盘');
  const c = I(p, { type: 'frame', name: 'content', x: SIDEBAR, y: TOPBAR, width: W - SIDEBAR, height: H - TOPBAR, layout: 'vertical', gap: 18, padding: [PAD, PAD], clipContent: true, fill: s(A.canvas) });

  // 4 统计卡（真实标签：注册用户/卡产品数/活跃信用卡/进行中活动）
  const kpis = I(c, { type: 'frame', name: 'kpis', width: 'fill_container', layout: 'horizontal', gap: 16 });
  for (const [label, value] of [['注册用户', '1'], ['卡产品数', '586'], ['活跃信用卡', '31'], ['进行中活动', '0']]) {
    const k = I(kpis, { type: 'frame', name: 'kpi / ' + label, width: 'fill_container', layout: 'vertical', gap: 8, padding: [16, 18], cornerRadius: 12, fill: s(A.surface), stroke: { thickness: 1, fill: s(A.border) } });
    I(k, { type: 'text', content: label, fontSize: 12, fill: s(A.text2), textGrowth: 'fixed-width' });
    I(k, { type: 'text', content: value, fontSize: 26, fontWeight: 700, fontFamily: '$font.family.amount', fill: s(A.text), textGrowth: 'fixed-width' });
  }

  // 核心管理模块（4 张入口卡，真实存在）
  const modHead = I(c, { type: 'frame', name: 'module header', width: 'fill_container', layout: 'horizontal', alignItems: 'center' });
  I(modHead, { type: 'text', content: '核心管理模块', fontSize: 14, fontWeight: 600, fill: s(A.text), textGrowth: 'fixed-width' });
  const mods = I(c, { type: 'frame', name: 'modules', width: 'fill_container', layout: 'horizontal', gap: 16 });
  for (const [title, desc, icon] of [['银行管理', '维护支持的银行列表', 'landmark'], ['卡产品管理', '管理信用卡产品及账期', 'credit-card'], ['优惠活动', '全平台营销活动维护', 'ticket'], ['权益管理', '卡权益库及限额维护', 'award']]) {
    const m = I(mods, { type: 'frame', name: 'module / ' + title, width: 'fill_container', layout: 'vertical', gap: 8, padding: [16, 16], cornerRadius: 12, fill: s(A.surface), stroke: { thickness: 1, fill: s(A.border) } });
    const ic = I(m, { type: 'frame', name: 'icon', width: 36, height: 36, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 10, fill: s(A.panel) });
    I(ic, { type: 'icon_font', iconFontName: icon, width: 18, height: 18, fill: s(A.primaryLight) });
    I(m, { type: 'text', content: title, fontSize: 13, fontWeight: 600, fill: s(A.text), textGrowth: 'fixed-width' });
    I(m, { type: 'text', content: desc, fontSize: 11, fill: s(A.text2), textGrowth: 'fixed-width' });
  }

  // 信用卡产品目录（真实列：银行 / 卡片名称 / 币种 / 年费 / 年费减免 / 开卡数）
  const listHead = I(c, { type: 'frame', name: 'catalog header', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  const lh = I(listHead, { type: 'frame', name: 'left', layout: 'vertical', gap: 2 });
  I(lh, { type: 'text', content: '信用卡产品目录', fontSize: 14, fontWeight: 600, fill: s(A.text), textGrowth: 'fixed-width' });
  I(lh, { type: 'text', content: '共 586 个在册产品', fontSize: 11, fill: s(A.text2), textGrowth: 'fixed-width' });

  const table = I(c, { type: 'frame', name: 'catalog table', width: 'fill_container', height: 'fill_container', layout: 'vertical', gap: 0, cornerRadius: 12, fill: s(A.surface), stroke: { thickness: 1, fill: s(A.border) }, clipContent: true });
  const cols = [['银行', 240], ['卡片名称', 380], ['币种', 90], ['年费', 140], ['年费减免', 160], ['开卡数', 90]];
  const hr = I(table, { type: 'frame', name: 'header row', width: 'fill_container', height: 44, layout: 'horizontal', alignItems: 'center', padding: [0, 18], fill: s(A.panel), stroke: { thickness: 1, fill: s(A.border) } });
  for (const [label, w] of cols) I(hr, { type: 'text', content: label, fontSize: 12, fontWeight: 600, fill: s(A.text2), width: w, textGrowth: 'fixed-width' });
  const rows = [
    ['American Express', 'American Express Cash Back Card', 'USD', '免年费', '无年费', '0'],
    ['American Express', 'American Express Airline Co-Branded Card', 'USD', '免年费', '无年费', '0'],
    ['American Express', 'Blue Cash Everyday', 'USD', '免年费', '无年费', '0'],
    ['中国工商银行', '宇宙星座信用卡（白金卡等级）', 'CNY', '¥2,000', '刷 5 笔免', '0'],
    ['中国建设银行', '龙卡全球支付卡', 'CNY', '¥580', '首年免', '0'],
    ['招商银行', '经典白金卡', 'CNY', '¥3,600', '积分抵扣', '0'],
  ];
  rows.forEach((r, i) => {
    const row = I(table, { type: 'frame', name: 'row / ' + r[1], width: 'fill_container', height: 50, layout: 'horizontal', alignItems: 'center', padding: [0, 18], fill: s(A.surface) });
    r.forEach((cell, j) => {
      const color = j === 0 ? A.text : j === 5 ? A.text : A.text2;
      const weight = j === 0 ? 600 : 400;
      I(row, { type: 'text', content: cell, fontSize: 12, fontWeight: weight, fill: s(color), width: cols[j][1], textGrowth: 'fixed-width' });
    });
    if (i < rows.length - 1) I(table, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(A.border) });
  });
};

// ============================================================
// screen.admin.crud（真实：筛选 pills + 数量 + 表格 + 分页）
// ============================================================
const crud = () => {
  const p = shell('screen.admin.crud · 1440×900', '银行管理', [
    { kind: 'search' }, { kind: 'primary', label: '新增银行', icon: 'plus' },
  ], '银行管理');
  const c = I(p, { type: 'frame', name: 'content', x: SIDEBAR, y: TOPBAR, width: W - SIDEBAR, height: H - TOPBAR, layout: 'vertical', gap: 16, padding: [PAD, PAD], clipContent: true, fill: s(A.canvas) });

  I(c, { type: 'text', content: '维护系统中支持的银行列表及所属国家', fontSize: 12, fill: s(A.text2), textGrowth: 'fixed-width' });

  const filters = I(c, { type: 'frame', name: 'filters', width: 'fill_container', layout: 'horizontal', gap: 12, alignItems: 'center' });
  // 真实筛选：按国家筛选 + 按真实内容补全（不是启用/停用 pills）
  const countryFilter = I(filters, { type: 'frame', name: 'filter / 按国家筛选', layout: 'horizontal', gap: 6, alignItems: 'center', padding: [7, 14], cornerRadius: 8, fill: s(A.panel), stroke: { thickness: 1, fill: s(A.border) } });
  I(countryFilter, { type: 'text', content: '按国家筛选', fontSize: 12, fill: s(A.text2), textGrowth: 'fixed-width' });
  I(countryFilter, { type: 'icon_font', iconFontName: 'chevron-down', width: 14, height: 14, fill: s(A.text2) });
  const enrich = I(filters, { type: 'frame', name: 'btn / 按真实内容补全', layout: 'horizontal', gap: 6, alignItems: 'center', padding: [7, 14], cornerRadius: 8, fill: s(A.surface), stroke: { thickness: 1, fill: s(A.border) } });
  I(enrich, { type: 'icon_font', iconFontName: 'sparkles', width: 14, height: 14, fill: s(A.primaryLight) });
  I(enrich, { type: 'text', content: '按真实内容补全 (8/67)', fontSize: 12, fill: s(A.text2), textGrowth: 'fixed-width' });

  const table = I(c, { type: 'frame', name: 'table', width: 'fill_container', height: 'fill_container', layout: 'vertical', gap: 0, cornerRadius: 12, fill: s(A.surface), stroke: { thickness: 1, fill: s(A.border) }, clipContent: true });
  const cols = [['图标', 60], ['银行名称', 240], ['简称', 110], ['国家', 100], ['状态', 110], ['操作', 150]];
  const headerRow = I(table, { type: 'frame', name: 'table header', width: 'fill_container', height: 44, layout: 'horizontal', alignItems: 'center', padding: [0, 18], fill: s(A.panel), stroke: { thickness: 1, fill: s(A.border) } });
  for (const [label, w] of cols) I(headerRow, { type: 'text', content: label, fontSize: 12, fontWeight: 600, fill: s(A.text2), width: w, textGrowth: 'fixed-width' });

  const rowData = [
    ['中国工商银行', '—', 'CN - 中国', '中'],
    ['中国农业银行', '—', 'CN - 中国', '中'],
    ['中国银行', '—', 'CN - 中国', '中'],
    ['中国建设银行', '—', 'CN - 中国', '中'],
    ['交通银行', '—', 'CN - 中国', '交'],
  ];
  rowData.forEach((r, i) => {
    const row = I(table, { type: 'frame', name: 'row / ' + r[0], width: 'fill_container', height: 56, layout: 'horizontal', alignItems: 'center', padding: [0, 18], fill: s(A.surface) });
    const ic = I(row, { type: 'frame', name: 'icon', width: cols[0][1], layout: 'horizontal' });
    const bankChip = I(ic, { type: 'frame', name: 'bank chip', width: 28, height: 28, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 7, fill: s(A.panel) });
    I(bankChip, { type: 'icon_font', iconFontName: 'landmark', width: 14, height: 14, fill: s(A.text2) });
    I(row, { type: 'text', content: r[0], fontSize: 13, fontWeight: 600, fill: s(A.text), width: cols[1][1], textGrowth: 'fixed-width' });
    I(row, { type: 'text', content: r[1], fontSize: 12, fontFamily: '$font.family.mono', fill: s(A.text2), width: cols[2][1], textGrowth: 'fixed-width' });
    I(row, { type: 'text', content: r[2], fontSize: 12, fill: s(A.text2), width: cols[3][1], textGrowth: 'fixed-width' });
    const stWrap = I(row, { type: 'frame', name: 'status', width: cols[4][1], layout: 'horizontal' });
    const chip = I(stWrap, { type: 'frame', name: 'status chip', width: 24, height: 24, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 6, fill: s(A.panel) });
    I(chip, { type: 'text', content: r[3], fontSize: 11, fontWeight: 600, fill: s(A.text2) });
    const act = I(row, { type: 'frame', name: 'actions', width: cols[5][1], layout: 'horizontal', gap: 12, alignItems: 'center' });
    I(act, { type: 'text', content: '编辑', fontSize: 12, fill: s(A.primaryLight), textGrowth: 'fixed-width' });
    I(act, { type: 'text', content: '删除', fontSize: 12, fill: s(A.danger), textGrowth: 'fixed-width' });
    if (i < rowData.length - 1) I(table, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(A.border) });
  });

  const pager = I(c, { type: 'frame', name: 'pagination', width: 'fill_container', height: 36, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  const pl = I(pager, { type: 'frame', name: 'left', layout: 'horizontal', gap: 8, alignItems: 'center' });
  I(pl, { type: 'text', content: '每页行数:', fontSize: 12, fill: s(A.text2), textGrowth: 'fixed-width' });
  const sel = I(pl, { type: 'frame', name: 'page size', layout: 'horizontal', padding: [4, 10], cornerRadius: 6, fill: s(A.panel) });
  I(sel, { type: 'text', content: '10', fontSize: 12, fill: s(A.text) });
  const pr = I(pager, { type: 'frame', name: 'right', layout: 'horizontal', gap: 8, alignItems: 'center' });
  I(pr, { type: 'text', content: '1–5 of 67', fontSize: 12, fill: s(A.text2), textGrowth: 'fixed-width' });
  for (const [label, a] of [['上一页', false], ['1', true], ['下一页', false]]) {
    const b = I(pr, { type: 'frame', name: 'page / ' + label, layout: 'horizontal', padding: [5, 11], cornerRadius: 6, fill: s(a ? A.primary : A.panel) });
    I(b, { type: 'text', content: label, fontSize: 12, fontWeight: a ? 600 : 400, fill: s(a ? A.text : A.text2) });
  }
};

// ============================================================
// screen.admin.ledger（真实：筛选 pills + 表格 时间/发件人/主题/状态/说明 + 分页）
// ============================================================
const ledger = () => {
  const p = shell('screen.admin.ledger · 1440×900', '邮件日志', [], '邮件日志');
  const c = I(p, { type: 'frame', name: 'content', x: SIDEBAR, y: TOPBAR, width: W - SIDEBAR, height: H - TOPBAR, layout: 'vertical', gap: 16, padding: [PAD, PAD], clipContent: true, fill: s(A.canvas) });

  I(c, { type: 'text', content: '每封收到的邮件及其处理结果（共 2 条）', fontSize: 12, fill: s(A.text2), textGrowth: 'fixed-width' });

  const filters = I(c, { type: 'frame', name: 'filters', width: 'fill_container', layout: 'horizontal', gap: 10, alignItems: 'center' });
  for (const label of ['全部', '成功', '失败', '跳过']) {
    const a = label === '全部';
    const pill = I(filters, { type: 'frame', name: 'filter / ' + label, layout: 'horizontal', padding: [7, 14], cornerRadius: 999, fill: s(a ? A.primary : A.panel), stroke: { thickness: 1, fill: s(a ? A.primary : A.border) } });
    I(pill, { type: 'text', content: label, fontSize: 12, fontWeight: a ? 600 : 400, fill: s(a ? A.text : A.text2) });
  }

  const table = I(c, { type: 'frame', name: 'table', width: 'fill_container', height: 'fill_container', layout: 'vertical', gap: 0, cornerRadius: 12, fill: s(A.surface), stroke: { thickness: 1, fill: s(A.border) }, clipContent: true });
  const cols = [['时间', 200], ['发件人', 300], ['主题', 300], ['状态', 100], ['说明', 120]];
  const hr = I(table, { type: 'frame', name: 'header row', width: 'fill_container', height: 44, layout: 'horizontal', alignItems: 'center', padding: [0, 18], fill: s(A.panel), stroke: { thickness: 1, fill: s(A.border) } });
  for (const [label, w] of cols) I(hr, { type: 'text', content: label, fontSize: 12, fontWeight: 600, fill: s(A.text2), width: w, textGrowth: 'fixed-width' });

  const rows = [
    ['2026/9/12 13:38:06', 'e-statement@creditcard.abchina.com.cn', '中国农业银行信用卡电子账单', '成功', '—'],
    ['2026/9/12 12:54:55', 'e-statement@creditcard.abchina.com.cn', '中国农业银行信用卡电子账单', '成功', '—'],
  ];
  rows.forEach((r, i) => {
    const row = I(table, { type: 'frame', name: 'row ' + (i + 1), width: 'fill_container', height: 54, layout: 'horizontal', alignItems: 'center', padding: [0, 18], fill: s(A.surface) });
    I(row, { type: 'text', content: r[0], fontSize: 12, fontFamily: '$font.family.mono', fill: s(A.text2), width: cols[0][1], textGrowth: 'fixed-width' });
    I(row, { type: 'text', content: r[1], fontSize: 12, fill: s(A.text2), width: cols[1][1], textGrowth: 'fixed-width' });
    I(row, { type: 'text', content: r[2], fontSize: 12, fill: s(A.text), width: cols[2][1], textGrowth: 'fixed-width' });
    const stWrap = I(row, { type: 'frame', name: 'status', width: cols[3][1], layout: 'horizontal' });
    const b = I(stWrap, { type: 'frame', name: 'badge', layout: 'horizontal', padding: [3, 10], cornerRadius: 999, fill: s('rgba(52,211,153,0.16)') });
    I(b, { type: 'text', content: r[3], fontSize: 11, fontWeight: 600, fill: s(A.success) });
    I(row, { type: 'text', content: r[4], fontSize: 12, fill: s(A.text2), width: cols[4][1], textGrowth: 'fixed-width' });
    if (i < rows.length - 1) I(table, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(A.border) });
  });

  const pager = I(c, { type: 'frame', name: 'pagination', width: 'fill_container', height: 36, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  const pl = I(pager, { type: 'frame', name: 'left', layout: 'horizontal', gap: 8, alignItems: 'center' });
  I(pl, { type: 'text', content: 'Rows per page:', fontSize: 12, fill: s(A.text2), textGrowth: 'fixed-width' });
  const sel = I(pl, { type: 'frame', name: 'page size', layout: 'horizontal', padding: [4, 10], cornerRadius: 6, fill: s(A.panel) });
  I(sel, { type: 'text', content: '20', fontSize: 12, fill: s(A.text) });
  I(pager, { type: 'text', content: '1–2 of 2', fontSize: 12, fill: s(A.text2), textGrowth: 'fixed-width' });
};

dashboard();
crud();
ledger();
console.log('admin rebuilt from baseline');
