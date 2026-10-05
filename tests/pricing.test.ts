import test from 'node:test';import assert from 'node:assert/strict';import {priceRecord,catalog} from '../packages/core/src/pricing/index.ts';import {record,prices,price} from './helpers.ts';
import fs from 'node:fs';
test('Codex cache read is subtracted from input and reasoning not billed twice',()=>{const r=priceRecord(record(),prices());assert.equal(r.usd,(80*2+20+10*10)/1e6);});
test('Claude uncached input is separate from cache operations',()=>{const r=record('claude',{cache_creation_tokens:10,cache_creation_5m_tokens:6,cache_creation_1h_tokens:4});assert.equal(priceRecord(r,prices([price({provider:'claude'})])).usd,(100*2+20+10*10+6*2.5+4*4)/1e6);});
test('historical pricing selects half-open effective interval',()=>{const c=prices([price({effective_until:'2026-10-01T00:00:00.000Z'}),price({effective_from:'2026-10-01T00:00:00.000Z',input:4})]);const r=record();assert.equal(priceRecord(r,c).usd,(80*4+20+100)/1e6);r.timestamp='2026-09-30T23:59:59.999Z';assert.equal(priceRecord(r,c).usd,(160+20+100)/1e6);});
test('unknown internal model produces null, not zero',()=>{assert.equal(priceRecord(record('codex',{model_raw:'codex-auto-review'})).usd,null);});
test('current snapshot is never backdated to historical sessions',()=>{const r=record('claude',{model_raw:'claude-opus-4-6',timestamp:'2026-02-01T00:00:00.000Z'});assert.equal(priceRecord(r,catalog).reason,'historical-price-unavailable');});
test('missing token field prevents invented pricing',()=>{assert.equal(priceRecord(record('codex',{cached_input_tokens:null}),prices()).usd,null);});
test('unallocated total is not priced using invented token proportions',()=>{assert.equal(priceRecord(record('codex',{unallocated_total_tokens:100}),prices()).usd,null);});
test('zero recorded usage can be priced as exact zero',()=>{assert.equal(priceRecord(record('codex',{input_tokens:0,cached_input_tokens:0,cache_creation_tokens:0,output_tokens:0,total_tokens:0}),prices()).usd,0);});
test('ambiguous overlapping versions fail closed',()=>{assert.equal(priceRecord(record(),prices([price(),price()])).reason,'ambiguous-price-version');});
test('unknown cache duration is not assumed to be five minutes',()=>{assert.equal(priceRecord(record('claude',{cache_creation_tokens:10}),prices([price({provider:'claude'})])).usd,null);});
test('unverified context bands never select cheap pricing silently',()=>{assert.equal(priceRecord(record(),prices([price({context_threshold:null,long_context:{input:4,cached_input:2,cache_write:6,output:20}})])).reason,'context-band-unverified');});
test('verified context threshold supports long-context rates',()=>{assert.equal(priceRecord(record(),prices([price({context_threshold:50,long_context:{input:4,cached_input:2,cache_write:6,output:20}})])).usd,(80*4+20*2+10*20)/1e6);});
test('unpriced fast mode and server tools fail closed',()=>{assert.equal(priceRecord(record('claude',{speed:'fast'}),prices([price({provider:'claude'})])).usd,null);assert.equal(priceRecord(record('claude',{web_search_requests:1}),prices([price({provider:'claude'})])).usd,null);});
const publicRecord=(model:string,day:string,provider:'codex'|'claude'='codex')=>record(provider,{model_raw:model,timestamp:day+'T12:00:00.000Z',input_tokens:1000000,cached_input_tokens:0,output_tokens:1000000,cache_creation_tokens:0,total_tokens:2000000});
test('Sol launch and promotional historical prices differ',()=>{assert.equal(priceRecord(publicRecord('gpt-5.6-sol','2026-07-20')).usd,55);assert.equal(priceRecord(publicRecord('gpt-5.6-sol','2026-09-20')).usd,38);});
test('Luna July 30 price cut is versioned',()=>{assert.equal(priceRecord(publicRecord('gpt-5.6-luna','2026-07-20')).usd,11);assert.equal(priceRecord(publicRecord('gpt-5.6-luna','2026-08-01')).usd,2.2);});
test('calendar-dated price transition never invents an exact UTC instant',()=>{assert.equal(priceRecord(publicRecord('gpt-5.6-sol','2026-08-21')).reason,'price-transition-day-uncertain');assert.equal(priceRecord(publicRecord('gpt-5.6-luna','2026-07-30')).usd,null);});
test('promotional prices are not extrapolated beyond confirmed duration',()=>{assert.equal(priceRecord(publicRecord('gpt-5.6-sol','2026-11-23')).reason,'historical-price-unavailable');});
test('public GPT 6 identifiers resolve with primary-source provenance',()=>{for(const model of ['gpt-6-astra','gpt-6-sol','gpt-6-luna','gpt-6.1-sol']){const result=priceRecord(publicRecord(model,'2026-10-02'));assert.ok(result.usd!>0);assert.equal(result.canonical,model);assert.equal(result.mapping?.confidence,'HIGH');assert.match(result.mapping!.source,/developers\.openai\.com/);}});
test('long context threshold is inclusive and cached input belongs to the context',()=>{const r=publicRecord('gpt-6.1-sol','2026-10-02');r.input_tokens=272000;r.cached_input_tokens=200000;const normal=priceRecord(r).usd!;r.input_tokens++;assert.ok(priceRecord(r).usd!>normal);});
test('aggregate delta with ambiguous request context cannot select a price band',()=>{assert.equal(priceRecord(record('codex',{model_raw:'gpt-6.1-sol',notes:['last-delta-disagreement'],timestamp:'2026-10-02T12:00:00.000Z'})).reason,'request-context-ambiguous');});
test('Claude historical cache writes use separate 5m and 1h rates',()=>{const r=record('claude',{model_raw:'claude-opus-5',timestamp:'2026-08-02T12:00:00.000Z',input_tokens:100,cached_input_tokens:20,cache_creation_tokens:10,cache_creation_5m_tokens:6,cache_creation_1h_tokens:4,output_tokens:10});assert.equal(priceRecord(r).usd,(500+10+6*6.25+4*10+250)/1e6);});
test('all observed Claude identifiers have exact, documented mappings',()=>{for(const model of ['claude-fable-5','claude-opus-4-8','claude-opus-5'])assert.ok(priceRecord(publicRecord(model,'2026-08-02','claude')).usd!>0);});
test('Claude long-context history does not receive current pricing prematurely',()=>{assert.equal(priceRecord(publicRecord('claude-opus-4-6','2026-02-20','claude')).reason,'historical-context-price-unavailable');assert.equal(priceRecord(publicRecord('claude-opus-4-6','2026-03-14','claude')).usd,30);});
test('unverified model aliases and internal review IDs remain unavailable',()=>{for(const model of ['codex-auto-review','gpt-6-astra-latest','claude-opus-auto'])assert.equal(priceRecord(publicRecord(model,'2026-10-02')).reason,'unresolved-model');});
test('catalog versions never overlap for the same provider and model',()=>{for(const p of catalog.prices)for(const q of catalog.prices){if(p===q||p.provider!==q.provider||p.model!==q.model)continue;assert.ok((p.effective_until&&p.effective_until<=q.effective_from)||(q.effective_until&&q.effective_until<=p.effective_from));}});
test('Codex cache writes replace ordinary input charges rather than adding to them',()=>{const r=record('codex',{cache_creation_tokens:30});assert.equal(priceRecord(r,prices()).usd,(50*2+20+30*3+100)/1e6);assert.equal(priceRecord(record('codex',{cache_creation_tokens:90}),prices()).reason,'invalid-cache-subset');});
test('Fable suspension is not treated as a priced availability period',()=>{assert.ok(priceRecord(publicRecord('claude-fable-5','2026-06-10','claude')).usd!>0);assert.equal(priceRecord(publicRecord('claude-fable-5','2026-06-15','claude')).reason,'historical-price-unavailable');});
test('documented initial GPT-6 Sol rate prices launch-day estimates without backdating availability',()=>{
  for(const time of ['00:00:00','12:00:00','23:59:59']){const r=publicRecord('gpt-6-sol','2026-09-22');r.timestamp=`2026-09-22T${time}.000Z`;assert.equal(priceRecord(r).usd,19);}
  assert.equal(priceRecord(publicRecord('gpt-6-sol','2026-09-21')).reason,'historical-price-unavailable');
});
test('Terra historical reduction and real transition days are preserved',()=>{
  assert.equal(priceRecord(publicRecord('gpt-5.6-terra','2026-07-20')).usd,27.5);
  assert.equal(priceRecord(publicRecord('gpt-5.6-terra','2026-08-01')).usd,22);
  assert.equal(priceRecord(publicRecord('gpt-5.6-terra','2026-07-30')).reason,'price-transition-day-uncertain');
  assert.equal(priceRecord(publicRecord('claude-opus-4-6','2026-03-13','claude')).usd,null);
});
test('every model in the verified official standard text/code table has its exact rates',()=>{
  const evidence=JSON.parse(fs.readFileSync(new URL('./fixtures/pricing/openai-standard-2026-10-05.json',import.meta.url),'utf8'));
  assert.equal(evidence.rows.length,40);
  for(const row of evidence.rows){
    const version=catalog.prices.find(p=>p.provider==='codex'&&p.model===row.model&&p.effective_from<='2026-10-05T12:00:00.000Z'&&(!p.effective_until||p.effective_until>'2026-10-05T12:00:00.000Z'));
    assert.ok(version,row.model);assert.equal(version.input,row.input,row.model);assert.equal(version.cached_input,row.cached,row.model);assert.equal(version.output,row.output,row.model);assert.equal(version.cache_write,row.write,row.model);
  }
});
test('new Claude cache-read discounts are model specific and historically gated',()=>{
  for(const [model,day,input,cached,output] of [['claude-fable-5-1','2026-09-01',10,.25,50],['claude-mythos-5-1','2026-09-01',10,.25,50],['claude-opus-5-5','2026-09-22',4,.2,20],['claude-sonnet-5-5','2026-09-28',2,.2,10]] as const){
    const r=publicRecord(model,day,'claude');r.cached_input_tokens=1000000;
    assert.equal(priceRecord(r).usd,input+cached+output,model);
    r.timestamp=new Date(Date.parse(day+'T00:00:00Z')-1).toISOString();assert.equal(priceRecord(r).reason,'historical-price-unavailable');
  }
  assert.equal(priceRecord(publicRecord('claude-sonnet-5','2026-09-01','claude')).usd,12);
});
test('legacy model snapshot rates never silently become historical rates',()=>{
  assert.equal(priceRecord(publicRecord('gpt-5.1-codex-max','2026-10-04')).reason,'historical-price-unavailable');
  const r=publicRecord('gpt-5.1-codex-max','2026-10-05');r.input_tokens=100;assert.ok(priceRecord(r).usd!>0);
  assert.equal(priceRecord(publicRecord('gpt-5.5-pro','2026-10-05')).usd,330);
  r.model_raw='gpt-5.5-pro';r.cached_input_tokens=20;assert.equal(priceRecord(r).reason,'cache-read-price-unavailable');
});
test('only documented model aliases resolve, including Claude Haiku',()=>{
  const r=publicRecord('claude-haiku-4-5','2026-10-05','claude');r.input_tokens=100;
  assert.equal(priceRecord(r).canonical,'claude-haiku-4-5-20251001');assert.ok(priceRecord(r).usd!>0);
  assert.equal(priceRecord(publicRecord('gpt-5.6','2026-10-05')).canonical,'gpt-5.6-sol');
  assert.equal(priceRecord(publicRecord('gpt-5.3-codex-spark','2026-10-05')).usd,null);
});
test('all currently listed Claude models have verified model-specific cache tariffs',()=>{
  const rows:[string,number,number,number][]=[
    ['claude-fable-5-1',10,.25,50],['claude-opus-5-5',4,.2,20],['claude-sonnet-5-5',2,.2,10],['claude-haiku-4-5-20251001',1,.1,5],
    ['claude-mythos-5-1',10,.25,50],['claude-fable-5',10,1,50],['claude-mythos-5',10,1,50],['claude-opus-5',5,.5,25],
    ['claude-opus-4-8',5,.5,25],['claude-opus-4-7',5,.5,25],['claude-opus-4-6',5,.5,25],['claude-opus-4-5-20251101',5,.5,25],
    ['claude-sonnet-5',2,.2,10],['claude-sonnet-4-6',3,.3,15],['claude-sonnet-4-5-20250929',3,.3,15]
  ];
  for(const [model,input,cached,output] of rows){
    const version=catalog.prices.find(p=>p.provider==='claude'&&p.model===model&&p.effective_from<='2026-10-05T12:00:00.000Z'&&(!p.effective_until||p.effective_until>'2026-10-05T12:00:00.000Z'));
    assert.ok(version,model);assert.equal(version.input,input,model);assert.equal(version.cached_input,cached,model);assert.equal(version.output,output,model);
    assert.equal(version.cache_write_5m,input*1.25,model);assert.equal(version.cache_write_1h,input*2,model);
  }
});
test('retired Claude models have bounded historical availability and no fabricated Haiku history',()=>{
  for(const [model,retired,input,output] of [['claude-opus-4-1-20250805','2026-08-05',15,75],['claude-opus-4-20250514','2026-06-15',15,75],['claude-sonnet-4-20250514','2026-06-15',3,15],['claude-3-7-sonnet-20250219','2026-02-19',3,15]] as const){
    const r=publicRecord(model,'2026-01-10','claude');r.input_tokens=100;
    assert.equal(priceRecord(r).usd,(100*input+1000000*output)/1e6,model);
    r.timestamp=retired+'T12:00:00.000Z';assert.equal(priceRecord(r).reason,'historical-price-unavailable',model);
  }
  const result=priceRecord(publicRecord('claude-3-5-haiku-20241022','2025-01-10','claude'));
  assert.equal(result.canonical,'claude-3-5-haiku-20241022');assert.equal(result.reason,'historical-price-unavailable');
});
