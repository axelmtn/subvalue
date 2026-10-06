import {DatabaseSync,type StatementSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {applicationDirectory} from './security.ts';
import {baseRecord,hash} from './metadata.ts';
import {defaultSettings,emptyDiagnostics,type Settings,type UsageRecord,type SourceStatus} from './types.ts';
export interface Checkpoint {ref:string;size:number;mtime:number;offset:number;line:number;head:string;tail:string;state:any;identity:string}
function privateRecord(record:UsageRecord):UsageRecord{
  const result=baseRecord(record.provider,'','');
  for(const key of Object.keys(result) as (keyof UsageRecord)[])if(Object.hasOwn(record,key))(result as any)[key]=record[key];
  // These identities and project associations are not used by the V1 dashboard.
  result.session_id=null;result.thread_id=null;result.project_identifier_hash=null;
  const request=result.request_id;result.request_id=request===null?null:/^svh:[a-f0-9]{64}$/.test(request)?request:'svh:'+hash('request',request);
  return result;
}
function privateCheckpoint(checkpoint:Checkpoint):Checkpoint{
  const state=checkpoint.state;const diagnostics=emptyDiagnostics();
  for(const key of Object.keys(diagnostics) as (keyof typeof diagnostics)[])if(Object.hasOwn(state.diagnostics,key))(diagnostics as any)[key]=state.diagnostics[key];
  // Codex's thread identity is needed to preserve its existing deduplication keys.
  // Other identities/project fields are unnecessary for incremental token counters.
  const next=state.thread!==undefined?{thread:state.thread,session:null,model:state.model,project:null,boundary:state.boundary,previous:state.previous===null?null:Object.fromEntries(['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'].map(key=>[key,state.previous[key]??null])),turn:null,segment:state.segment,diagnostics}:{diagnostics};
  return {ref:checkpoint.ref,size:checkpoint.size,mtime:checkpoint.mtime,offset:checkpoint.offset,line:checkpoint.line,head:checkpoint.head,tail:checkpoint.tail,state:next,identity:checkpoint.identity};
}
export class Store {
  db:DatabaseSync;
  private statements=new Map<string,StatementSync>();
  private statement(sql:string):StatementSync{let statement=this.statements.get(sql);if(!statement){statement=this.db.prepare(sql);this.statements.set(sql,statement);}return statement;}
  constructor(directory:string,home?:string){const safe=applicationDirectory(directory,home);fs.mkdirSync(safe,{recursive:true,mode:0o700});const target=path.join(safe,'subvalue.sqlite');for(const file of [target,target+'-wal',target+'-shm',target+'-journal']){try{if(fs.lstatSync(file).isSymbolicLink())throw new Error('Database links are not allowed');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}this.db=new DatabaseSync(target);this.db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2000;
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,provider TEXT NOT NULL,timestamp TEXT,data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS records_period ON records(timestamp,provider);
    CREATE TABLE IF NOT EXISTS sources(ref TEXT PRIMARY KEY,checkpoint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS source_records(ref TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(ref,id));
    CREATE INDEX IF NOT EXISTS source_records_event ON source_records(id,ref);
    CREATE TABLE IF NOT EXISTS app(key TEXT PRIMARY KEY,data TEXT NOT NULL);
    PRAGMA user_version=1;
  `);try{fs.chmodSync(target,0o600);}catch{/* Windows ACLs inherit from the user directory. */}
    if(this.get('privacyMetadataVersion')!==1){this.db.exec('BEGIN IMMEDIATE');try{
      for(const row of this.statement('SELECT id,data FROM records').iterate())this.statement('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(privateRecord(JSON.parse(String(row.data)))),row.id!);
      for(const checkpoint of this.allCheckpoints())this.saveCheckpoint(checkpoint);
      this.save('privacyMetadataVersion',1);this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');this.db.close();throw error;}}
  }
  checkpoint(ref:string):Checkpoint|null{const r=this.statement('SELECT checkpoint FROM sources WHERE ref=?').get(ref);return r?JSON.parse(String(r.checkpoint)):null;}
  saveCheckpoint(c:Checkpoint){this.statement('INSERT OR REPLACE INTO sources VALUES (?,?)').run(c.ref,JSON.stringify(privateCheckpoint(c)));}
  // The scanner calls this inside its import transaction. Only this source's
  // exclusive records are removed; shared events keep their deduplication state.
  // Delete before reimport so a rewritten event cannot retain stale counters.
  clearSource(ref:string){
    this.statement(`DELETE FROM records WHERE id IN (SELECT id FROM source_records WHERE ref=?)
      AND NOT EXISTS (SELECT 1 FROM source_records WHERE id=records.id AND ref<>?)`).run(ref,ref);
    this.statement('DELETE FROM source_records WHERE ref=?').run(ref);
    this.statement('DELETE FROM sources WHERE ref=?').run(ref);
  }
  put(r:UsageRecord,ref:string):'new'|'duplicate'|'conflict'{
    r=privateRecord(r);
    const old=this.statement('SELECT data FROM records WHERE id=?').get(r.id);let result:'new'|'duplicate'|'conflict'='new';
    if(old){const prev=JSON.parse(String(old.data)) as UsageRecord;const usageKeys=['input_tokens','cached_input_tokens','cache_creation_tokens','cache_creation_5m_tokens','cache_creation_1h_tokens','output_tokens','reasoning_tokens','model_raw','request_id','total_tokens'] as const;
      const different=usageKeys.some(k=>prev[k]!==r[k]);result=different?'conflict':'duplicate';
      if(different){prev.quality='INCOMPLETE';if(!prev.notes.includes('duplicate-usage-disagreement'))prev.notes.push('duplicate-usage-disagreement');this.statement('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(prev),r.id);}
    }else this.statement('INSERT INTO records VALUES (?,?,?,?)').run(r.id,r.provider,r.timestamp,JSON.stringify(r));
    this.statement('INSERT OR IGNORE INTO source_records VALUES (?,?)').run(ref,r.id);return result;
  }
  records(from?:string,until?:string):UsageRecord[]{const rows=from&&until?this.statement('SELECT data FROM records WHERE timestamp>=? AND timestamp<? ORDER BY timestamp,id').all(from,until):this.statement('SELECT data FROM records ORDER BY timestamp,id').all();return rows.map(r=>JSON.parse(String(r.data)));}
  revision():string{return `${this.statement('PRAGMA data_version').get()!.data_version}:${this.statement('SELECT total_changes() AS changes').get()!.changes}`;}
  allCheckpoints():Checkpoint[]{return this.statement('SELECT checkpoint FROM sources').all().map(r=>JSON.parse(String(r.checkpoint)));}
  settings():Settings{const r=this.statement("SELECT data FROM app WHERE key='settings'").get();return r?JSON.parse(String(r.data)):defaultSettings();}
  saveSettings(s:Settings){this.save('settings',s);}
  save(key:string,value:unknown){this.statement('INSERT OR REPLACE INTO app VALUES (?,?)').run(key,JSON.stringify(value));}
  get<T>(key:string):T|null{const r=this.statement('SELECT data FROM app WHERE key=?').get(key);return r?JSON.parse(String(r.data)):null;}
  statuses():SourceStatus[]{return this.get<SourceStatus[]>('sources')??[];}
  close(){this.db.close();}
}
