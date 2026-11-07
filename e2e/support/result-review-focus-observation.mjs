import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname} from 'node:path';

const sha=value=>createHash('sha256').update(value).digest('hex');
export function transformResultReviewFocusSource(source,recipe){
 if(recipe.version!==1||recipe.modulePath!=='/shell/app.js'||sha(source)!==recipe.sourceSha256)throw Error('observer source binding');
 let previous=0;
 for(const op of recipe.operations){
  if(!Number.isSafeInteger(op.start)||!Number.isSafeInteger(op.end)||op.start<previous||op.end<op.start||source.slice(op.start,op.end)!==op.before)throw Error('observer range binding');
  previous=op.end;
 }
 let result=source;
 for(const op of [...recipe.operations].reverse())result=result.slice(0,op.start)+op.after+result.slice(op.end);
 result=recipe.prefix+result;
 if(sha(result)!==recipe.outputSha256)throw Error('observer output binding');
 return result;
}

// Serialized by Playwright before each document's application modules execute.
// Values crossing this boundary are fixed enums, booleans and weak-node tokens.
export function resultReviewFocusInit(){
 const kinds=new Set(['analysis-entry','render-committed-entry','focus-before','focus-after',
  'render-before-join','render-after-join','render-after-resume',
  'history-before-context-patch','history-after-context-patch',
  'history-before-incremental-patch','history-after-incremental-patch',
  'focusin','focusout','pointerdown','mousedown','keydown','keyup','click']);
 const first=[],tail=[],tokens=new WeakMap(),listeners=[];
 let next=0,sequence=0,dropped=0,projectionFailures=0,analysisCount=0,focusBeforeCount=0,focusAfterCount=0,frozen=false,lastHeading=null,lastRoot=null;
 let armed=false,windowEvents=0,preArmEvents=0,supersededWindows=0,supersededEvents=0,priorIncomplete=0,counterOverflow=false;
 const weakUnavailable=typeof WeakRef!=='function';
 let incomplete=weakUnavailable;
 const boundedAdd=(value,delta=1)=>{
  if(!Number.isSafeInteger(delta)||delta<0||value>Number.MAX_SAFE_INTEGER-delta){counterOverflow=true;return Number.MAX_SAFE_INTEGER;}
  return value+delta;
 };
 const token=node=>{
  if(!node||(typeof node!=='object'&&typeof node!=='function'))return null;
  if(!tokens.has(node)){if(next===Number.MAX_SAFE_INTEGER){counterOverflow=true;incomplete=true;return null;}tokens.set(node,++next);}
  return tokens.get(node);
 };
 const weak=node=>node&&typeof WeakRef==='function'?new WeakRef(node):null;
 const category=node=>!node?'null':node===document.body?'body':node===lastHeading?.deref()?'heading':
  node.matches?.('.game-result [data-action="analysis"]')?'review':node.closest?.('#app')?'app-foreign':'document-foreign';
 const probe=(kind,refs={})=>{
  if(frozen||!kinds.has(kind))return;
  if(sequence===Number.MAX_SAFE_INTEGER){counterOverflow=true;incomplete=true;return;}
  sequence++;
  if(kind==='analysis-entry'){
   if(armed){
    supersededWindows=boundedAdd(supersededWindows);
    supersededEvents=boundedAdd(supersededEvents,windowEvents);
    if(incomplete||counterOverflow)priorIncomplete=boundedAdd(priorIncomplete);
   }
   armed=true;analysisCount=boundedAdd(analysisCount);
   first.length=0;tail.length=0;dropped=0;projectionFailures=0;
   focusBeforeCount=0;focusAfterCount=0;windowEvents=0;
   lastHeading=null;lastRoot=null;incomplete=weakUnavailable;
  }else if(!armed){preArmEvents=boundedAdd(preArmEvents);return;}
  windowEvents=boundedAdd(windowEvents);
  if(kind==='focus-before')focusBeforeCount=boundedAdd(focusBeforeCount);
  if(kind==='focus-after')focusAfterCount=boundedAdd(focusAfterCount);
  try{
   const node=Object.getOwnPropertyDescriptor(refs,'node')?.value;
   const root=Object.getOwnPropertyDescriptor(refs,'root')?.value;
   if(kind==='focus-before'&&node){lastHeading=weak(node);lastRoot=weak(node.closest?.('[data-game-shell-root]'));}
   const heading=lastHeading?.deref(),currentRoot=root??lastRoot?.deref(),active=document.activeElement;
   const row=Object.assign(Object.create(null),{
    sequence,window:analysisCount,kind,nodeToken:token(node),headingToken:token(heading),rootToken:token(currentRoot),activeToken:token(active),
    activeCategory:category(active),activeIsHeading:Boolean(heading&&active===heading),
    headingConnected:heading?Boolean(heading.isConnected):null,
    headingInert:heading?Boolean(heading.closest?.('[inert]')):null,
    rootConnected:currentRoot?Boolean(currentRoot.isConnected):null,
    rootContainsHeading:currentRoot&&heading?Boolean(currentRoot.contains(heading)):null,
    documentHasFocus:Boolean(document.hasFocus()),visibility:document.visibilityState==='visible'?'visible':'not-visible',
   });
   if(first.length<64)first.push(row);
   else{tail.push(row);if(tail.length>64){tail.shift();dropped=boundedAdd(dropped);incomplete=true;}}
  }catch{projectionFailures=boundedAdd(projectionFailures);incomplete=true;}
 };
 const snapshot=()=>{
  if(frozen)return null;
  frozen=true;
  for(const [kind,fn]of listeners)document.removeEventListener(kind,fn,true);
  return {schema:1,first:first.map(row=>Object.assign(Object.create(null),row)),tail:tail.map(row=>Object.assign(Object.create(null),row)),
   sequence,dropped,projectionFailures,analysisCount,focusBeforeCount,focusAfterCount,
   armed,windowEvents,preArmEvents,supersededWindows,supersededEvents,priorIncomplete,counterOverflow,weakNodeCount:next,
   scopedIncomplete:incomplete||!armed||counterOverflow,incomplete:true,generationUnverified:true,
   scope:'Latest explicit analysis window in this final document only; pre-arm, superseded and prior documents are outside this window. No absence inference outside retained contiguous rows.'};
 };
 try{
  Object.defineProperty(globalThis,'__RIGHELT_RESULT_REVIEW_FOCUS_PROBE__',{value:probe,configurable:true});
  Object.defineProperty(globalThis,'__RIGHELT_RESULT_REVIEW_FOCUS_SNAPSHOT__',{value:snapshot,configurable:true});
  for(const kind of ['focusin','focusout','pointerdown','mousedown','keydown','keyup','click']){
   const fn=event=>{try{probe(kind,{node:event.target});}catch{incomplete=true;}};
   document.addEventListener(kind,fn,{capture:true,passive:true});listeners.push([kind,fn]);
  }
 }catch{incomplete=true;}
}

export async function installResultReviewFocusObservation({context,baseURL,enabled=process.env.RIGHELT_RESULT_REVIEW_FOCUS_OBSERVER==='1'}){
 if(!enabled)return {finish:async()=>{}};
 const origin=new URL(baseURL).origin;
 const url=new URL(baseURL);
 if(!['http:','https:'].includes(url.protocol)||!['127.0.0.1','localhost','[::1]'].includes(url.hostname))throw Error('observer requires existing local auth origin');
 const recipe=JSON.parse(await readFile(new URL('./result-review-focus-observation-recipe.json',import.meta.url),'utf8'));
 const pending=new Set(),modules=[],issues=[];let moduleDropped=0,issueDropped=0,finished=false;
 const issue=value=>{if(issues.length<16)issues.push(value);else issueDropped++;};
 const moduleRecord=value=>{if(modules.length<8)modules.push(value);else moduleDropped++;};
 await context.addInitScript(resultReviewFocusInit);
 const match=target=>target.origin===origin&&target.pathname===recipe.modulePath;
 const handler=route=>{
  const work=(async()=>{
   const response=await route.fetch();
   if(route.request().method()!=='GET'||response.status()!==200){moduleRecord({status:'nonmatching-response'});await route.fulfill({response});return;}
   const source=await response.text();
   let body;
   try{body=transformResultReviewFocusSource(source,recipe);}
   catch{moduleRecord({status:'binding-failed'});issue('module-binding');await route.fulfill({response,body:source});return;}
   moduleRecord({status:'transformed',sourceSha256:sha(source),outputSha256:sha(body)});
   await route.fulfill({response,body});
  })();
  pending.add(work);void work.then(()=>pending.delete(work),()=>{issue('route-request-failed');pending.delete(work);});
  return work;
 };
 await context.route(match,handler);
 return {async finish(page,info){
  if(finished)return;
  finished=true;
  let snapshot=null;const pendingAtSnapshot=pending.size;
  try{
   // ONE EXPLICIT NEW read-only diagnostic Page.evaluate, before owned.close().
   // No game/session/authority reads, actions, timer or requests are introduced.
   snapshot=await page.evaluate(()=>globalThis.__RIGHELT_RESULT_REVIEW_FOCUS_SNAPSHOT__?.()??null);
  }catch{issue('snapshot-unavailable');}
  try{await context.unroute(match,handler);}catch{issue('unroute-failed');}
  const drain=await Promise.allSettled([...pending]);
  if(drain.some(result=>result.status==='rejected'))issue('pending-route-rejected');
  const receipt={schema:1,sourceSha256:recipe.sourceSha256,outputSha256:recipe.outputSha256,modules,moduleDropped,
   snapshot,issues,issueDropped,pendingAtSnapshot,capturePhase:info?.title==='the same completed game persists through review and swapped rematch'?'retained-review-continuation':'earlier-setup-or-cleanup',incomplete:!snapshot||snapshot.incomplete||pendingAtSnapshot>0||moduleDropped>0||issues.length>0||!modules.some(m=>m.status==='transformed'),
   limits:'Not a CI cause reproduction. Final document only; bounded drops and generation continuity remain explicit.'};
  try{
   const file=info.outputPath('result-review-focus-observation.json');
   await mkdir(dirname(file),{recursive:true});
   await writeFile(file,JSON.stringify(receipt,null,2));
   await info.attach('Result review focus passive observation',{path:file,contentType:'application/json'});
  }catch{try{console.warn('[result-review-focus-observer] artifact-io-unavailable');}catch{} /* Never replace the original test error. */ }
 }};
}
