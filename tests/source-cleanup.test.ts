import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {Store,type Checkpoint} from '../packages/core/src/storage.ts';
import {scan} from '../packages/core/src/scanner.ts';
import {summarize,dateRange} from '../packages/core/src/summary.ts';
import {defaultSettings} from '../packages/core/src/types.ts';
import {meta,context,codexEvent,counts,claudeEvent,prices,price} from './helpers.ts';

function fixture(){
  fs.mkdirSync('artifacts',{recursive:true});
  const home=fs.mkdtempSync(path.resolve('artifacts/cleanup-home-'));
  const codex=path.join(home,'.codex','sessions','a.jsonl');
  const claude=path.join(home,'.claude','projects','fixture','a.jsonl');
  fs.mkdirSync(path.dirname(codex),{recursive:true});fs.mkdirSync(path.dirname(claude),{recursive:true});
  return {home,codex,claude,store:new Store(path.join(home,'data'),home)};
}
const jsonl=(events:any[])=>events.map(event=>JSON.stringify(event)).join('\n')+'\n';
function claude(id:string,input=100,model='known'){
  const event=claudeEvent({requestId:'request-'+id},{input_tokens:input});
  event.message.id=id;event.message.model=model;return event;
}

test('new, appended and cached files do not run a global record cleanup',async()=>{
  const f=fixture(),original=f.store.db.exec.bind(f.store.db);const sql:string[]=[];
  try{
    f.store.db.exec=(query:string)=>{sql.push(query);return original(query);};
    fs.writeFileSync(f.codex,jsonl([meta(),context(),codexEvent(counts())]));
    await scan(f.store,{home:f.home});
    fs.appendFileSync(f.codex,jsonl([codexEvent(counts(150,30,20,8),counts(50,10,10,4),3)]));
    await scan(f.store,{home:f.home});await scan(f.store,{home:f.home});
    assert.ok(!sql.some(query=>/DELETE FROM records/i.test(query)));
    assert.equal(f.store.records().reduce((n,r)=>n+r.input_tokens!,0),150);
  }finally{f.store.close();}
});

test('rewrite replaces exclusive counters and model even when the event identity is unchanged',async()=>{
  const f=fixture();try{
    fs.writeFileSync(f.claude,jsonl([claude('same',100,'old-model'),claude('removed')]));
    await scan(f.store,{home:f.home});
    fs.writeFileSync(f.claude,jsonl([claude('same',200,'new-model')]));
    await scan(f.store,{home:f.home});
    const rows=f.store.records();assert.equal(rows.length,1);assert.equal(rows[0].input_tokens,200);
    assert.equal(rows[0].model_raw,'new-model');assert.ok(!rows[0].notes.includes('duplicate-usage-disagreement'));
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM source_records').get()!.n,1);
  }finally{f.store.close();}
});

test('shared events survive rewriting one source and disappear only after their last association is removed',async()=>{
  const f=fixture(),other=path.join(path.dirname(f.claude),'b.jsonl');try{
    fs.writeFileSync(f.claude,jsonl([claude('shared'),claude('only-a')]));
    fs.writeFileSync(other,jsonl([claude('shared'),claude('only-b')]));await scan(f.store,{home:f.home});
    const shared=f.store.records().find(r=>r.id===f.store.db.prepare('SELECT id FROM source_records GROUP BY id HAVING COUNT(*)=2').get()!.id)!;
    fs.writeFileSync(f.claude,'');await scan(f.store,{home:f.home});
    assert.equal(f.store.records().length,2);assert.deepEqual(f.store.records().find(r=>r.id===shared.id),shared);
    fs.writeFileSync(other,'');await scan(f.store,{home:f.home});
    assert.deepEqual(f.store.records(),[]);assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM source_records').get()!.n,0);
    assert.equal(f.store.allCheckpoints().length,2);
  }finally{f.store.close();}
});

test('shared disagreements remain incomplete on rewrite instead of silently becoming priceable',async()=>{
  const f=fixture(),other=path.join(path.dirname(f.claude),'b.jsonl');try{
    fs.writeFileSync(f.claude,jsonl([claude('shared',100)]));fs.writeFileSync(other,jsonl([claude('shared',200)]));
    await scan(f.store,{home:f.home});const before=f.store.records();assert.equal(before[0].quality,'INCOMPLETE');
    fs.writeFileSync(f.claude,'');await scan(f.store,{home:f.home});
    assert.deepEqual(f.store.records(),before);assert.ok(before[0].notes.includes('duplicate-usage-disagreement'));
  }finally{f.store.close();}
});

for(const provider of ['codex','claude'] as const)for(const phase of ['put','checkpoint'] as const){
  test(`${provider} rewritten import rolls back records, associations and checkpoint after ${phase} failure`,async()=>{
    const f=fixture();try{
      const file=f[provider],events=provider==='codex'?[meta(),context(),codexEvent(counts())]:[claude('old')];
      fs.writeFileSync(file,jsonl(events));await scan(f.store,{home:f.home});
      const records=f.store.records(),checkpoints=f.store.allCheckpoints(),links=f.store.db.prepare('SELECT * FROM source_records ORDER BY ref,id').all();
      fs.writeFileSync(file,jsonl(provider==='codex'?[meta(),context('changed'),codexEvent(counts(250)),codexEvent(counts(300),counts(50),3)]:[claude('new',250),claude('new-2',50)]));
      const put=f.store.put.bind(f.store),checkpoint=f.store.saveCheckpoint.bind(f.store);
      if(phase==='put')f.store.put=(record,ref)=>{put(record,ref);throw new Error('Injected write failure');};
      else f.store.saveCheckpoint=cp=>{checkpoint(cp);throw new Error('Injected checkpoint failure');};
      const statuses=await scan(f.store,{home:f.home});
      assert.equal(statuses.find(s=>s.provider===provider)!.errors,1);
      assert.deepEqual(f.store.records(),records);assert.deepEqual(f.store.allCheckpoints(),checkpoints);
      assert.deepEqual(f.store.db.prepare('SELECT * FROM source_records ORDER BY ref,id').all(),links);
      f.store.put=put;f.store.saveCheckpoint=checkpoint;await scan(f.store,{home:f.home});
      assert.equal(f.store.records().length,2);assert.equal(f.store.statuses().find(s=>s.provider===provider)!.errors,0);
      assert.equal(f.store.records().reduce((n,r)=>n+r.input_tokens!,0),300);
    }finally{f.store.close();}
  });
}

test('failed append restores the previous cumulative baseline and retries exactly once',async()=>{
  const f=fixture();try{
    fs.writeFileSync(f.codex,jsonl([meta(),context(),codexEvent(counts())]));await scan(f.store,{home:f.home});
    const records=f.store.records(),checkpoints=f.store.allCheckpoints();
    fs.appendFileSync(f.codex,jsonl([codexEvent(counts(150,30,20,8),counts(50,10,10,4),3)]));
    const put=f.store.put.bind(f.store);f.store.put=(record,ref)=>{put(record,ref);throw new Error('Injected append failure');};
    await scan(f.store,{home:f.home});assert.deepEqual(f.store.records(),records);assert.deepEqual(f.store.allCheckpoints(),checkpoints);
    f.store.put=put;await scan(f.store,{home:f.home});assert.equal(f.store.records().length,2);
    assert.equal(f.store.records().reduce((n,r)=>n+r.input_tokens!,0),150);
  }finally{f.store.close();}
});

test('existing databases gain the association index without invalidating their checkpoints',async()=>{
  const f=fixture();let store=f.store;try{
    fs.writeFileSync(f.claude,jsonl([claude('old')]));await scan(store,{home:f.home});
    const records=store.records(),checkpoints=store.allCheckpoints();store.db.exec('DROP INDEX source_records_event');store.close();
    store=new Store(path.join(f.home,'data'),f.home);
    assert.ok(store.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='source_records_event'").get());
    let bytes=-1;const statuses=await scan(store,{home:f.home,onProgress:p=>{bytes=p.bytes;}});
    assert.equal(bytes,0);assert.equal(statuses[1].cached,1);assert.deepEqual(store.records(),records);assert.deepEqual(store.allCheckpoints(),checkpoints);
  }finally{store.close();}
});

// Reference implementation of the previous global cleanup, confined to fixtures.
class GlobalCleanupStore extends Store{
  override clearSource(ref:string){
    this.db.prepare('DELETE FROM source_records WHERE ref=?').run(ref);this.db.prepare('DELETE FROM sources WHERE ref=?').run(ref);
    this.db.exec('DELETE FROM records WHERE id NOT IN (SELECT id FROM source_records)');
  }
  override saveCheckpoint(cp:Checkpoint){super.saveCheckpoint(cp);this.db.exec('DELETE FROM records WHERE id NOT IN (SELECT id FROM source_records)');}
}
test('scoped cleanup produces identical records, coverage and reports to the previous global cleanup',async()=>{
  const f=fixture(),baseline=new GlobalCleanupStore(path.join(f.home,'baseline-data'),f.home);
  const other=path.join(path.dirname(f.claude),'b.jsonl'),range=dateRange('month',new Date('2026-10-15T12:00:00Z'));
  const settings=defaultSettings();settings.billing.codex={mode:'SUBSCRIPTION',monthly:100};settings.billing.claude={mode:'SUBSCRIPTION',monthly:20};
  const catalog=prices([price(),price({provider:'claude'})]);
  async function compare(){
    const statuses=await scan(f.store,{home:f.home}),oldStatuses=await scan(baseline,{home:f.home});
    assert.deepEqual(f.store.records(),baseline.records());assert.deepEqual(f.store.allCheckpoints(),baseline.allCheckpoints());assert.deepEqual(statuses,oldStatuses);
    assert.deepEqual(summarize(f.store.records(),statuses,settings,range,catalog),summarize(baseline.records(),oldStatuses,settings,range,catalog));
    assert.deepEqual(f.store.db.prepare('SELECT * FROM source_records ORDER BY ref,id').all(),baseline.db.prepare('SELECT * FROM source_records ORDER BY ref,id').all());
  }
  try{
    fs.writeFileSync(f.codex,jsonl([meta(),context(),codexEvent(counts()),codexEvent(counts(),counts(),3)]));
    fs.writeFileSync(f.claude,jsonl([claude('shared'),claude('only-a')]));fs.writeFileSync(other,jsonl([claude('shared'),claude('only-b')]));await compare();await compare();
    fs.appendFileSync(f.codex,jsonl([codexEvent(counts(150,30,20,8),counts(50,10,10,4),4),codexEvent(counts(20,5,10,4),counts(20,5,10,4),5)]));
    fs.appendFileSync(other,jsonl([claude('only-b',300)]));await compare();
    fs.writeFileSync(f.codex,jsonl([meta(),context('unmapped'),codexEvent({total_tokens:800},null)]));
    fs.writeFileSync(f.claude,jsonl([claude('shared',400)]));await compare();
    fs.writeFileSync(other,'');await compare();fs.writeFileSync(f.claude,'{malformed}\n');await compare();
    const pending=JSON.stringify(claude('partial'));fs.writeFileSync(f.claude,pending.slice(0,80));await compare();
    fs.appendFileSync(f.claude,pending.slice(80)+'\n');await compare();
    fs.renameSync(f.codex,path.join(f.home,'missing-source.jsonl'));await compare();
  }finally{f.store.close();baseline.close();}
});
