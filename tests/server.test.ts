import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {startServer,validateSettings} from '../packages/cli/src/server.ts';import {defaultSettings} from '../packages/core/src/types.ts';
import fs from 'node:fs';import path from 'node:path';
import {Store} from '../packages/core/src/storage.ts';
import {record,statuses} from './helpers.ts';
test('receipt color accepts only supported choices and preserves older settings',()=>{
  const old=defaultSettings();assert.deepEqual(validateSettings(old),old);
  for(const receiptTheme of ['dark','light'] as const)assert.equal(validateSettings({...old,receiptTheme}).receiptTheme,receiptTheme);
  for(const receiptTheme of ['red',null,0,{},'<script>'])assert.throws(()=>validateSettings({...old,receiptTheme}),/receipt theme/);
});
test('summary cache reuses normalized history and observes local and external SQLite updates',async()=>{
  fs.mkdirSync('artifacts',{recursive:true});const directory=fs.mkdtempSync(path.resolve('artifacts/summary-cache-'));const store=new Store(directory);
  let reads=0;const records=store.records.bind(store);store.records=(...args)=>{reads++;return records(...args);};
  const timestamp=new Date().toISOString();store.put(record('codex',{id:'one',timestamp}),'fixture');store.save('sources',statuses());
  const running=await startServer({port:0,publicDirectory:'packages/cli/dist/public',store});
  const summary=async(period='month')=>(await fetch(running.url+'/api/summary?period='+period)).json();
  try{
    assert.equal((await summary()).total.records,1);assert.equal((await summary()).total.records,1);await summary('7d');assert.equal(reads,1,'Only one normalized-history read across periods');
    store.put(record('codex',{id:'two',timestamp}),'fixture');assert.equal((await summary()).total.records,2);assert.equal(reads,2,'Same-connection updates invalidate cached summaries');
    const external=new Store(directory);try{external.put(record('codex',{id:'three',timestamp}),'fixture');}finally{external.close();}
    assert.equal((await summary()).total.records,3);assert.equal(reads,3,'Other CLI connections invalidate cached summaries');
  }finally{await running.close();store.close();}
});
test('local server serves dashboard, safe summary and settings',async()=>{const s=await startServer({port:0,publicDirectory:'packages/cli/dist/public',demo:true});try{assert.equal((await fetch(s.url)).status,200);const b=await (await fetch(s.url+'/api/bootstrap')).json();const summary=await (await fetch(s.url+'/api/summary?period=month')).json();assert.equal(summary.demo,true);assert.ok(Math.abs(summary.total.apiEquivalent-287.42)<1e-8);assert.ok(!JSON.stringify(summary).includes('fixture-session'));const settings=defaultSettings();settings.onboarded=true;settings.billing.codex={mode:'API',monthly:null};assert.equal((await fetch(s.url+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Subvalue-Token':b.token},body:JSON.stringify(settings)})).status,200);const updated=await (await fetch(s.url+'/api/summary?period=month')).json();assert.equal(updated.total.comparison.roi,null);}finally{await s.close();}});
test('cross-origin and missing-token mutations are denied',async()=>{const s=await startServer({port:0,publicDirectory:'packages/cli/dist/public',demo:true});try{assert.equal((await fetch(s.url+'/api/bootstrap',{headers:{Origin:'https://evil.invalid'}})).status,403);assert.equal((await fetch(s.url+'/api/settings',{method:'POST',body:'{}'})).status,403);assert.equal((await fetch(s.url+'/api/summary',{headers:{'Sec-Fetch-Site':'cross-site'}})).status,403);}finally{await s.close();}});
test('DNS rebinding host is denied',async()=>{const s=await startServer({port:0,publicDirectory:'packages/cli/dist/public',demo:true});try{const status=await new Promise<number>((resolve,reject)=>{const r=http.get(s.url+'/api/bootstrap',{headers:{Host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode!);});r.on('error',reject);});assert.equal(status,403);}finally{await s.close();}});
test('invalid settings and non-finite money are rejected',()=>{const s=defaultSettings();s.billing.codex.monthly=NaN;assert.throws(()=>validateSettings(s));assert.throws(()=>validateSettings({...defaultSettings(),currency:'EUR'}));});
test('server never accepts arbitrary filesystem paths',async()=>{const s=await startServer({port:0,publicDirectory:'packages/cli/dist/public',demo:true});try{assert.equal((await fetch(s.url+'/api/files?path=C:/private/auth.json')).status,403);assert.equal((await fetch(s.url+'/%2e%2e%2fpackage.json')).status,404);}finally{await s.close();}});
test('static routes cannot expose databases, transcripts or junction targets',async()=>{fs.mkdirSync('artifacts',{recursive:true});const directory=fs.mkdtempSync(path.resolve('artifacts/http-safety-'));const assets=path.join(directory,'assets'),outside=path.join(directory,'outside');fs.mkdirSync(assets);fs.mkdirSync(outside);for(const file of ['subvalue.sqlite','session.jsonl'])fs.writeFileSync(path.join(assets,file),'PRIVATE_SENTINEL');fs.writeFileSync(path.join(outside,'private.woff2'),'PRIVATE_SENTINEL');fs.symlinkSync(outside,path.join(assets,'fonts'),process.platform==='win32'?'junction':'dir');const s=await startServer({port:0,publicDirectory:assets,demo:true});try{for(const file of ['subvalue.sqlite','session.jsonl','fonts/private.woff2'])assert.equal((await fetch(s.url+'/'+file)).status,404);}finally{await s.close();}});
