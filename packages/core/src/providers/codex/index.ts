import {baseRecord,hash,identifier,modelId,timestamp,token,track} from '../../metadata.ts';
import {emptyDiagnostics,type Diagnostics,type UsageRecord} from '../../types.ts';
type Counters = Record<string, number | null>;
export interface CodexState {thread: string|null;session:string|null;model:string|null;project:string|null;boundary:number|null;previous:Counters|null;turn:string|null;segment:number; diagnostics:Diagnostics}
export const codexState = (): CodexState => ({thread:null,session:null,model:null,project:null,boundary:null,previous:null,turn:null,segment:0,diagnostics:emptyDiagnostics()});
const keys = ['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'];
const counters = (v: any): Counters | null => v && typeof v==='object' ? Object.fromEntries(keys.map(k=>[k,token(v[k])])) : null;
export function parseCodex(o: any, s: CodexState, ref: string, lineNumber: number): UsageRecord | null {
  if(!o || typeof o!=='object')return null;const p=o.payload;
  if(!p || typeof p!=='object')return null;
  // Inherited metadata must not overwrite the child's identity or model either.
  if(s.boundary!==null&&token(o.ordinal)!==null&&o.ordinal<s.boundary){if(o.type==='event_msg'&&p.type==='token_count')s.diagnostics.inherited++;return null;}
  if(o.type==='session_meta'){
    const thread=identifier(p.id);if(thread&&s.thread&&thread!==s.thread){s.previous=null;s.boundary=null;s.model=null;s.project=null;s.turn=null;s.segment++;}
    s.thread=thread??s.thread;s.session=identifier(p.session_id)??s.thread;
    if(typeof p.cwd==='string')s.project=hash('project',p.cwd);
    s.boundary=token(p.subagent_history_start_ordinal)??s.boundary;
    s.model=modelId(p.model)??s.model;return null;
  }
  if(o.type==='turn_context') {s.model=modelId(p.model)??s.model;s.turn=identifier(p.turn_id)??s.turn;if(typeof p.cwd==='string')s.project=hash('project',p.cwd);return null;}
  if(o.type!=='event_msg'||p.type!=='token_count')return null;
  if(s.boundary!==null){if(token(o.ordinal)===null){s.diagnostics.unsupported++;return null;}if(o.ordinal<s.boundary){s.diagnostics.inherited++;return null;}}
  const info=p.info;if(!info || typeof info!=='object'){s.diagnostics.unsupported++;return null;}
  const total=counters(info.total_token_usage),last=counters(info.last_token_usage);let usage:Counters|null=null;let method='last';const notes:string[]=[];
  if(total&&s.previous){
    const comparable=keys.filter(k=>total[k]!==null&&s.previous![k]!==null);
    if(comparable.length&&comparable.every(k=>total[k]===s.previous![k])){s.diagnostics.repeated++;return null;}
    if(comparable.some(k=>total[k]!<s.previous![k]!)){
      s.segment++;s.diagnostics.resets++;notes.push('counter-reset');usage=last;method='reset-last';
      if(!usage){usage={...total};notes.push('reset-without-last');}
    }else{
      usage=Object.fromEntries(keys.map(k=>[k,total[k]!==null&&s.previous![k]!==null?total[k]!-s.previous![k]!:null]));method='cumulative-delta';
      if(last&&keys.some(k=>usage![k]!==null&&last[k]!==null&&usage![k]!==last[k]))notes.push('last-delta-disagreement');
    }
  }else if(last){usage=last;if(total&&keys.some(k=>last[k]!==null&&total[k]!==null&&last[k]!==total[k]))notes.push('nonzero-starting-baseline');}
  else if(total){usage=total;method='initial-cumulative';notes.push('initial-cumulative-only');}
  if(total)s.previous=total;
  if(!usage){s.diagnostics.unsupported++;return null;}
  const event=hash(s.thread??ref,token(o.ordinal)??lineNumber,timestamp(o.timestamp),s.segment,usage);
  const r=baseRecord('codex',ref,event);r.timestamp=timestamp(o.timestamp);r.thread_id=s.thread;r.session_id=s.session;r.request_id=null;r.model_raw=s.model;r.project_identifier_hash=s.project;r.source_schema=`codex.token_count.v1/${method}`;r.notes=notes;
  r.input_tokens=usage.input_tokens;r.cached_input_tokens=usage.cached_input_tokens;r.cache_creation_tokens=usage.cache_write_input_tokens;r.output_tokens=usage.output_tokens;r.reasoning_tokens=usage.reasoning_output_tokens;r.total_tokens=usage.total_tokens;
  // A positive total with zero components is not a zero-token request.
  if(r.total_tokens!==null&&r.input_tokens!==null&&r.output_tokens!==null&&r.total_tokens!==r.input_tokens+r.output_tokens){
    r.unallocated_total_tokens=Math.max(0,r.total_tokens-r.input_tokens-r.output_tokens);r.notes.push('unallocated-total');r.quality='INCOMPLETE';
    if(r.input_tokens===0&&r.output_tokens===0&&r.total_tokens>0){r.input_tokens=null;r.output_tokens=null;r.cached_input_tokens=null;r.reasoning_tokens=null;r.cache_creation_tokens=null;}
  }
  if(r.input_tokens===null||r.cached_input_tokens===null||r.cache_creation_tokens===null||r.output_tokens===null||!r.timestamp||!r.model_raw)r.quality='INCOMPLETE';
  if(r.cached_input_tokens!==null&&r.input_tokens!==null&&r.cached_input_tokens>r.input_tokens){r.quality='INCOMPLETE';r.notes.push('invalid-cache-subset');}
  if(notes.includes('initial-cumulative-only')||notes.includes('reset-without-last'))r.quality='INCOMPLETE';
  if(r.quality==='HIGH'&&notes.length)r.quality='MEDIUM';track(s.diagnostics,r);return r;
}
