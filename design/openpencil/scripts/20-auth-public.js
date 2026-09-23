// 20 · Auth & Public — screen.auth.login / screen.auth.register
// 运行: op design @design/openpencil/scripts/20-auth-public.js

const s = (c) => [{ type: 'solid', color: c }];
const C = {
  canvas: '$color.bg.canvas', surface: '$color.bg.surface', subtle: '$color.bg.subtle',
  navy: '$color.brand.navy800', navy600: '$color.brand.navy600', blue400: '$color.brand.blue400', gold: '$color.brand.gold500',
  primary: '$color.runtime.primary', primaryDark: '$color.runtime.primaryDark',
  border: '$color.border.default', borderInput: '$color.border.input',
  text: '$color.text.primary', text2: '$color.text.secondary', onDark: '$color.text.onDark',
  success: '$color.status.success', danger: '$color.status.danger',
};
const W = 390, H = 844, PAD = 24;

const statusBar = (p) => {
  const sb = I(p, { type: 'frame', name: 'status bar', x: 0, y: 0, width: W, height: 48, layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center', padding: [0, 20] });
  I(sb, { type: 'text', content: '9:41', fontSize: 13, fontWeight: 600, fill: s(C.text) });
  const r = I(sb, { type: 'frame', name: 'trailing', layout: 'horizontal', gap: 6, alignItems: 'center' });
  for (const i of ['signal', 'wifi', 'battery-full']) I(r, { type: 'icon_font', iconFontName: i, width: 15, height: 15, fill: s(C.text) });
};

const field = (parent, label, value, state) => {
  const wrap = I(parent, { type: 'frame', name: 'field / ' + label, width: 'fill_container', layout: 'vertical', gap: 6 });
  I(wrap, { type: 'text', content: label, fontSize: 12, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  const strokeColor = state === 'error' ? C.danger : state === 'focus' ? C.primary : C.borderInput;
  const box = I(wrap, {
    type: 'frame', name: 'input', width: 'fill_container', height: 44, layout: 'horizontal', alignItems: 'center',
    padding: [10, 14], cornerRadius: 8, fill: s(C.surface), stroke: { thickness: state === 'focus' ? 2 : 1, fill: s(strokeColor) },
  });
  I(box, { type: 'text', content: value, fontSize: 14, fill: s(value.includes('请输入') ? C.text2 : C.text), textGrowth: 'fixed-width' });
  if (state === 'error') I(wrap, { type: 'text', content: '验证码错误，请重新输入', fontSize: 11, fill: s(C.danger), textGrowth: 'fixed-width' });
  return wrap;
};

const primaryBtn = (parent, label) => {
  const b = I(parent, { type: 'frame', name: 'btn / ' + label, width: 'fill_container', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 8, fill: s(C.primary) });
  I(b, { type: 'text', content: label, fontSize: 15, fontWeight: 600, fill: s(C.onDark) });
  return b;
};

const oauthBtn = (parent, label, icon) => {
  const b = I(parent, { type: 'frame', name: 'oauth / ' + label, width: 'fill_container', height: 44, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', gap: 10, cornerRadius: 8, fill: s(C.surface), stroke: { thickness: 1, fill: s(C.borderInput) } });
  I(b, { type: 'icon_font', iconFontName: icon, width: 18, height: 18, fill: s(C.text) });
  I(b, { type: 'text', content: label, fontSize: 14, fontWeight: 600, fill: s(C.text) });
  return b;
};

const shell = (name) => {
  const p = I(null, { type: 'frame', name, width: W, height: H, layout: 'none', clipContent: true, fill: s(C.canvas) });
  statusBar(p);
  return p;
};

// ---------- screen.auth.login ----------
const login = () => {
  const p = shell('screen.auth.login · 390×844');

  // 品牌区
  const brand = I(p, { type: 'frame', name: 'brand', x: 0, y: 96, width: W, layout: 'vertical', gap: 10, alignItems: 'center', padding: [0, PAD] });
  const mark = I(brand, { type: 'frame', name: 'logo', width: 64, height: 64, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 16, fill: s(C.navy) });
  I(mark, { type: 'icon_font', iconFontName: 'credit-card', width: 30, height: 30, fill: s(C.gold) });
  I(brand, { type: 'text', content: 'WorldCredit', fontSize: 26, fontWeight: 700, fill: s(C.navy), textGrowth: 'fixed-width' });
  I(brand, { type: 'text', content: '家庭信用卡账单与还款管理', fontSize: 13, fill: s(C.text2), textGrowth: 'fixed-width' });

  // 表单
  const form = I(p, { type: 'frame', name: 'form', x: 0, y: 300, width: W, layout: 'vertical', gap: 16, padding: [0, PAD] });
  field(form, '邮箱', 'hubo1989@gmail.com', 'default');
  field(form, '密码', '••••••••••', 'default');
  const row = I(form, { type: 'frame', name: 'row', width: 'fill_container', layout: 'horizontal', justifyContent: 'space_between', alignItems: 'center' });
  const remember = I(row, { type: 'frame', name: 'remember', layout: 'horizontal', gap: 6, alignItems: 'center' });
  I(remember, { type: 'frame', name: 'checkbox', width: 16, height: 16, cornerRadius: 4, fill: s(C.primary), stroke: { thickness: 1, fill: s(C.primary) } });
  I(remember, { type: 'text', content: '记住我', fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(row, { type: 'text', content: '忘记密码？', fontSize: 12, fill: s(C.primaryDark), textGrowth: 'fixed-width' });
  primaryBtn(form, '登录');

  // 分隔
  const div = I(form, { type: 'frame', name: 'divider', width: 'fill_container', layout: 'horizontal', gap: 12, alignItems: 'center' });
  I(div, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(C.border) });
  I(div, { type: 'text', content: '或', fontSize: 11, fill: s(C.text2) });
  I(div, { type: 'rectangle', width: 'fill_container', height: 1, fill: s(C.border) });

  oauthBtn(form, '使用 Google 登录', 'chrome');

  const footer = I(p, { type: 'frame', name: 'footer', x: 0, y: 762, width: W, layout: 'horizontal', justifyContent: 'center', gap: 4, padding: [0, PAD] });
  I(footer, { type: 'text', content: '还没有账号？', fontSize: 12, fill: s(C.text2), textGrowth: 'fixed-width' });
  I(footer, { type: 'text', content: '立即注册', fontSize: 12, fontWeight: 600, fill: s(C.primaryDark), textGrowth: 'fixed-width' });
};

// ---------- screen.auth.login (error state) ----------
const loginError = () => {
  const p = shell('screen.auth.login · error · 390×844');
  const brand = I(p, { type: 'frame', name: 'brand', x: 0, y: 96, width: W, layout: 'vertical', gap: 10, alignItems: 'center', padding: [0, PAD] });
  const mark = I(brand, { type: 'frame', name: 'logo', width: 64, height: 64, layout: 'horizontal', justifyContent: 'center', alignItems: 'center', cornerRadius: 16, fill: s(C.navy) });
  I(mark, { type: 'icon_font', iconFontName: 'credit-card', width: 30, height: 30, fill: s(C.gold) });
  I(brand, { type: 'text', content: 'WorldCredit', fontSize: 26, fontWeight: 700, fill: s(C.navy), textGrowth: 'fixed-width' });

  const alert = I(p, { type: 'frame', name: 'error alert', x: 0, y: 250, width: W, layout: 'horizontal', gap: 10, alignItems: 'start', padding: [12, 14] });
  const inner = I(alert, { type: 'frame', name: 'inner', width: 'fill_container', layout: 'horizontal', gap: 10, alignItems: 'start', padding: [12, 14], cornerRadius: 10, fill: '#FEF2F2', stroke: { thickness: 1, fill: s(C.danger) } });
  I(inner, { type: 'icon_font', iconFontName: 'alert-circle', width: 18, height: 18, fill: s(C.danger) });
  const txt = I(inner, { type: 'frame', name: 'text', width: 'fill_container', layout: 'vertical', gap: 3 });
  I(txt, { type: 'text', content: '登录失败', fontSize: 12, fontWeight: 600, fill: s(C.text), textGrowth: 'fixed-width' });
  I(txt, { type: 'text', content: '邮箱或密码不正确，已保留你填写的内容', fontSize: 11, fill: s(C.text2), textGrowth: 'fixed-width' });

  const form = I(p, { type: 'frame', name: 'form', x: 0, y: 350, width: W, layout: 'vertical', gap: 16, padding: [0, PAD] });
  field(form, '邮箱', 'hubo1989@gmail.com', 'default');
  field(form, '密码', '••••••••••', 'error');
  primaryBtn(form, '重新登录');
  oauthBtn(form, '使用 Google 登录', 'chrome');
};

login();
loginError();
console.log('auth built');
