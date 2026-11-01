import {RUSH_GUIDANCE_TIMEOUT_MS} from './rush-supply-guidance.js';
let nextOwner=0;
const stages=new Set(['request','result-validation','presentation']);
const known=new Set(['rules_timeout','rules_cancelled','rules_budget_exceeded','empty_rush_guidance']);

// Observation only. A broken sink cannot alter query, rendering or admission.
export function createGuidanceDiagnostics(onEvent,{now=()=>performance.now()}={}){
 if(typeof onEvent!=='function')return {start:()=>null,failed(){},resolved(){},retire(){}};
 const owner=++nextOwner;let current=null,sequence=0;
 const time=()=>{try{return now();}catch{return 0;}};
 const emit=(phase,episode,error,stage='request')=>{
  if(!episode||episode!==current)return;
  try{
   const code=known.has(error?.code)?error.code:error?.message==='empty_rush_guidance'?'empty_rush_guidance':'unavailable';
   onEvent?.({phase,episode:episode.id,...(phase==='failed'?{code,stage:stages.has(stage)?stage:'request',elapsedMs:Math.max(0,time()-episode.started),deadlineMs:RUSH_GUIDANCE_TIMEOUT_MS}: {})});
  }catch{}
 };
 return {
  start(){if(current)emit('retired',current);current={id:`${owner}:${++sequence}`,started:time()};emit('started',current);return current;},
  failed(episode,error,stage){emit('failed',episode,error,stage);},
  resolved(episode){if(episode!==current)return;emit('resolved',episode);current=null;},
  retire(){if(current)emit('retired',current);current=null;},
 };
}
