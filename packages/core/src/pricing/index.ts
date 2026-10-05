import type {Provider,UsageRecord} from '../types.ts';
import {currentPrices} from './current.ts';
export interface PriceVersion {
  provider:Provider; model:string; effective_from:string; effective_until:string|null;
  input:number; cached_input:number|null; cache_write:number|null; cache_write_5m:number|null; cache_write_1h:number|null; output:number;
  source:string; verified_at:string; context_threshold?:number|null;
  long_context?:{input:number;cached_input:number|null;cache_write:number|null;output:number};
  sources?:string[]; uncertain_days?:string[]; max_verified_context?:number;
}
export interface Mapping {canonical:string;confidence:'HIGH'|'MEDIUM';source:string;verified_at:string}
export interface Catalog {version:string;mappings:Record<Provider,Record<string,string|Mapping>>;prices:PriceVersion[]}
const verified='2026-10-05T00:00:00.000Z';
const openai='https://developers.openai.com/api/docs/pricing',anthropic='https://platform.claude.com/docs/en/about-claude/pricing';
const date=(day:string)=>day+'T00:00:00.000Z';
const changes='https://developers.openai.com/api/docs/changelog';
const claudeChanges='https://platform.claude.com/docs/en/release-notes/overview';
function claude(model:string,start:string,input:number,output:number,until:string|null=null,max?:number,transition=false):PriceVersion{return {provider:'claude',model,effective_from:date(start),effective_until:until?date(until):null,input,cached_input:input/10,cache_write:null,cache_write_5m:input*1.25,cache_write_1h:input*2,output,source:anthropic,sources:[anthropic,claudeChanges],verified_at:verified,uncertain_days:[...(transition?[start]:[]),...(until?[until]:[])],max_verified_context:max};}
function codex(model:string,start:string,input:number,cached:number,output:number,until:string|null=null,transition=false):PriceVersion{return {provider:'codex',model,effective_from:date(start),effective_until:until?date(until):null,input,cached_input:cached,cache_write:input*1.25,cache_write_5m:null,cache_write_1h:null,output,source:openai,sources:[openai,changes,`https://developers.openai.com/api/docs/models/${model}`],verified_at:verified,context_threshold:272000,long_context:{input:input*2,cached_input:cached*2,cache_write:input*2.5,output:output*1.5},uncertain_days:[...(transition?[start]:[]),...(until?[until]:[])]};}
const codexModels=['gpt-6-astra','gpt-6-sol','gpt-6.1-sol','gpt-6-luna','gpt-5.6-sol','gpt-5.6-terra','gpt-5.6-luna','gpt-5.3-codex'];
const claudeModels=['claude-fable-5','claude-fable-5-1','claude-mythos-5','claude-mythos-5-1','claude-mythos-preview','claude-opus-5-5','claude-opus-5','claude-opus-4-8','claude-opus-4-7','claude-opus-4-6','claude-opus-4-5-20251101','claude-opus-4-1-20250805','claude-opus-4-20250514','claude-sonnet-5','claude-sonnet-5-5','claude-sonnet-4-5-20250929','claude-sonnet-4-6','claude-sonnet-4-20250514','claude-3-7-sonnet-20250219','claude-haiku-4-5-20251001'];
const mappings=(models:string[],source:string)=>Object.fromEntries(models.map(canonical=>[canonical,{canonical,confidence:'HIGH' as const,source,verified_at:verified}]));
// A newly launched model has one documented initial rate: use it for API-equivalent
// estimates on its launch day. Actual changes between rates remain uncertain that day.
export const catalog:Catalog={version:'2026-10-05.2',mappings:{codex:{...mappings(codexModels,changes),...Object.fromEntries(currentPrices.map(p=>[p.model,{canonical:p.model,confidence:'HIGH' as const,source:p.source,verified_at:verified}]))},claude:mappings(claudeModels,claudeChanges)},prices:[
  codex('gpt-5.6-sol','2026-07-09',5,.5,30,'2026-08-21'),
  codex('gpt-5.6-sol','2026-08-21',4,.4,20,'2026-11-22',true), // Promotion confirmed at least through Nov 21. No invented post-promotion rate.
  codex('gpt-5.6-luna','2026-07-09',1,.1,6,'2026-07-30'),codex('gpt-5.6-luna','2026-07-30',.2,.02,1.2,null,true),
  codex('gpt-5.6-terra','2026-07-09',2.5,.25,15,'2026-07-30'),codex('gpt-5.6-terra','2026-07-30',2,.2,12,null,true),
  codex('gpt-6-astra','2026-09-03',10,1,50),codex('gpt-6-sol','2026-09-22',2,.2,10),codex('gpt-6-luna','2026-09-22',.1,.01,.5),codex('gpt-6.1-sol','2026-09-29',2,.1,10),
  {provider:'codex',model:'gpt-5.3-codex',effective_from:verified,effective_until:null,input:1.75,cached_input:.175,cache_write:null,cache_write_5m:null,cache_write_1h:null,output:14,source:openai,verified_at:verified},
  ...currentPrices,
  claude('claude-fable-5','2026-06-09',10,50,'2026-06-12'),claude('claude-fable-5','2026-07-01',10,50),claude('claude-opus-5','2026-07-24',5,25),claude('claude-opus-4-8','2026-05-28',5,25),claude('claude-opus-4-7','2026-04-16',5,25),
  // Long-context premium removal is dated March 13; preceding >200k requests
  // stay unavailable until their historical premium can be verified.
  claude('claude-opus-4-6','2026-02-05',5,25,'2026-03-13',200000),claude('claude-opus-4-6','2026-03-13',5,25,null,undefined,true),
  claude('claude-opus-4-5-20251101','2025-11-24',5,25,null,200000),claude('claude-sonnet-4-5-20250929','2025-09-29',3,15,null,200000),
  claude('claude-sonnet-4-6','2026-02-17',3,15,'2026-03-13',200000),claude('claude-sonnet-4-6','2026-03-13',3,15,null,undefined,true),
  claude('claude-sonnet-5','2026-06-30',2,10),claude('claude-sonnet-5-5','2026-09-28',2,10),
  {...claude('claude-opus-5-5','2026-09-22',4,20),cached_input:.2},
  {...claude('claude-fable-5-1','2026-09-01',10,50),cached_input:.25},
  {...claude('claude-mythos-5-1','2026-09-01',10,50),cached_input:.25},
  claude('claude-mythos-5','2026-06-09',10,50,'2026-06-12'),claude('claude-mythos-5','2026-07-01',10,50),
  claude('claude-haiku-4-5-20251001','2025-10-15',1,5,null,200000),
  {...claude('claude-opus-4-1-20250805','2025-08-05',15,75,'2026-08-05',200000),sources:[anthropic,'https://www.anthropic.com/news/claude-opus-4-1','https://platform.claude.com/docs/en/about-claude/model-deprecations']},
  {...claude('claude-opus-4-20250514','2025-05-22',15,75,'2026-06-15',200000),sources:[anthropic,'https://www.anthropic.com/news/claude-4','https://platform.claude.com/docs/en/about-claude/model-deprecations']},
  {...claude('claude-sonnet-4-20250514','2025-05-22',3,15,'2026-06-15',200000),sources:[anthropic,'https://www.anthropic.com/news/claude-4','https://platform.claude.com/docs/en/about-claude/model-deprecations']},
  {...claude('claude-3-7-sonnet-20250219','2025-02-24',3,15,'2026-02-19',200000),sources:[anthropic,'https://www.anthropic.com/news/claude-3-7-sonnet','https://platform.claude.com/docs/en/about-claude/model-deprecations']},
  // Published input/output tariff; cache rates and earlier billing start unverified.
  {provider:'claude',model:'claude-mythos-preview',effective_from:verified,effective_until:null,input:25,cached_input:null,cache_write:null,cache_write_5m:null,cache_write_1h:null,output:125,source:'https://www.anthropic.com/glasswing',verified_at:verified}
]};
// Explicit officially documented aliases only. No prefix matching or internal-model guesses.
for(const [raw,canonical] of Object.entries({'claude-opus-4-5':'claude-opus-4-5-20251101','claude-sonnet-4-5':'claude-sonnet-4-5-20250929','claude-haiku-4-5':'claude-haiku-4-5-20251001'}))catalog.mappings.claude[raw]={canonical,confidence:'HIGH',source:'https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions',verified_at:verified};
catalog.mappings.codex['gpt-5.6']={canonical:'gpt-5.6-sol',confidence:'HIGH',source:changes,verified_at:verified};
// The retired Haiku tariff is still published, but its historical reduction date
// is not established. Recognize the exact identity without backdating $0.80/$4.
catalog.mappings.claude['claude-3-5-haiku-20241022']={canonical:'claude-3-5-haiku-20241022',confidence:'HIGH',source:'https://platform.claude.com/docs/en/about-claude/model-deprecations',verified_at:verified};
export interface Priced {usd:number|null;canonical:string|null;reason:string|null;version:string|null;mapping?:Mapping;source?:string;effectiveFrom?:string}
export function priceRecord(r:UsageRecord,c:Catalog=catalog):Priced{
  const mapped=r.model_raw?c.mappings[r.provider][r.model_raw]:undefined;const mapping=typeof mapped==='object'?mapped:undefined;const canonical=typeof mapped==='string'?mapped:mapping?.canonical??null;const fail=(reason:string):Priced=>({usd:null,canonical,reason,version:null,mapping});
  if(!canonical)return fail('unresolved-model');if(!r.timestamp)return fail('timestamp-missing');
  const candidates=c.prices.filter(p=>p.provider===r.provider&&p.model===canonical&&r.timestamp!>=p.effective_from&&(!p.effective_until||r.timestamp!<p.effective_until));
  if(candidates.length!==1)return fail(candidates.length?'ambiguous-price-version':'historical-price-unavailable');let p=candidates[0];
  if(p.uncertain_days?.includes(r.timestamp.slice(0,10)))return fail('price-transition-day-uncertain');
  if(r.quality==='INCOMPLETE'||r.unallocated_total_tokens!==null)return fail('incomplete-token-components');
  if(r.input_tokens===null||r.cached_input_tokens===null||r.output_tokens===null||r.cache_creation_tokens===null)return fail('token-components-missing');
  if(r.service_tier&&!['standard','default'].includes(r.service_tier))return fail('service-tier-unavailable');
  if(r.speed&&r.speed!=='standard')return fail('speed-pricing-unavailable');
  if((r.web_search_requests??0)>0||(r.web_fetch_requests??0)>0)return fail('tool-pricing-unavailable');
  const context=r.provider==='claude'?r.input_tokens+r.cached_input_tokens+r.cache_creation_tokens:r.input_tokens;
  if(p.max_verified_context!==undefined&&context>p.max_verified_context)return fail('historical-context-price-unavailable');
  if(p.long_context){if(p.context_threshold==null)return fail('context-band-unverified');if(r.notes.includes('last-delta-disagreement'))return fail('request-context-ambiguous');if(context>p.context_threshold)p={...p,...p.long_context};}
  const cached=r.cached_input_tokens;if(cached>0&&p.cached_input===null)return fail('cache-read-price-unavailable');
  let input=r.input_tokens;
  // OpenAI reports cache reads and writes as mutually exclusive input subsets.
  // A cache write replaces ordinary input pricing; it is not an additive fee.
  if(r.provider==='codex'){input-=cached+r.cache_creation_tokens;if(input<0)return fail('invalid-cache-subset');}
  let usd=(input*p.input+cached*(p.cached_input??0)+r.output_tokens*p.output)/1e6;
  if(r.cache_creation_tokens>0){if(r.provider==='claude'){
    if(r.cache_creation_5m_tokens===null||r.cache_creation_1h_tokens===null||r.cache_creation_5m_tokens+r.cache_creation_1h_tokens!==r.cache_creation_tokens||p.cache_write_5m===null||p.cache_write_1h===null)return fail('cache-duration-price-unavailable');
    usd+=(r.cache_creation_5m_tokens*p.cache_write_5m+r.cache_creation_1h_tokens*p.cache_write_1h)/1e6;
  }else{if(p.cache_write===null)return fail('cache-write-price-unavailable');usd+=r.cache_creation_tokens*p.cache_write/1e6;}}
  // Reasoning is an output breakdown; never charge it a second time.
  return {usd,canonical,reason:null,version:c.version,mapping,source:p.source,effectiveFrom:p.effective_from};
}
