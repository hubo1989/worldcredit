// 14 · Opportunity Candidates — WC-BEN-12 权益台账/机会/日历/任务候选稿
// 运行: op design @design/openpencil/scripts/14-opportunity-candidates.js --page n38082
//
// ⚠️ 脚本模式只做插入（I），不做删除。重放前先清理本脚本产出的 16 个
// candidate.opportunities.* 帧，否则 checker 会报 duplicate-frame：
//   op get 后按帧名找出 id，逐个 `op delete <id> --page n38082`。
//
// 约定（沿用 13-candidates.js）:
//   - 候选 frame 一律 candidate.* 前缀，与 Current（screen.*）不混名。
//   - 语义红线（见 screens/_contract.json 与 DESIGN.md 第 12 节）：
//     普通领取 ≠ 新增额度；预约 ≠ 已使用；关注 ≠ 已报名；手动达标 ≠ 银行确认。
//     动作按钮只描述真实效果，禁止“一键享用/已关注/我已持卡可享”类误导文案。
//   - 颜色走 13 号脚本的暗色探索字面值；批准后统一 token 化并进漂移门禁。

const s = (c) => [{ type: 'solid', color: c }];
const C = {
  canvas: '#0A0F1E', surface: '#131A2A', subtle: '#1A2334', neutral: '#1A2334',
  navy: '#F5F7FA', navy600: '#5B8DEF', blue400: '#7AADFF',
  gold: '#F0C75E', gold700: '#D9A93F', goldSoft: '#332A14',
  primary: '#5B8DEF', primaryDark: '#7AADFF',
  border: '#26304A', text: '#F5F7FA', text2: '#9AA6BC', onDark: '#FFFFFF',
  success: '#34D399', successInk: '#6EE7B0', successSoft: '#12271C',
  warningInk: '#FFC46B', warningSoft: '#33270F',
  dangerInk: '#FF8A8A', dangerSoft: '#331720', dangerOnDark: '#FF9B9B',
  infoInk: '#7CB8FF', infoSoft: '#122438',
  skeleton: '#1A2334',
};
const SB_H = 48, PAD = 20, W = 390, H = 844;

const statusBar = (parent, w) => {
  const sb = I(parent, { type: 'frame', name: 'status bar', x: 0, y: 0, width: w, height: SB_H, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, PAD] });
  I(sb, { type: 'text', content: '9:41', fontSize: 13, fontWeight: 600, fill: s(C.text) });
  const r = I(sb, { type: 'frame', name: 'trailing', layout: 'horizontal', gap: 6, alignItems: 'center' });
  for (const i of ['signal', 'wifi', 'battery-full']) I(r, { type: 'icon_font', iconFontName: i, width: 15, height: 15, fill: s(C.text) });
};

const pageTitle = (parent, title, subtitle) => {
  const head = I(parent, { type: 'frame', name: 'page header', width: 'fill_container', layout: 'vertical', gap: 4, padding: [56 - SB_H, PAD, 10, PAD] });
  I(head, { type: 'text', name: 'page title / ' + title, content: title, fontSize: 20, fontWeight: 700, fill: s(C.text) });
  I(head, { type: 'text', name: 'page subtitle', content: subtitle, fontSize: 12, fill: s(C.text2) });
  return head;
};

const pill = (parent, label, active) => {
  const el = I(parent, { type: 'frame', name: 'pill / ' + label, layout: 'horizontal', padding: [6, 12], cornerRadius: 999, fill: s(active ? C.primary : C.neutral), stroke: { thickness: 1, fill: s(active ? C.primary : C.border) } });
  I(el, { type: 'text', content: label, fontSize: 12, fontWeight: active ? 700 : 500, fill: s(active ? C.onDark : C.text2) });
  return el;
};

const kv = (parent, label, value, valueColor) => {
  const row = I(parent, { type: 'frame', name: 'kv / ' + label, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', width: 'fill_container' });
  I(row, { type: 'text', content: label, fontSize: 12, fill: s(C.text2) });
  I(row, { type: 'text', content: value, fontSize: 12, fontWeight: 600, fill: s(valueColor || C.text) });
  return row;
};

const stateBadge = (parent, label, tone) => {
  const toneMap = {
    ok: { bg: C.successSoft, fg: C.successInk },
    warn: { bg: C.warningSoft, fg: C.warningInk },
    info: { bg: C.infoSoft, fg: C.infoInk },
    neutral: { bg: C.neutral, fg: C.text2 },
  };
  const t = toneMap[tone] || toneMap.neutral;
  const el = I(parent, { type: 'frame', name: 'status / ' + label, layout: 'horizontal', padding: [3, 10], cornerRadius: 999, fill: s(t.bg) });
  I(el, { type: 'text', content: label, fontSize: 11, fontWeight: 700, fill: s(t.fg) });
};

const actionBtn = (parent, label, primary) => {
  const el = I(parent, { type: 'frame', name: 'action / ' + label, layout: 'horizontal', padding: [8, 14], cornerRadius: 999, fill: s(primary ? C.primary : 'transparent'), stroke: { thickness: 1, fill: s(primary ? C.primary : C.border) } });
  I(el, { type: 'text', content: label, fontSize: 12, fontWeight: 700, fill: s(primary ? C.onDark : C.blue400) });
  return el;
};

const shell = (headName, w, h) => {
  const phone = I(null, { type: 'frame', name: headName + ' · ' + w + '×' + h, width: w, height: h, fill: s(C.canvas), layout: 'none', clipContent: true });
  statusBar(phone, w);
  return phone;
};

// ─────────────────────────────────────────────────────────────────────────────
// A. 我的权益台账（spec §5.1）
// ─────────────────────────────────────────────────────────────────────────────
const ledger = (w, h) => {
  const phone = shell('candidate.opportunities.ledger', w, h);
  pageTitle(phone, '我的权益', '按本人／家庭成员与实际卡查看当期额度');

  // 筛选：持卡人 / 状态
  const filters = I(phone, { type: 'frame', name: 'filters', x: 0, width: w, layout: 'horizontal', gap: 8, padding: [4, PAD], alignItems: 'center' });
  pill(filters, '持卡人 · 全部', false);
  pill(filters, '银行 · 全部', false);
  pill(filters, '状态 · 全部', false);

  const list = I(phone, { type: 'frame', name: 'account list', x: 0, y: 200, width: w, height: h - 200 - 90, layout: 'vertical', gap: 12, padding: [8, PAD], clipContent: true });

  const accountCard = ({ name, meta, holderLine, periodLine, resetLine, quota, used, reserved, available, unit, statuses, shared, actions }) => {
    const card = I(list, { type: 'frame', name: 'account card / ' + name, width: 'fill_container', layout: 'vertical', gap: 10, padding: 14, cornerRadius: 16, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
    const titleRow = I(card, { type: 'frame', name: 'title row', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', gap: 8 });
    I(titleRow, { type: 'text', name: 'benefit name', content: name, fontSize: 15, fontWeight: 700, fill: s(C.text) });
    const badges = I(titleRow, { type: 'frame', name: 'badges', layout: 'horizontal', gap: 6, alignItems: 'center' });
    if (shared) stateBadge(badges, '共享账户', 'info');
    for (const [label, tone] of statuses) stateBadge(badges, label, tone);
    I(card, { type: 'text', name: 'meta / bank · product', content: meta, fontSize: 12, fill: s(C.text2) });
    I(card, { type: 'text', name: 'meta / holder · cards', content: holderLine, fontSize: 12, fill: s(C.text2) });
    kv(card, '本期', periodLine);
    kv(card, '下一重置', resetLine);
    // 余额四格：总额 / 已使用 / 已预约占用 / 可用（口径明确，单位原样）
    const balances = I(card, { type: 'frame', name: 'balance row', width: 'fill_container', layout: 'horizontal', gap: 8 });
    const cell = (label, value, valueColor) => {
      const el = I(balances, { type: 'frame', name: 'balance / ' + label, width: 'fill_container', layout: 'vertical', gap: 2, padding: 8, cornerRadius: 10, fill: s(C.subtle) });
      I(el, { type: 'text', content: label, fontSize: 10, fill: s(C.text2) });
      I(el, { type: 'text', content: value, fontSize: 13, fontWeight: 700, fill: s(valueColor || C.text) });
    };
    cell('本期总额', quota + ' ' + unit, C.text);
    cell('已使用', used + ' ' + unit, C.text);
    cell('已预约占用', reserved + ' ' + unit, reserved === '0' ? C.text2 : C.warningInk);
    cell('可用余额', available + ' ' + unit, C.successInk);
    const actionsRow = I(card, { type: 'frame', name: 'actions', width: 'fill_container', layout: 'horizontal', gap: 8, justifyContent: 'end' });
    for (const [label, primary] of actions) actionBtn(actionsRow, label, primary);
    return card;
  };

  // 次数口径 + 共享账户（spec §5.1：同持卡人共享账户，关联卡列表，不随卡数叠加）
  accountCard({
    name: '机场贵宾厅',
    meta: '招商银行 · 经典白金卡',
    holderLine: '家庭成员 · 尾号 0004 / 0005（共享）',
    periodLine: '10-01 ~ 10-31 · Asia/Shanghai',
    resetLine: '11-01（自然月）',
    quota: '6', used: '2', reserved: '1', available: '3', unit: '次',
    statuses: [['资格正常', 'ok']],
    shared: true,
    actions: [['记录使用', true], ['使用历史', false], ['查看来源', false]],
  });

  // 金额口径（原币种最小单位展示，不跨币种合计）
  accountCard({
    name: '境外消费返现',
    meta: 'Chase · Sapphire Reserve',
    holderLine: 'B 本人 · 尾号 0006',
    periodLine: '10-01 ~ 10-31 · America/New_York',
    resetLine: '11-01（自然月）',
    quota: 'US$ 30.00', used: 'US$ 12.50', reserved: 'US$ 0.00', available: 'US$ 17.50', unit: '',
    statuses: [['余额待核对', 'warn']],
    shared: false,
    actions: [['记录使用', true], ['使用历史', false], ['查看来源', false]],
  });

  // 次数不限口径（无限额 ≠ 0；额度 0 是合法“当前无额度”，另见 state 帧）
  accountCard({
    name: '航延贵宾休息室',
    meta: '工商银行 · 金卡',
    holderLine: '我 · 尾号 0003',
    periodLine: '全年有效 · Asia/Shanghai',
    resetLine: '—（单次有效期至 2027-06-30）',
    quota: '次数不限', used: '1', reserved: '0', available: '不限', unit: '',
    statuses: [['资格正常', 'ok']],
    shared: false,
    actions: [['记录使用', true], ['使用历史', false], ['查看来源', false]],
  });

  return phone;
};
ledger(W, H);

// ─────────────────────────────────────────────────────────────────────────────
// B. 我的可用机会（spec §6）
// ─────────────────────────────────────────────────────────────────────────────
const opportunityList = (w, h) => {
  const phone = shell('candidate.opportunities.list', w, h);
  pageTitle(phone, '我的可用机会', '下一步可做的优惠与权益动作');

  const kindTabs = I(phone, { type: 'frame', name: 'kind tabs', x: 0, width: w, layout: 'horizontal', gap: 8, padding: [4, PAD] });
  pill(kindTabs, '全部', true);
  pill(kindTabs, '优惠', false);
  pill(kindTabs, '权益', false);

  const statusRow = I(phone, { type: 'frame', name: 'status filter', x: 0, width: w, layout: 'horizontal', gap: 8, padding: [2, PAD] });
  pill(statusRow, '今天可用', true);
  pill(statusRow, '即将到期', false);
  pill(statusRow, '待领取', false);
  pill(statusRow, '需确认', false);

  const list = I(phone, { type: 'frame', name: 'opportunity list', x: 0, y: 216, width: w, height: h - 216 - 90, layout: 'vertical', gap: 12, padding: [8, PAD], clipContent: true });

  const oppCard = ({ title, meta, deadline, note, statuses, actions }) => {
    const card = I(list, { type: 'frame', name: 'opportunity card / ' + title, width: 'fill_container', layout: 'vertical', gap: 8, padding: 14, cornerRadius: 16, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
    const titleRow = I(card, { type: 'frame', name: 'title row', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', gap: 8 });
    I(titleRow, { type: 'text', name: 'opportunity title', content: title, fontSize: 15, fontWeight: 700, fill: s(C.text) });
    const badges = I(titleRow, { type: 'frame', name: 'badges', layout: 'horizontal', gap: 6 });
    for (const [label, tone] of statuses) stateBadge(badges, label, tone);
    I(card, { type: 'text', name: 'opportunity meta', content: meta, fontSize: 12, fill: s(C.text2), width: 'fill_container', textGrowth: 'fixed-width' });
    kv(card, '截止', deadline);
    if (note) I(card, { type: 'text', name: 'note', content: note, fontSize: 11, fill: s(C.text2) });
    const actionsRow = I(card, { type: 'frame', name: 'actions', width: 'fill_container', layout: 'horizontal', gap: 8, justifyContent: 'end' });
    for (const [label, primary] of actions) actionBtn(actionsRow, label, primary);
  };

  oppCard({
    title: '经典白金餐饮 5 折',
    meta: '招商银行 · 经典白金卡 · 我（尾号 0001）',
    deadline: '今天 23:59（Asia/Shanghai）',
    note: '本期剩余 3 次 · 规则来源：银行官网（2026-09-30 确认）',
    statuses: [['今天可用', 'ok']],
    actions: [['记录使用', true], ['查看银行入口', false], ['关注', false]],
  });

  oppCard({
    title: '观影优惠',
    meta: '招商银行 · 生活卡 · 家庭成员（尾号 0005）',
    deadline: '10-31（本月剩余额度月底失效）',
    note: '本期剩余 1 次',
    statuses: [['即将到期', 'warn']],
    actions: [['记录使用', true], ['查看银行入口', false]],
  });

  oppCard({
    title: '新户礼遇：消费满 3 笔得年费减免',
    meta: '民生银行 · 待确认卡产品归属',
    deadline: '领取窗口 11-01 ~ 11-30（待补充具体时段）',
    note: '资格条件未结构化，请核对原文后确认',
    statuses: [['待领取', 'info'], ['需确认', 'warn']],
    actions: [['记录已领取', true], ['查看银行入口', false]],
  });

  const emptyHint = I(list, { type: 'frame', name: 'empty hint / 筛选为空', width: 'fill_container', layout: 'vertical', gap: 6, padding: 16, cornerRadius: 12, fill: s(C.subtle), alignItems: 'center' });
  I(emptyHint, { type: 'text', content: '当前筛选下暂无机会', fontSize: 13, fontWeight: 600, fill: s(C.text2) });
  I(emptyHint, { type: 'text', content: '切换筛选或清除关键词后重试', fontSize: 11, fill: s(C.text2) });

  return phone;
};
opportunityList(W, H);

// ─────────────────────────────────────────────────────────────────────────────
// C. 权益日历（spec §7.1）
// ─────────────────────────────────────────────────────────────────────────────
const calendar = (w, h) => {
  const phone = shell('candidate.opportunities.calendar', w, h);
  pageTitle(phone, '权益日历', '额度失效、重置与截止事件');

  const head = I(phone, { type: 'frame', name: 'month header / 2026-10', x: 0, width: w, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [4, 12], gap: 8 });
  const nav = I(head, { type: 'frame', name: 'month nav', layout: 'horizontal', gap: 10, alignItems: 'center' });
  I(nav, { type: 'icon_font', iconFontName: 'chevron-left', width: 18, height: 18, fill: s(C.text2) });
  I(nav, { type: 'text', content: '2026 年 10 月', fontSize: 15, fontWeight: 700, fill: s(C.text) });
  I(nav, { type: 'icon_font', iconFontName: 'chevron-right', width: 18, height: 18, fill: s(C.text2) });
  const viewSwitch = I(head, { type: 'frame', name: 'view switch / 月历|按日列表', layout: 'horizontal', gap: 6 });
  pill(viewSwitch, '按日列表', true);
  pill(viewSwitch, '月历', false);

  const dayList = I(phone, { type: 'frame', name: 'day list', x: 0, y: 188, width: w, height: h - 188 - 90, layout: 'vertical', gap: 10, padding: [8, PAD], clipContent: true });

  const day = (date, weekday, events) => {
    const dayFrame = I(dayList, { type: 'frame', name: 'day / ' + date, width: 'fill_container', layout: 'vertical', gap: 8 });
    const label = I(dayFrame, { type: 'frame', name: 'day label', layout: 'horizontal', gap: 8, alignItems: 'center' });
    I(label, { type: 'text', content: date, fontSize: 14, fontWeight: 700, fill: s(C.text) });
    I(label, { type: 'text', content: weekday, fontSize: 12, fill: s(C.text2) });
    for (const ev of events) {
      const row = I(dayFrame, { type: 'frame', name: 'event row / ' + ev.type, width: 'fill_container', layout: 'vertical', gap: 4, padding: 12, cornerRadius: 12, fill: s(C.surface), stroke: { thickness: 1, fill: s(ev.tone === 'warn' ? C.gold700 : C.border) } });
      const rowHead = I(row, { type: 'frame', name: 'event head', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
      stateBadge(rowHead, ev.type, ev.tone || 'info');
      I(rowHead, { type: 'text', name: 'event meta / 当地日期·时区', content: ev.when, fontSize: 11, fill: s(C.text2) });
      I(row, { type: 'text', name: 'event object', content: ev.object, fontSize: 13, fontWeight: 600, fill: s(C.text), width: 'fill_container', textGrowth: 'fixed-width' });
      I(row, { type: 'text', name: 'event meta / 剩余额度', content: ev.extra, fontSize: 11, fill: s(C.text2) });
      if (ev.action) {
        const a = I(row, { type: 'frame', name: 'suggest action', layout: 'horizontal' });
        actionBtn(a, ev.action, false);
      }
    }
  };

  day('10-28', '周三', [
    { type: '额度失效', tone: 'warn', when: '10-31 24:00 · Asia/Shanghai', object: '观影优惠 · 家庭成员（生活卡）', extra: '本月剩余 1 次，月底失效不滚存', action: '记录使用' },
  ]);
  day('11-01', '周日', [
    { type: '周期重置', tone: 'info', when: '00:00 · Asia/Shanghai', object: '机场贵宾厅 · 共享账户', extra: '新周期总额 6 次；剩余不结转' },
    { type: '周期重置', tone: 'info', when: '00:00 · America/New_York', object: '境外消费返现 · B 本人', extra: '新周期总额 US$ 30.00' },
  ]);
  day('11-30', '周一', [
    { type: '领取截止', tone: 'warn', when: '23:59 · Asia/Shanghai', object: '新户礼遇年费减免', extra: '未记录领取前持续提醒；领取后待办解除', action: '记录已领取' },
  ]);

  const pending = I(dayList, { type: 'frame', name: 'pending / 待补充日期', width: 'fill_container', layout: 'vertical', gap: 4, padding: 12, cornerRadius: 12, fill: s(C.warningSoft) });
  I(pending, { type: 'text', content: '待补充日期', fontSize: 12, fontWeight: 700, fill: s(C.warningInk) });
  I(pending, { type: 'text', content: '2 项事件的领取／预约窗口缺具体日期，进入待核对列表，不生成猜测事件', fontSize: 11, fill: s(C.warningInk), width: 'fill_container', textGrowth: 'fixed-width' });

  return phone;
};
calendar(W, H);

// ─────────────────────────────────────────────────────────────────────────────
// D. 消费达标任务（spec §8，P2）
// ─────────────────────────────────────────────────────────────────────────────
const tasks = (w, h) => {
  const phone = shell('candidate.opportunities.tasks', w, h);
  pageTitle(phone, '消费达标任务', '手动登记进度；达标不代表银行已核验');

  const list = I(phone, { type: 'frame', name: 'task list', x: 0, y: 160, width: w, height: h - 160 - 90, layout: 'vertical', gap: 12, padding: [8, PAD], clipContent: true });

  const taskCard = ({ title, meta, progress, gapNote, reward, actions, statuses }) => {
    const card = I(list, { type: 'frame', name: 'task card / ' + title, width: 'fill_container', layout: 'vertical', gap: 8, padding: 14, cornerRadius: 16, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) } });
    const titleRow = I(card, { type: 'frame', name: 'title row', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', gap: 8 });
    I(titleRow, { type: 'text', name: 'task title', content: title, fontSize: 15, fontWeight: 700, fill: s(C.text) });
    const badges = I(titleRow, { type: 'frame', name: 'badges', layout: 'horizontal', gap: 6 });
    for (const [label, tone] of statuses) stateBadge(badges, label, tone);
    I(card, { type: 'text', name: 'task meta', content: meta, fontSize: 12, fill: s(C.text2), width: 'fill_container', textGrowth: 'fixed-width' });
    // 手动进度：绝对快照，显示统计截至日期
    kv(card, '手动进度（截至 10-14）', progress);
    if (gapNote) I(card, { type: 'text', name: 'gap / 缺口', content: gapNote, fontSize: 11, fill: s(C.text2) });
    kv(card, '预计发放窗口', reward);
    const actionsRow = I(card, { type: 'frame', name: 'actions', width: 'fill_container', layout: 'horizontal', gap: 8, justifyContent: 'end' });
    for (const [label, primary] of actions) actionBtn(actionsRow, label, primary);
  };

  taskCard({
    title: '当月消费 3 笔 ≥ 399 元',
    meta: '招商银行 · 经典白金卡 · 我（尾号 0001）· 统计周期 10-01 ~ 10-31',
    progress: '2 / 3 笔（手动确认）',
    gapNote: '缺口：再 1 笔 ≥ ¥399（第 3 组条件或满足金额线 ¥1,200 亦可）',
    reward: '11-05 ~ 11-15 发放 1 个 9 分权益（预计，以银行为准）',
    statuses: [['手动达标', 'ok']],
    actions: [['更新进度', true], ['记录奖励到账', false]],
  });

  taskCard({
    title: '境外首刷返 US$ 100',
    meta: 'Chase · Sapphire Reserve · B 本人（尾号 0006）· 统计周期 09-20 ~ 12-31',
    progress: 'US$ 320 / US$ 500（手动确认）',
    gapNote: '缺口：US$ 180；达标后等待发放窗口',
    reward: '周期结束后次月 10-20 发放（未到账前仅提示“待确认”）',
    statuses: [['未达标', 'neutral']],
    actions: [['更新进度', true]],
  });

  return phone;
};
tasks(W, H);

// ─────────────────────────────────────────────────────────────────────────────
// E. 弹层：共享账户 / 历史纠错（spec §5.1 / §5.5）
// ─────────────────────────────────────────────────────────────────────────────
const sheetBase = (headName, w, h, title) => {
  const phone = shell(headName, w, h);
  // 弹层整体收进一个 layer： scrim 有意遮住状态栏下方内容，属覆盖语义；
  // 单独成层避免与页面骨架构成同层“意外重叠”。
  const layer = I(phone, { type: 'frame', name: 'sheet layer', x: 0, y: SB_H, width: w, height: h - SB_H, layout: 'none' });
  I(layer, { type: 'rectangle', name: 'scrim', x: 0, y: 0, width: w, height: h - SB_H, fill: [{ type: 'solid', color: 'rgba(4,8,18,0.6)' }] });
  const sheet = I(layer, { type: 'frame', name: 'sheet / ' + title, x: 0, y: h - SB_H - 520, width: w, height: 520, layout: 'vertical', gap: 12, padding: 20, cornerRadius: [24, 24, 0, 0], fill: s(C.surface) });
  const headRow = I(sheet, { type: 'frame', name: 'sheet header', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  I(headRow, { type: 'text', content: title, fontSize: 16, fontWeight: 700, fill: s(C.text) });
  I(headRow, { type: 'icon_font', iconFontName: 'x', width: 18, height: 18, fill: s(C.text2) });
  return { phone, sheet };
};

const sharedAccountSheet = (w, h) => {
  const { phone, sheet } = sheetBase('candidate.opportunities.sheet.shared-account', w, h, '共享账户详情');
  I(sheet, { type: 'text', name: 'benefit name', content: '机场贵宾厅 · 招商银行 经典白金卡', fontSize: 14, fontWeight: 700, fill: s(C.text) });
  const cards = I(sheet, { type: 'frame', name: 'card list / 关联卡', width: 'fill_container', layout: 'vertical', gap: 6 });
  for (const line of ['家庭成员 · 尾号 0004（active）', '家庭成员 · 尾号 0005（frozen，仅历史）']) {
    const row = I(cards, { type: 'frame', name: 'card row', width: 'fill_container', layout: 'horizontal', gap: 8, alignItems: 'center' });
    I(row, { type: 'icon_font', iconFontName: 'credit-card', width: 16, height: 16, fill: s(C.blue400) });
    I(row, { type: 'text', content: line, fontSize: 12, fill: s(C.text2) });
  }
  kv(sheet, '本期总额', '6 次');
  kv(sheet, '已使用', '2 次');
  kv(sheet, '已预约占用', '1 次');
  kv(sheet, '可用余额', '3 次');
  const note = I(sheet, { type: 'frame', name: 'note / 不随卡数叠加', width: 'fill_container', layout: 'vertical', gap: 4, padding: 12, cornerRadius: 12, fill: s(C.infoSoft) });
  I(note, { type: 'text', content: '同持卡人共享一个余额池', fontSize: 12, fontWeight: 700, fill: s(C.infoInk) });
  I(note, { type: 'text', content: '按任一关联卡筛选时余额不变、不复制累加；按卡统计另见使用历史。', fontSize: 11, fill: s(C.infoInk) });
  const actions = I(sheet, { type: 'frame', name: 'actions', width: 'fill_container', layout: 'horizontal', gap: 8, justifyContent: 'end' });
  actionBtn(actions, '记录使用', true);
  actionBtn(actions, '使用历史', false);
  return phone;
};
sharedAccountSheet(W, H);

const correctionSheet = (w, h) => {
  const { phone, sheet } = sheetBase('candidate.opportunities.sheet.usage-correction', w, h, '更正使用记录');
  kv(sheet, '原记录', '10-02 · 家庭成员 · 尾号 0004 · 1 次');
  const fieldDate = I(sheet, { type: 'frame', name: 'field / 使用日期', width: 'fill_container', layout: 'vertical', gap: 4 });
  I(fieldDate, { type: 'text', content: '使用日期（规则当地日期，禁止未来）', fontSize: 11, fill: s(C.text2) });
  I(fieldDate, { type: 'text_input', name: 'input / 使用日期', value: '2026-10-02', fontSize: 14, fill: s(C.subtle), width: 306, height: 40 });
  const fieldCount = I(sheet, { type: 'frame', name: 'field / 次数', width: 'fill_container', layout: 'vertical', gap: 4 });
  I(fieldCount, { type: 'text', content: '次数', fontSize: 11, fill: s(C.text2) });
  I(fieldCount, { type: 'text_input', name: 'input / 次数', value: '1', fontSize: 14, fill: s(C.subtle), width: 306, height: 40 });
  const fieldReason = I(sheet, { type: 'frame', name: 'field / 更正原因', width: 'fill_container', layout: 'vertical', gap: 4 });
  I(fieldReason, { type: 'text', content: '更正原因（必填，记入审计）', fontSize: 11, fill: s(C.text2) });
  I(fieldReason, { type: 'text_area', name: 'input / 更正原因', value: '', fontSize: 14, fill: s(C.subtle), width: 306, height: 56 });
  const conflict = I(sheet, { type: 'frame', name: 'conflict notice', width: 'fill_container', layout: 'vertical', gap: 4, padding: 12, cornerRadius: 12, fill: s(C.dangerSoft) });
  I(conflict, { type: 'text', content: '跨周期更正将同时校验两个周期', fontSize: 12, fontWeight: 700, fill: s(C.dangerInk) });
  I(conflict, { type: 'text', content: '目标周期余额不足时整次失败，原记录保持有效；由预约产生的记录请走“预约／履约纠正”。', fontSize: 11, fill: s(C.dangerInk), width: 'fill_container', textGrowth: 'fixed-width' });
  const actions = I(sheet, { type: 'frame', name: 'actions', width: 'fill_container', layout: 'horizontal', gap: 8, justifyContent: 'end' });
  actionBtn(actions, '提交更正', true);
  actionBtn(actions, '撤销此记录', false);
  return phone;
};
correctionSheet(W, H);

// ─────────────────────────────────────────────────────────────────────────────
// F. 状态帧：P1 常规 + P2 履约三态（spec §6.4 / §9）
// ─────────────────────────────────────────────────────────────────────────────
const stateShell = (headName, w, h, stateTitle, body) => {
  const phone = shell(headName, w, h);
  const box = I(phone, { type: 'frame', name: 'state block', x: 24, y: 240, width: w - 48, layout: 'vertical', gap: 8, padding: 20, cornerRadius: 16, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.border) }, alignItems: 'center' });
  I(box, { type: 'text', name: 'state title', content: stateTitle, fontSize: 14, fontWeight: 700, fill: s(C.text) });
  for (const line of body) I(box, { type: 'text', name: 'state body', content: line, fontSize: 12, fill: s(C.text2), textAlign: 'center', width: w - 96, textGrowth: 'fixed-width' });
  return phone;
};

stateShell('candidate.opportunities.state.loading', W, H, '加载中', ['正在读取权益账户与当期余额']);
stateShell('candidate.opportunities.state.empty', W, H, '暂无权益账户', ['从实际卡列表选择卡片并关联已发布定义，完成初始化', '零权益用户可从空态开始']);
stateShell('candidate.opportunities.state.error', W, H, '加载失败', ['接口返回错误，列表保持原状', '可重试；失败不显示为空态或成功']);
stateShell('candidate.opportunities.state.needs-confirmation', W, H, '余额待核对', ['存在未归属的历史用量或期初核对未完成', '确认前不计为确定可用，不推送催用提醒']);
stateShell('candidate.opportunities.state.usage-history', W, H, '使用历史', ['按日期、卡、操作者与状态筛选', '显示发生时间、登记时间、备注与更正链', '已撤销记录只读保留']);
stateShell('candidate.opportunities.state.conflict', W, H, '版本冲突', ['记录已被其他端修改', '请重载最新余额后重试；输入不会自动提交两次']);
stateShell('candidate.opportunities.state.claim', W, H, '记录已领取（P2）', ['普通领取不新增配额，仅记录领取事实', '领取窗口关闭后待办自动解除']);
stateShell('candidate.opportunities.state.booking', W, H, '记录预约（P2）', ['已在银行或服务商完成预约后记录', '确认后占用额度；预约不等于已使用']);
stateShell('candidate.opportunities.state.pending-settlement', W, H, '待结算（P2）', ['取消预约时需显式选择结算结果：已退回 / 已消耗 / 未知', '未知结果保留占用并标记待结算']);

console.log('opportunity candidates built: ledger 390/430 + list + calendar + tasks + sheets + 9 states');
