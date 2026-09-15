const fs = require('node:fs');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = '/Users/hubo/Projects/worldcredit';
const req = createRequire(root + '/package.json');
const ts = req('typescript');
function load(file, deps = {}, extra = '') {
  const src = fs.readFileSync(root + '/' + file, 'utf8') + extra;
  const code = ts.transpileModule(src, {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  vm.runInNewContext(code, {exports, require: name => name in deps ? deps[name] : req(name), console, Date, Intl, crypto: globalThis.crypto});
  return exports;
}
function fragment(file,start,end,name) {
 const src=fs.readFileSync(root+'/'+file,'utf8');
 const part=src.slice(src.indexOf(start),src.indexOf(end));
 const exports={};
 const code=ts.transpileModule(part+'\nexports.result='+name,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,Date,Intl}); return exports.result;
}
const results=[];
const recognizer=load('lib/billRecognizer.ts');
const text='2026-08月账单 账单金额1234.56元 最低还款额123.45元 2026-09-20到期';
const parsed=recognizer.recognizeBillFromText(text);
results.push({case:'文本无千分位金额1234.56',expected:1234.56,actual:parsed.bill_amount});
results.push({case:'2026-08月账单周期结束日',expected:'2026-08-31',actual:parsed.statement_end});
const fakeDb={from(table){let selected='';const q={select(s){selected=s;return q},in(){return q},eq(){return q},gte(){return q},lte(){return q},then(resolve,reject){let data=table==='bills'?[{id:'b1',card_id:'c1',bill_amount:1000,bill_month:'2026-08',due_date:'2026-09-01',status:'partial'}]:table==='payments'?[{bill_id:'b1',amount:400,paid_at:'2026-09-01'}]:[{id:'c1',credit_limit:10000}];return Promise.resolve({data,error:null}).then(resolve,reject)}};return q;}};
(async()=>{
 const analytics=load('lib/api/analytics.ts',{'../insforge':{db:fakeDb}});
 const summary=await analytics.getAnalyticsSummary({card_id:'c1'});
 results.push({case:'账单1000已还400分析待还',expected:600,actual:summary.pending_amount});
 const computeMetrics=fragment('app/(mobile)/dashboard/page.tsx','function computeMetrics','/** 卡数统计','computeMetrics');
 const metrics=computeMetrics([{computed_status:'unpaid',remaining_amount:100,currency:'USD',days_until_due:2},{computed_status:'unpaid',remaining_amount:100,currency:'HKD',days_until_due:2}],7);
 results.push({case:'USD100+HKD100主页总额原始计算',expected:'按USD/HKD分别汇总，无汇率不得显示CNY200',actual:metrics.totalPending});
 const bills=load('lib/api/bills.ts',{'../insforge':{insforge:{database:fakeDb}},'../utils':{}},'\nexport { computeStatus };');
 results.push({case:'部分还款且已逾期',expected:'partial且is_overdue=true（现有枚举未表达双维状态）',actual:bills.computeStatus({bill_amount:1000,status:'partial',due_date:'2020-01-01'},400)});
 const detail=fragment('app/(mobile)/bills/[id]/page.tsx','function computeBillProgress','export default function BillDetailPage','computeBillProgress');
 const paidBill={bill_amount:1000,status:'paid',due_date:'2099-01-01',payments:[]};
 results.push({case:'paid无流水：聚合与详情不一致',expected:'同一状态/余额口径',actual:{aggregate:bills.computeStatus(paidBill,0),detail:detail(paidBill)}});
 const ledger=load('lib/api/gmail-ledger.ts',{'../insforge':{db:fakeDb}},'\nexport { dedupEntries };');
 const rows=[{id:'1',bank:'银行A',account_tail:'1234',statement_date:'2026-08-01',due_date:'2026-09-01',statement_amount:100,currency:'USD',subject:'月结单'},{id:'2',bank:'银行A',account_tail:'1234',statement_date:'2026-08-01',due_date:'2026-09-01',statement_amount:100,currency:'HKD',subject:'月结单'}];
 results.push({case:'同卡USD/HKD两个子账单去重',expected:2,actual:ledger.dedupEntries(rows).length});
 console.log(JSON.stringify({scope:'local code with synthetic data; no network or database writes',results},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
