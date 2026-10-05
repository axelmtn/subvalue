import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {applicationDirectory} from './security.ts';
import {defaultSettings,type Settings,type UsageRecord,type SourceStatus} from './types.ts';
export interface Checkpoint {ref:string;size:number;mtime:number;offset:number;line:number;head:string;tail:string;state:any;identity:string}
export class Store {
  db:DatabaseSync;
  constructor(directory:string,home?:string){const safe=applicationDirectory(directory,home);fs.mkdirSync(safe,{recursive:true,mode:0o700});const target=path.join(safe,'subvalue.sqlite');for(const file of [target,target+'-wal',target+'-shm',target+'-journal']){try{if(fs.lstatSync(file).isSymbolicLink())throw new Error('Database links are not allowed');}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}this.db=new DatabaseSync(target);this.db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=2000;
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,provider TEXT NOT NULL,timestamp TEXT,data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS records_period ON records(timestamp,provider);
    CREATE TABLE IF NOT EXISTS sources(ref TEXT PRIMARY KEY,checkpoint TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS source_records(ref TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(ref,id));
    CREATE TABLE IF NOT EXISTS app(key TEXT PRIMARY KEY,data TEXT NOT NULL);
    PRAGMA user_version=1;
  `);try{fs.chmodSync(target,0o600);}catch{/* Windows ACLs inherit from the user directory. */}}
  checkpoint(ref:string):Checkpoint|null{const r=this.db.prepare('SELECT checkpoint FROM sources WHERE ref=?').get(ref);return r?JSON.parse(String(r.checkpoint)):null;}
  saveCheckpoint(c:Checkpoint){this.db.prepare('INSERT OR REPLACE INTO sources VALUES (?,?)').run(c.ref,JSON.stringify(c));}
  clearSource(ref:string){this.db.prepare('DELETE FROM source_records WHERE ref=?').run(ref);this.db.prepare('DELETE FROM sources WHERE ref=?').run(ref);}
  put(r:UsageRecord,ref:string):'new'|'duplicate'|'conflict'{
    const old=this.db.prepare('SELECT data FROM records WHERE id=?').get(r.id);let result:'new'|'duplicate'|'conflict'='new';
    if(old){const prev=JSON.parse(String(old.data)) as UsageRecord;const usageKeys=['input_tokens','cached_input_tokens','cache_creation_tokens','cache_creation_5m_tokens','cache_creation_1h_tokens','output_tokens','reasoning_tokens','model_raw','request_id','total_tokens'] as const;
      const different=usageKeys.some(k=>prev[k]!==r[k]);result=different?'conflict':'duplicate';
      if(different){prev.quality='INCOMPLETE';if(!prev.notes.includes('duplicate-usage-disagreement'))prev.notes.push('duplicate-usage-disagreement');this.db.prepare('UPDATE records SET data=? WHERE id=?').run(JSON.stringify(prev),r.id);}
    }else this.db.prepare('INSERT INTO records VALUES (?,?,?,?)').run(r.id,r.provider,r.timestamp,JSON.stringify(r));
    this.db.prepare('INSERT OR IGNORE INTO source_records VALUES (?,?)').run(ref,r.id);return result;
  }
  collectOrphans(){this.db.exec('DELETE FROM records WHERE id NOT IN (SELECT id FROM source_records)');}
  records(from?:string,until?:string):UsageRecord[]{const rows=from&&until?this.db.prepare('SELECT data FROM records WHERE timestamp>=? AND timestamp<? ORDER BY timestamp,id').all(from,until):this.db.prepare('SELECT data FROM records ORDER BY timestamp,id').all();return rows.map(r=>JSON.parse(String(r.data)));}
  revision():string{return `${this.db.prepare('PRAGMA data_version').get()!.data_version}:${this.db.prepare('SELECT total_changes() AS changes').get()!.changes}`;}
  allCheckpoints():Checkpoint[]{return this.db.prepare('SELECT checkpoint FROM sources').all().map(r=>JSON.parse(String(r.checkpoint)));}
  settings():Settings{const r=this.db.prepare("SELECT data FROM app WHERE key='settings'").get();return r?JSON.parse(String(r.data)):defaultSettings();}
  saveSettings(s:Settings){this.save('settings',s);}
  save(key:string,value:unknown){this.db.prepare('INSERT OR REPLACE INTO app VALUES (?,?)').run(key,JSON.stringify(value));}
  get<T>(key:string):T|null{const r=this.db.prepare('SELECT data FROM app WHERE key=?').get(key);return r?JSON.parse(String(r.data)):null;}
  statuses():SourceStatus[]{return this.get<SourceStatus[]>('sources')??[];}
  close(){this.db.close();}
}
