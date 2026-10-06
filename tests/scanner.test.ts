import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import path from 'node:path';
import {Store} from '../packages/core/src/storage.ts';import {scan} from '../packages/core/src/scanner.ts';import {sourceRoots,enumerate,openAllowedFile,applicationDirectory} from '../packages/core/src/security.ts';import {meta,context,codexEvent,counts,claudeEvent} from './helpers.ts';
function fixture(){fs.mkdirSync('artifacts',{recursive:true});const home=fs.mkdtempSync(path.resolve('artifacts/test-home-'));fs.mkdirSync(path.join(home,'.codex','sessions'),{recursive:true});fs.mkdirSync(path.join(home,'.claude','projects','fixture'),{recursive:true});const store=new Store(path.join(home,'subvalue-data'),home);return {home,store,codex:path.join(home,'.codex','sessions','rollout.jsonl'),claude:path.join(home,'.claude','projects','fixture','session.jsonl')};}
const jsonl=(records:any[])=>records.map(o=>JSON.stringify(o)).join('\n')+'\n';
test('cached scan avoids a second full stream and only checks fingerprints',async()=>{const f=fixture();try{fs.writeFileSync(f.codex,jsonl([meta(),context(),codexEvent(counts())]));let bytes=0;await scan(f.store,{home:f.home,onProgress:p=>{bytes=p.bytes;}});assert.equal(f.store.records().length,1);assert.ok(bytes>0);bytes=-1;const second=await scan(f.store,{home:f.home,onProgress:p=>{bytes=p.bytes;}});assert.equal(bytes,0);assert.equal(second[0].cached,1);}finally{f.store.close();}});
test('append processes only new bytes with previous cumulative baseline',async()=>{const f=fixture();try{fs.writeFileSync(f.codex,jsonl([meta(),context(),codexEvent(counts())]));await scan(f.store,{home:f.home});const before=fs.statSync(f.codex).size;const tail=jsonl([codexEvent(counts(150,30,20,8),counts(50,10,10,4),3)]);fs.appendFileSync(f.codex,tail);let bytes=0;await scan(f.store,{home:f.home,onProgress:p=>{bytes=p.bytes;}});assert.equal(bytes,Buffer.byteLength(tail));assert.equal(f.store.records().length,2);assert.equal(f.store.records().reduce((n,r)=>n+r.input_tokens!,0),150);assert.equal(f.store.allCheckpoints()[0].offset,before+Buffer.byteLength(tail));}finally{f.store.close();}});
test('partial final line is deferred and resumed without double counting',async()=>{const f=fixture();try{const first=jsonl([meta(),context(),codexEvent(counts())]);const tail=JSON.stringify(codexEvent(counts(150,30,20,8),counts(50,10,10,4),3));const cut=Math.floor(tail.length/2);fs.writeFileSync(f.codex,first+tail.slice(0,cut));await scan(f.store,{home:f.home});assert.equal(f.store.records().length,1);assert.equal(f.store.allCheckpoints()[0].offset,Buffer.byteLength(first));assert.equal(f.store.statuses()[0].diagnostics.partialTail,true);fs.appendFileSync(f.codex,tail.slice(cut)+'\n');await scan(f.store,{home:f.home});assert.equal(f.store.records().length,2);assert.equal(f.store.statuses()[0].diagnostics.partialTail,false);}finally{f.store.close();}});
test('multi-chunk UTF8 input checkpoints use byte offsets',async()=>{const f=fixture();try{const large={type:'response_item',payload:{content:'私'.repeat(800000)}};const input=jsonl([meta(),large,context(),codexEvent(counts())]);fs.writeFileSync(f.codex,input);await scan(f.store,{home:f.home});assert.equal(f.store.allCheckpoints()[0].offset,Buffer.byteLength(input));fs.appendFileSync(f.codex,jsonl([codexEvent(counts(200,40,20,8),counts(),4)]));await scan(f.store,{home:f.home});assert.equal(f.store.records().length,2);}finally{f.store.close();}});
test('metadata byte prefilter preserves whitespace, CRLF and markers across chunks',async()=>{
  const f=fixture();try{
    const first=jsonl([meta(),context()]),start='{"padding":"',suffix='","type" : "event_msg", "payload":{"type" : ';
    const padding=1024*1024-Buffer.byteLength(first+start+suffix)-5;
    const prefix=start+'x'.repeat(padding)+suffix+'"token_count","info":{"total_token_usage":'+JSON.stringify(counts())+'}},"timestamp":"2026-10-01T11:00:00Z"}\r\n';
    fs.writeFileSync(f.codex,first+prefix);await scan(f.store,{home:f.home});
    assert.equal(f.store.records().length,1);assert.equal(f.store.records()[0].input_tokens,100);assert.equal(f.store.allCheckpoints()[0].offset,Buffer.byteLength(first+prefix));
  }finally{f.store.close();}
});
test('1 MiB reads preserve a UTF8 character split at the block boundary for both providers',async()=>{
  const f=fixture(),original=fs.createReadStream;let streams=0;
  try{
    fs.createReadStream=((file:any,options:any)=>{assert.equal(options.highWaterMark,1024*1024);streams++;return original(file,options);}) as typeof fs.createReadStream;
    const codexStart=jsonl([meta(),context()])+'{"type":"response_item","payload":{"content":"';
    const codexPadding=1024*1024-1-Buffer.byteLength(codexStart);
    const codexInput=codexStart+'x'.repeat(codexPadding)+'私"}}\n'+jsonl([codexEvent(counts())]);
    const claude=claudeEvent(),header=JSON.stringify(claude).split('DO_NOT_STORE_PRIVATE_SENTINEL')[0];
    const claudePadding=1024*1024-1-Buffer.byteLength(header);
    const claudeInput=header+'x'.repeat(claudePadding)+'私'+JSON.stringify(claude).split('DO_NOT_STORE_PRIVATE_SENTINEL')[1]+'\n';
    for(const input of [codexInput,claudeInput])assert.equal(Buffer.from(input)[1024*1024-1],0xe7);
    fs.writeFileSync(f.codex,codexInput);fs.writeFileSync(f.claude,claudeInput);await scan(f.store,{home:f.home});
    assert.equal(streams,2);assert.equal(f.store.records().length,2);assert.ok(f.store.records().every(r=>r.input_tokens===100));
    for(const cp of f.store.allCheckpoints())assert.equal(cp.offset,cp.state.thread!==undefined?Buffer.byteLength(codexInput):Buffer.byteLength(claudeInput));
    assert.equal(f.store.statuses().reduce((n,s)=>n+s.errors+s.diagnostics.malformed,0),0);
  }finally{fs.createReadStream=original;f.store.close();}
});
test('CRLF split at the 1 MiB boundary and a partial next event resume without duplicate usage',async()=>{
  const f=fixture();try{
    const start=jsonl([meta(),context()])+'{"type":"response_item","padding":"',suffix='"}\r\n';
    const complete=start+'x'.repeat(1024*1024+1-Buffer.byteLength(start+suffix))+suffix;
    assert.equal(Buffer.from(complete)[1024*1024-1],13);assert.equal(Buffer.from(complete)[1024*1024],10);
    const next=JSON.stringify(codexEvent(counts())),cut=Math.floor(next.length/2);
    fs.writeFileSync(f.codex,complete+next.slice(0,cut));await scan(f.store,{home:f.home});
    assert.equal(f.store.records().length,0);assert.equal(f.store.allCheckpoints()[0].offset,Buffer.byteLength(complete));assert.equal(f.store.statuses()[0].diagnostics.partialTail,true);
    fs.appendFileSync(f.codex,next.slice(cut)+'\n');let bytes=0;await scan(f.store,{home:f.home,onProgress:p=>{bytes=p.bytes;}});
    assert.equal(bytes,Buffer.byteLength(next+'\n'));assert.equal(f.store.records().length,1);assert.equal(f.store.statuses()[0].diagnostics.partialTail,false);
    bytes=-1;await scan(f.store,{home:f.home,onProgress:p=>{bytes=p.bytes;}});assert.equal(bytes,0);assert.equal(f.store.records().length,1);
  }finally{f.store.close();}
});
test('large conversation and oversized lines leave counting and append checkpoints unchanged',async()=>{
  const f=fixture();try{
    const large={type:'response_item',payload:{content:'x'.repeat(3*1024*1024)}};
    const oversized={type:'response_item',payload:{content:'x'.repeat(16*1024*1024)}};
    const input=jsonl([meta(),large,oversized,context(),codexEvent(counts())]);fs.writeFileSync(f.codex,input);await scan(f.store,{home:f.home});
    assert.equal(f.store.records().length,1);assert.equal(f.store.statuses()[0].diagnostics.oversize,1);assert.equal(f.store.statuses()[0].errors,0);
    assert.equal(f.store.allCheckpoints()[0].offset,Buffer.byteLength(input));
    const tail=jsonl([codexEvent(counts(150,30,20,8),counts(50,10,10,4),3)]);fs.appendFileSync(f.codex,tail);let bytes=0;await scan(f.store,{home:f.home,onProgress:p=>{bytes=p.bytes;}});
    assert.equal(bytes,Buffer.byteLength(tail));assert.equal(f.store.records().reduce((n,r)=>n+r.input_tokens!,0),150);
    assert.ok(!JSON.stringify(f.store.allCheckpoints()).includes('x'.repeat(100)));
  }finally{f.store.close();}
});
test('rewritten source replaces old records rather than accumulating stale usage',async()=>{const f=fixture();try{fs.writeFileSync(f.codex,jsonl([meta(),context(),codexEvent(counts())]));await scan(f.store,{home:f.home});fs.writeFileSync(f.codex,jsonl([meta(),context(),codexEvent(counts(200,40,20,8))]));await scan(f.store,{home:f.home});assert.equal(f.store.records().length,1);assert.equal(f.store.records()[0].input_tokens,200);}finally{f.store.close();}});
test('Claude repeated identities deduplicate in persistent storage',async()=>{const f=fixture();try{fs.writeFileSync(f.claude,jsonl([claudeEvent(),claudeEvent(),claudeEvent()]));await scan(f.store,{home:f.home});assert.equal(f.store.records().length,1);assert.equal(f.store.statuses()[1].diagnostics.repeated,2);}finally{f.store.close();}});
test('conflicting duplicate usage is flagged instead of summed',async()=>{const f=fixture();try{fs.writeFileSync(f.claude,jsonl([claudeEvent(),claudeEvent({}, {output_tokens:30})]));await scan(f.store,{home:f.home});assert.equal(f.store.records().length,1);assert.equal(f.store.records()[0].quality,'INCOMPLETE');assert.ok(f.store.records()[0].notes.includes('duplicate-usage-disagreement'));}finally{f.store.close();}});
test('malformed usage lines do not crash either provider',async()=>{const f=fixture();try{fs.writeFileSync(f.codex,jsonl([meta(),context()])+'{"type":"event_msg","payload":{"type":"token_count"}\n'+jsonl([codexEvent(counts())]));fs.writeFileSync(f.claude,'{bad json}\n'+jsonl([claudeEvent()]));await scan(f.store,{home:f.home});assert.equal(f.store.records().length,2);assert.equal(f.store.statuses()[0].diagnostics.malformed,1);assert.equal(f.store.statuses()[1].diagnostics.malformed,1);}finally{f.store.close();}});
test('credentials and project paths are never source candidates',async()=>{const f=fixture();try{fs.writeFileSync(path.join(f.home,'.codex','auth.json'),'CREDENTIAL_SENTINEL');fs.writeFileSync(path.join(f.home,'.claude','projects','fixture','private.md'),'SOURCE_SENTINEL');fs.writeFileSync(f.codex,jsonl([meta(),context(),codexEvent(counts())]));await scan(f.store,{home:f.home});const normalized=JSON.stringify(f.store.records())+JSON.stringify(f.store.allCheckpoints());assert.ok(!normalized.includes('SENTINEL'));assert.ok(!normalized.includes('private-fixture'));assert.equal(f.store.allCheckpoints().length,1);const root=sourceRoots(f.home)[0];assert.throws(()=>openAllowedFile(root,path.join(f.home,'.codex','auth.json')));}finally{f.store.close();}});
test('conversation text colocated with usage never enters any persisted application table',async()=>{
  const f=fixture();try{
    const secret='PRIVATE_CONVERSATION_DO_NOT_RETAIN';const claude=claudeEvent();claude.message.content=[{text:secret}];
    fs.writeFileSync(f.codex,jsonl([meta({instructions:secret}),context('known',{instructions:secret}),{type:'response_item',payload:{content:secret}},codexEvent(counts())]));
    fs.writeFileSync(f.claude,jsonl([claude]));await scan(f.store,{home:f.home});
    assert.equal(f.store.records().length,2);
    const persisted=JSON.stringify([f.store.db.prepare('SELECT data FROM records').all(),f.store.db.prepare('SELECT checkpoint FROM sources').all(),f.store.db.prepare('SELECT data FROM app').all()]);
    assert.ok(!persisted.includes(secret));assert.ok(!persisted.includes('private-fixture'));
    assert.ok(f.store.records().every(r=>r.input_tokens===100));
  }finally{f.store.close();}
});
test('outside junction is skipped and never traversed',()=>{const f=fixture();try{const outside=path.join(f.home,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'private.jsonl'),'SECRET');fs.symlinkSync(outside,path.join(f.home,'.codex','sessions','linked'),process.platform==='win32'?'junction':'dir');const result=enumerate(sourceRoots(f.home)[0]);assert.equal(result.files.length,0);assert.equal(result.skippedLinks,1);}finally{f.store.close();}});
test('source-root junction is rejected',()=>{const f=fixture();try{const outside=path.join(f.home,'outside');fs.mkdirSync(outside);fs.mkdirSync(path.join(f.home,'.codex','archived_sessions'),{recursive:true});const link=path.join(f.home,'.claude','linked-projects');fs.symlinkSync(outside,link,process.platform==='win32'?'junction':'dir');const result=enumerate({provider:'claude',directory:link,safeLabel:'~/.claude/projects/**/*.jsonl'});assert.equal(result.files.length,0);assert.equal(result.skippedLinks,1);}finally{f.store.close();}});
test('application database cannot be placed among source files',()=>{const f=fixture();try{assert.throws(()=>applicationDirectory(path.join(f.home,'.codex','sessions','subvalue'),f.home));assert.throws(()=>applicationDirectory(f.home,f.home));}finally{f.store.close();}});
test('deleted source retains cached usage with explicit missing-files status',async()=>{const f=fixture();try{fs.writeFileSync(f.codex,jsonl([meta(),context(),codexEvent(counts())]));await scan(f.store,{home:f.home});fs.renameSync(f.codex,path.join(f.home,'moved-fixture.jsonl'));await scan(f.store,{home:f.home});assert.equal(f.store.records().length,1);assert.equal(f.store.statuses()[0].missingFiles,1);}finally{f.store.close();}});
test('database and SQLite sidecar junctions cannot redirect storage',()=>{const f=fixture();try{const outside=path.join(f.home,'outside');fs.mkdirSync(outside);for(const suffix of ['', '-wal','-shm','-journal']){const directory=path.join(f.home,'linked-db'+(suffix||'-main'));fs.mkdirSync(directory);fs.symlinkSync(outside,path.join(directory,'subvalue.sqlite'+suffix),process.platform==='win32'?'junction':'dir');assert.throws(()=>new Store(directory,f.home),/links/);}}finally{f.store.close();}});
test('an empty source creates a safe checkpoint without opening a stream',async()=>{const f=fixture();try{fs.writeFileSync(f.codex,'');await scan(f.store,{home:f.home});assert.equal(f.store.records().length,0);assert.equal(f.store.allCheckpoints()[0].offset,0);assert.equal(f.store.statuses()[0].errors,0);}finally{f.store.close();}});
test('observed source content opens are restricted to approved JSONL files',async()=>{const f=fixture();const original=fs.openSync;const opened:string[]=[];try{fs.writeFileSync(f.codex,jsonl([meta(),context(),codexEvent(counts())]));fs.writeFileSync(f.claude,jsonl([claudeEvent()]));fs.writeFileSync(path.join(f.home,'.codex','auth.json'),'CREDENTIAL_SENTINEL');fs.writeFileSync(path.join(f.home,'.claude','projects','fixture','.env'),'ENV_SENTINEL');fs.openSync=((file:any,...args:any[])=>{opened.push(String(file));return (original as any)(file,...args);}) as typeof fs.openSync;const result=await scan(f.store,{home:f.home});assert.deepEqual(new Set(opened),new Set([f.codex,f.claude]));assert.equal(result.reduce((n,s)=>n+s.errors,0),0);}finally{fs.openSync=original;f.store.close();}});

test('persistent metadata omits unnecessary identities and projects while preserving duplicate checks',async()=>{
  const f=fixture();try{
    fs.writeFileSync(f.codex,jsonl([meta(),context(),codexEvent(counts())]));fs.writeFileSync(f.claude,jsonl([claudeEvent(),claudeEvent()]));await scan(f.store,{home:f.home});
    const records=f.store.records();assert.equal(records.length,2);
    for(const record of records){assert.equal(record.session_id,null);assert.equal(record.thread_id,null);assert.equal(record.project_identifier_hash,null);}
    const claude=records.find(record=>record.provider==='claude')!;assert.match(claude.request_id!,/^svh:[a-f0-9]{64}$/);
    const checkpoints=f.store.allCheckpoints();for(const checkpoint of checkpoints){assert.ok(!JSON.stringify(checkpoint).includes('private-fixture'));if(checkpoint.state.thread!==undefined){assert.equal(checkpoint.state.session,null);assert.equal(checkpoint.state.project,null);assert.equal(checkpoint.state.turn,null);}}
    fs.appendFileSync(f.claude,jsonl([claudeEvent(),claudeEvent({}, {output_tokens:30})]));await scan(f.store,{home:f.home});assert.equal(f.store.records().length,2);assert.equal(f.store.records().find(record=>record.provider==='claude')!.quality,'INCOMPLETE');
  }finally{f.store.close();}
});

test('legacy metadata migration preserves event keys, counters and incremental checkpoints',async()=>{
  const f=fixture();let store=f.store;try{
    fs.writeFileSync(f.codex,jsonl([meta(),context(),codexEvent(counts())]));fs.writeFileSync(f.claude,jsonl([claudeEvent()]));await scan(store,{home:f.home});
    const before=store.records();for(const record of before){const legacy={...record,session_id:'LEGACY_SESSION',thread_id:'LEGACY_THREAD',project_identifier_hash:'LEGACY_PROJECT',request_id:record.provider==='claude'?'req-a':null,unexpected:'PRIVATE_CONTENT_SENTINEL'};store.db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(legacy),record.id);}
    const checkpoints=store.allCheckpoints();for(const checkpoint of checkpoints){const legacy={...checkpoint,state:{...checkpoint.state,project:'LEGACY_PROJECT',session:'LEGACY_SESSION',turn:'LEGACY_TURN',unexpected:'PRIVATE_CONTENT_SENTINEL'}};store.db.prepare('UPDATE sources SET checkpoint=? WHERE ref=?').run(JSON.stringify(legacy),checkpoint.ref);}
    store.db.prepare("DELETE FROM app WHERE key='privacyMetadataVersion'").run();store.close();store=new Store(path.join(f.home,'subvalue-data'),f.home);
    const migrated=store.records();assert.deepEqual(migrated.map(record=>record.id),before.map(record=>record.id));assert.deepEqual(migrated.map(record=>record.total_tokens),before.map(record=>record.total_tokens));assert.ok(!JSON.stringify([migrated,store.allCheckpoints()]).includes('LEGACY_'));assert.ok(!JSON.stringify([migrated,store.allCheckpoints()]).includes('PRIVATE_CONTENT_SENTINEL'));
    let bytes=-1;await scan(store,{home:f.home,onProgress:progress=>{bytes=progress.bytes;}});assert.equal(bytes,0,'Migration never re-reads the histories');assert.deepEqual(store.allCheckpoints().map(checkpoint=>checkpoint.offset),checkpoints.map(checkpoint=>checkpoint.offset));
    fs.appendFileSync(f.codex,jsonl([codexEvent(counts(150,30,20,8),counts(50,10,10,4),3)]));fs.appendFileSync(f.claude,jsonl([claudeEvent()]));await scan(store,{home:f.home});assert.equal(store.records().length,3);assert.equal(store.records().filter(record=>record.provider==='codex').reduce((n,record)=>n+record.input_tokens!,0),150);
  }finally{store.close();}
});
