import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Test-owned case210 measurements. No raw game inputs or result objects are retained.
export function createReadinessRecorder(clock, origin) {
  const first=[],tail=[],criticalFirst=[],criticalTail=[];
  let sequence=0,dropped=0,criticalDropped=0,pending=0,incomplete=false,frozen;
  const now=()=>{try{const value=clock();if(Number.isFinite(value))return value;}catch{}incomplete=true;return null;};
  const record=(phase,fields={},critical=false)=>{
    try{
      if(!/^(render-board|sequence-key|sequence-cache|sequence-resolver|readiness-roundtrip|readiness-callback)(-entry|-exit)?$/.test(phase)){incomplete=true;return;}
      const scalars={};
      for(const key of ['start','end','completed','result']){
        if(!Object.hasOwn(fields,key))continue;
        const value=fields[key];
        if(value===null||typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))scalars[key]=value;
        else incomplete=true;
      }
      const row=Object.freeze({sequence:++sequence,phase,at:now(),...scalars});
      const head=critical?criticalFirst:first,last=critical?criticalTail:tail,limit=critical?32:100,capacity=critical?32:900;
      if(head.length<limit)head.push(row);else{if(last.length===capacity){last.shift();incomplete=true;if(critical)criticalDropped++;else dropped++;}last.push(row);}
    }catch{incomplete=true;}
  };
  const begin=(phase,critical=false)=>{
    const start=now();pending++;record(phase+'-entry',{start},critical);
    let ended=false;
    return (completed,result)=>{if(ended)return;ended=true;pending--;record(phase+'-exit',{start,end:now(),completed:completed===true,...(typeof result==='boolean'?{result}:{})},critical);};
  };
  const freezeOnce=()=>{
    if(frozen)return frozen;
    try{
      // Rows contain only locally-created scalar fields; never inspect caller objects.
      frozen=Object.freeze({origin:Number.isFinite(origin)?origin:null,capturedAt:now(),incomplete:incomplete||pending!==0,pending,dropped,criticalDropped,
        records:Object.freeze([...first,...tail]),critical:Object.freeze([...criticalFirst,...criticalTail])});
    }catch{frozen=Object.freeze({incomplete:true,reason:'snapshot-unavailable'});}
    return frozen;
  };
  return {record,begin,freezeOnce};
}

export function installReadinessObserver(factory) {
  try{
    const recorder=factory(()=>performance.now(),performance.timeOrigin);
    globalThis.__righeltReadinessBegin=(phase,critical=false)=>{
      try{return recorder.begin(phase,critical);}catch{return undefined;}
    };
    let snapshot;
    globalThis.__righeltReadinessFreeze=()=>{try{return snapshot??=Object.freeze({...recorder.freezeOnce(),generationUnverified:true,incomplete:true});}catch{return {incomplete:true,reason:'snapshot-unavailable'};}};
  }catch{/* Diagnostic installation cannot change the workflow. */}
}

const hash=value=>createHash('sha256').update(value).digest('hex');
export function transformReadinessModule(source,recipe){
 if(hash(source)!==recipe.sourceSha256)throw Error('Readiness source hash mismatch');
 const characters=Array.from(source);let result=characters,previous=characters.length;
 for(const operation of [...recipe.operations].reverse()){
  if(operation.start<0||operation.end>previous||operation.start>operation.end||characters.slice(operation.start,operation.end).join('')!==operation.before)throw Error('Readiness range mismatch');
  if(source.split(operation.anchor).length-1!==operation.anchorCount)throw Error('Readiness anchor count mismatch');
  result=[...result.slice(0,operation.start),...Array.from(operation.after),...result.slice(operation.end)];previous=operation.start;
 }
 const output=result.join('');if(hash(output)!==recipe.outputSha256)throw Error('Readiness output hash mismatch');return output;
}
let nodeRecorder,moduleObservation;
export async function installCaseReadiness(context,baseURL) {
  const recipes=JSON.parse(await readFile(new URL('./readiness-transformations.json',import.meta.url),'utf8'));
  const origin=new URL(baseURL).origin;
  const transforms=[],errors=[],pending=new Set();let moduleDropped=0,moduleSnapshot;
  const remember=(list,row)=>{if(list.length===128){list.shift();moduleDropped++;}list.push(Object.freeze(row));};
  const pattern=url=>url.origin===origin&&Object.hasOwn(recipes,url.pathname);
  const handler=route=>{
    const task=(async()=>{
      let pathname;
      try{
        pathname=new URL(route.request().url()).pathname;
        const response=await route.fetch(),source=await response.text();
        const body=transformReadinessModule(source,recipes[pathname]);
        remember(transforms,{pathname,sourceSha256:hash(source),outputSha256:hash(body),matches:recipes[pathname].operations.length});
        await route.fulfill({response,body});
      }catch{remember(errors,{category:'module-transform-failed',...(Object.hasOwn(recipes,pathname)?{pathname}:{})});try{await route.abort('failed');}catch{}}
    })();pending.add(task);void task.finally(()=>pending.delete(task));return task;
  };
  moduleObservation=()=>{
    if(moduleSnapshot)return moduleSnapshot;
    const missingModules=Object.freeze(Object.keys(recipes).filter(pathname=>!transforms.some(row=>row.pathname===pathname)));
    return moduleSnapshot=Object.freeze({transforms:Object.freeze([...transforms]),errors:Object.freeze([...errors]),missingModules,dropped:moduleDropped,pending:pending.size,incomplete:Boolean(errors.length||moduleDropped||pending.size||missingModules.length)});
  };
  await context.route(pattern,handler);
  nodeRecorder=createReadinessRecorder(()=>performance.now(),performance.timeOrigin);
  const dispose=async()=>{
    const categories=[];let unrouteRemoved=false,rejectedDrainTasks=0;
    const pendingAtStart=pending.size;
    try{await context.unroute(pattern,handler);unrouteRemoved=true;}
    catch{categories.push('owned-route-removal-failed');}
    finally{
      try{const settled=await Promise.allSettled([...pending]);rejectedDrainTasks=settled.filter(row=>row.status==='rejected').length;if(rejectedDrainTasks)categories.push('owned-route-task-rejected');}
      catch{categories.push('owned-route-drain-failed');}
    }
    const receipt=Object.freeze({unrouteRemoved,pendingAtStart,pendingAfterDrain:pending.size,rejectedDrainTasks,moduleErrors:errors.length,moduleDropped,categories:Object.freeze(categories),incomplete:!unrouteRemoved||Boolean(categories.length||pending.size||errors.length||moduleDropped)});
    if(receipt.incomplete)try{console.warn('[readiness] incomplete: owned-route-cleanup');}catch{}
    return receipt;
  };
  try{await context.addInitScript({content:`(${installReadinessObserver.toString()})(${createReadinessRecorder.toString()});`});}
  catch(error){try{await dispose();}finally{stopCaseReadiness();}throw error;}
  return dispose;
}
export function stopCaseReadiness(){nodeRecorder=undefined;moduleObservation=undefined;}
export async function observeReadinessEvaluation(operation) {
  let finish,completed=false,result;
  try{finish=nodeRecorder?.begin('readiness-roundtrip',true);}catch{}
  try{result=await operation();completed=true;return result;}
  finally{try{finish?.(completed,result);}catch{}}
}
export function attachNodeReadiness(value) {
  if(!nodeRecorder)return value;
  try{return {...value,readinessPage:value?.readinessPage??{incomplete:true,reason:'page-snapshot-unavailable'},readinessNode:nodeRecorder.freezeOnce(),readinessModules:moduleObservation?.()??{incomplete:true,reason:'module-observation-unavailable'}};}
  catch{return {...value,readinessNode:{incomplete:true,reason:'snapshot-unavailable'}};}
}

// Persist cleanup separately: the immutable FIRST measurement is never rewritten.
export async function finishCaseReadiness(dispose,info){
  let receipt;
  try{receipt=await dispose();}
  catch{receipt={incomplete:true,categories:['unexpected-dispose-failed']};try{console.warn('[readiness] incomplete: unexpected-dispose-failed');}catch{}}
  try{await info.attach('readiness-route-cleanup',{body:JSON.stringify(receipt),contentType:'application/json'});}
  catch{try{console.warn('[readiness] incomplete: cleanup-evidence-unavailable');}catch{}}
  finally{stopCaseReadiness();}
}
