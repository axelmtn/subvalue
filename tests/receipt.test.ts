import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptModel} from '../packages/receipt/src/index.ts';
import {summarize} from '../packages/core/src/summary.ts';
import {defaultSettings} from '../packages/core/src/types.ts';
import {record,prices,statuses} from './helpers.ts';
const range={from:'2026-10-01T00:00:00Z',until:'2026-11-01T00:00:00Z',label:'October 2026'};
test('receipt prints normalized token components without empty providers',()=>{
  const summary=summarize([record(),record('claude',{id:'empty-claude',input_tokens:0,output_tokens:0,total_tokens:0})],statuses(),defaultSettings(),range,prices(),true);
  const receipt=receiptModel(summary);
  assert.ok(receipt.rows.some(row=>row.left==='Input Tokens'&&row.right==='100'));
  assert.ok(receipt.rows.some(row=>row.left==='Output Tokens'&&row.right==='10'));
  assert.ok(receipt.rows.some(row=>row.left==='Cache Reads'&&row.right==='20'));
  assert.ok(!receipt.rows.some(row=>row.left==='CLAUDE CODE'));
});
test('unknown receipt token totals and API costs never become zero',()=>{
  const summary=summarize([record('codex',{input_tokens:null,total_tokens:null})],statuses(),defaultSettings(),range,prices(),true);
  const receipt=receiptModel(summary);
  assert.ok(receipt.rows.some(row=>row.left==='Input Tokens'&&row.right==='Unknown'));
  assert.ok(receipt.rows.some(row=>row.left==='Estimated API Cost'&&row.right==='—'));
  assert.ok(!receipt.rows.some(row=>row.right==='$0.00'));
});
test('receipt component totals preserve missing fields and explicit zero across selected events',()=>{
  const summary=summarize([record('claude',{id:'one',input_tokens:0,output_tokens:10,cached_input_tokens:0}),record('claude',{id:'two',input_tokens:0,output_tokens:20,cached_input_tokens:null})],statuses(),defaultSettings(),range,prices(),true);
  const rows=receiptModel(summary).rows;
  assert.equal(rows.find(r=>r.left==='Input Tokens')?.right,'0');
  assert.equal(rows.find(r=>r.left==='Output Tokens')?.right,'30');
  assert.equal(rows.find(r=>r.left==='Cache Reads')?.right,'Unknown');
});
test('receipt shows the priced amount once while retaining unknown models in details',()=>{
  for(const provider of ['codex','claude'] as const){
    const summary=summarize([record(provider,{id:'priced'}),record(provider,{id:'unpriced',model_raw:provider==='codex'?'codex-auto-review':'internal-unknown'})],statuses(),defaultSettings(),range,prices([prices().prices[0],{...prices().prices[0],provider:'claude'}]),true);
    const receipt=receiptModel(summary);
    assert.equal(summary.total.apiEquivalent,null);
    assert.ok(summary.total.knownSubtotal!>0);
    assert.equal(summary.models.find(m=>m.raw!=='known')!.pricedRecords,0);
    assert.ok(receipt.rows.find(row=>row.left==='Estimated API Cost')!.right.startsWith('$'));
    assert.ok(receipt.rows.find(row=>row.left==='Total API Equivalent')!.right.startsWith('$'));
    assert.ok(!receipt.rows.some(row=>/Unavailable|Known Subtotal|KNOWN API VALUE/.test(row.left+' '+row.right)));
    assert.equal(receipt.outcome,'');
  }
});
test('partial receipt prints a multiplier of its known amount and prorated subscription without a certain outcome',()=>{
  const settings=defaultSettings();settings.billing.codex={mode:'SUBSCRIPTION',monthly:100};
  const selected={from:'2026-10-01T00:00:00Z',until:'2026-10-08T00:00:00Z',label:'Last 7 days'};
  const summary=summarize([record('codex',{id:'priced',input_tokens:0,cached_input_tokens:0,output_tokens:28742000,total_tokens:28742000}),record('codex',{id:'review',model_raw:'codex-auto-review'})],statuses(),settings,selected,prices());
  const receipt=receiptModel(summary),expected=summary.total.knownSubtotal!/summary.total.comparison.subscription!;
  assert.equal(summary.total.comparison.roi,null);
  assert.equal(receipt.rows.find(r=>r.left==='VALUE MULTIPLE')?.right,expected.toFixed(2)+'×');
  assert.equal(receipt.rows.find(r=>r.left==='You Saved')?.right.startsWith('+$'),true);
  assert.match(receipt.confidence,/50% priced/);assert.equal(receipt.outcome,'');
});

test('receipt multiplier needs a known amount and a positive subscription for all active providers',()=>{
  for(const mode of ['API','MIXED','UNKNOWN'] as const){
    const settings=defaultSettings();settings.billing.codex={mode,monthly:null};
    const receipt=receiptModel(summarize([record()],statuses(),settings,range,prices()));
    assert.ok(!receipt.rows.some(r=>r.left==='VALUE MULTIPLE'));
  }
  const settings=defaultSettings();settings.billing.codex={mode:'SUBSCRIPTION',monthly:100};
  assert.ok(!receiptModel(summarize([record('codex',{model_raw:'codex-auto-review'})],statuses(),settings,range,prices())).rows.some(r=>r.left==='VALUE MULTIPLE'));
  settings.billing.codex.monthly=0;
  assert.ok(!receiptModel(summarize([record()],statuses(),settings,range,prices())).rows.some(r=>r.left==='VALUE MULTIPLE'));
  settings.billing.codex.monthly=100;settings.billing.claude={mode:'MIXED',monthly:null};
  const all=prices([prices().prices[0],{...prices().prices[0],provider:'claude'}]);
  assert.ok(!receiptModel(summarize([record(),record('claude',{id:'claude'})],statuses(),settings,range,all)).rows.some(r=>r.left==='VALUE MULTIPLE'));
});
