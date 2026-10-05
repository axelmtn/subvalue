import {baseRecord} from './metadata.ts';
import {catalog,type Catalog} from './pricing/index.ts';
import {defaultSettings,emptyDiagnostics,type Settings,type UsageRecord,type SourceStatus} from './types.ts';
export function demoData(now=new Date()):{records:UsageRecord[];settings:Settings;statuses:SourceStatus[];catalog:Catalog}{
  const records:UsageRecord[]=[];const monthDays=now.getDate();const weights=Array.from({length:monthDays},(_,i)=>[4,6,5,8,7,10,6,8,11,9][i%10]);const sum=weights.reduce((a,b)=>a+b,0);let assigned=0;
  for(let i=0;i<monthDays;i++){const r=baseRecord('codex','fixture-only',`fixture-${i}`);const output=i===monthDays-1?20530000-assigned:Math.floor(20530000*weights[i]/sum);assigned+=output;r.timestamp=new Date(now.getFullYear(),now.getMonth(),i+1,12).toISOString();r.model_raw='gpt-5.3-codex';r.session_id='fixture-session';r.input_tokens=0;r.cached_input_tokens=0;r.cache_creation_tokens=0;r.output_tokens=output;r.reasoning_tokens=0;r.total_tokens=output;r.source_schema='DEMO/fixture';r.notes=['demo-fixture'];records.push(r);}
  const settings=defaultSettings();settings.onboarded=true;settings.billing.codex={mode:'SUBSCRIPTION',monthly:200};
  const statuses=(['codex','claude'] as const).map(provider=>({provider,detected:true,files:provider==='codex'?1:0,scanned:0,cached:0,errors:0,skippedLinks:0,missingFiles:0,diagnostics:emptyDiagnostics()}));
  const demoCatalog:Catalog={...catalog,version:'DEMO — fixture prices',prices:catalog.prices.map(p=>({...p,effective_from:'2000-01-01T00:00:00.000Z'}))};return {records,settings,statuses,catalog:demoCatalog};
}
