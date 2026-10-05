import type {Provider} from './types.ts';
export interface SubscriptionPlan {id:string;provider:Provider;name:string;monthly:number;interval:'monthly'|'annual';annual?:number;perSeat?:boolean;source:string}
export const subscriptionVerified='2026-10-05';
const openai='https://learn.chatgpt.com/docs/pricing',claude='https://claude.com/pricing';
export const subscriptionPlans:SubscriptionPlan[]=[
  {id:'chatgpt-free',provider:'codex',name:'ChatGPT Free',monthly:0,interval:'monthly',source:openai},
  {id:'chatgpt-go',provider:'codex',name:'ChatGPT Go',monthly:8,interval:'monthly',source:openai},
  {id:'chatgpt-plus',provider:'codex',name:'ChatGPT Plus',monthly:20,interval:'monthly',source:openai},
  ...[100,200,500].map(monthly=>({id:`chatgpt-pro-${monthly}`,provider:'codex' as const,name:'ChatGPT Pro',monthly,interval:'monthly' as const,source:openai})),
  {id:'chatgpt-business-monthly',provider:'codex',name:'ChatGPT Business',monthly:25,interval:'monthly',perSeat:true,source:openai},
  {id:'chatgpt-business-annual',provider:'codex',name:'ChatGPT Business',monthly:20,annual:240,interval:'annual',perSeat:true,source:openai},
  {id:'claude-pro-monthly',provider:'claude',name:'Claude Pro',monthly:20,interval:'monthly',source:claude},
  {id:'claude-pro-annual',provider:'claude',name:'Claude Pro',monthly:200/12,annual:200,interval:'annual',source:claude},
  {id:'claude-max-5x',provider:'claude',name:'Claude Max 5x',monthly:100,interval:'monthly',source:'https://support.claude.com/en/articles/11049741-what-is-the-max-plan'},
  {id:'claude-max-20x',provider:'claude',name:'Claude Max 20x',monthly:200,interval:'monthly',source:'https://support.claude.com/en/articles/11049741-what-is-the-max-plan'},
  {id:'claude-team-standard-monthly',provider:'claude',name:'Claude Team · Standard seat',monthly:25,interval:'monthly',perSeat:true,source:claude},
  {id:'claude-team-standard-annual',provider:'claude',name:'Claude Team · Standard seat',monthly:20,annual:240,interval:'annual',perSeat:true,source:claude},
  {id:'claude-team-premium-monthly',provider:'claude',name:'Claude Team · Premium seat',monthly:125,interval:'monthly',perSeat:true,source:claude},
  {id:'claude-team-premium-annual',provider:'claude',name:'Claude Team · Premium seat',monthly:100,annual:1200,interval:'annual',perSeat:true,source:claude}
];
export function subscriptionPlan(provider:Provider,id:string|undefined|null):SubscriptionPlan|undefined{return subscriptionPlans.find(p=>p.provider===provider&&p.id===id);}
export function subscriptionPlanLabel(p:SubscriptionPlan):string{return `${p.name} · $${p.interval==='annual'?p.annual+'/year':p.monthly+'/month'}${p.perSeat?' / seat':''}`;}
