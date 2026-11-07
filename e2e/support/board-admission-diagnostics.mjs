import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const hash = value => createHash('sha256').update(value).digest('hex');
export const transformBoardAdmissionModule = (source, recipe) => {
 if(hash(source)!==recipe.sourceSha256)throw new Error('Board diagnostic source hash mismatch');
 const characters=Array.from(source);let result=characters, previous=characters.length;
 for(const operation of [...recipe.operations].reverse()){
  if(operation.end>previous || characters.slice(operation.start,operation.end).join('')!==operation.before)throw new Error('Board diagnostic range mismatch');
  if(source.split(operation.anchor).length-1!==operation.anchorCount)throw new Error('Board diagnostic anchor count mismatch');
  result=[...result.slice(0,operation.start),...Array.from(operation.after),...result.slice(operation.end)];previous=operation.start;
 }
 result=recipe.prefix+result.join('');
 if(hash(result)!==recipe.outputSha256)throw new Error('Board diagnostic output hash mismatch');
 return result;
};

// Serialized by Playwright. Only allowlisted scalars and local weak equality
// tokens leave the page; original app objects and stable keys are never copied.
export function installBoardAdmissionCollector({targetRow,targetCol}){
 const subjects=new WeakMap();let next=0,sequence=0,armed=false;
 const log={version:1,first:[],tail:[],firstActivation:[],activation:[],activationGeneration:0,supersededActivations:0,dropped:0,activationDropped:0,firstSourceRead:null,lastSourceRead:null,sourceReadCount:0,incomplete:false,timeOrigin:performance.timeOrigin};
 const token=value=>{
  if(!value || !['object','function'].includes(typeof value))return null;
  if(!subjects.has(value))subjects.set(value,++next);return subjects.get(value);
 };
 const scalarKeys=new Set(['value','row','col','revision','phase','moves','previews','type','kind','interactive','sameNodes','mounted','positionChanged','preservePiecePreviews','resetSelection','legalTarget','hasPreviewAtClicked','hasClickedPiece','allowFreeSelection','usesHoverTargetSelection','count','retryAttempt','reconcileFirst','hadRuntime','trusted','rootToken','callbackToken','eventToken','targetToken','currentTargetToken','currentRootToken','cellRootToken','targetConnected','currentRootConnected','pathContainsCurrentRoot','dispatchPhase','pointerId','connected','pieceChanged','hasSelectedPiece','requestId']);
 // Runtime errors have a dedicated closed schema. No arbitrary error strings or getters.
 const errorNames=["Error","TypeError","RangeError","ReferenceError","SyntaxError","URIError","EvalError","AggregateError"], errorCategories=["rules_cancelled","invalid_rules_response","rules_worker_failed","rules_timeout","session_changed","stale_state","journal_timeout","sync_recovering","storage_reset","storage_generation_unverified","invalid_saved_command","cleanup_unverified","untracked_saved_command","invalid_cleanup_receipt"];
 const errorField=(data,key,allowed)=>{
  try{
   const descriptor=data!==null&&['object','function'].includes(typeof data)?Object.getOwnPropertyDescriptor(data,key):null;
   return descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='string'?allowed.find(value=>value===descriptor.value)??null:null;
  }catch{return null;}
 };
 const sanitize=(data,event)=>{
  if(event==='runtime-host-error')return{errorName:errorField(data,'errorName',errorNames),errorCode:errorField(data,'errorCode',errorCategories),errorMessage:errorField(data,'errorMessage',errorCategories)};
  const safe={};
  for(const [key,value] of Object.entries(data)){
   if(key==='pathTokens'&&Array.isArray(value))safe.pathTokens=value.slice(0,8).filter(item=>Number.isSafeInteger(item)&&item>0);
   if(scalarKeys.has(key) && (value===null || typeof value==='boolean' || typeof value==='string'&&value.length<64 || typeof value==='number'&&Number.isFinite(value)))safe[key]=value;
   if(['source','target','clicked'].includes(key) && value && Number.isFinite(value.row)&&Number.isFinite(value.col))safe[key]={row:value.row,col:value.col};
  }
  return safe;
 };
 const record=(event,data={},subject=null)=>{try{
  const row={sequence:++sequence,event,...sanitize(data,event),subjectToken:token(subject),now:performance.now(),timeOrigin:performance.timeOrigin};
  if(event==='fixture-ensure-source-read'){log.sourceReadCount++;log.firstSourceRead??=row;log.lastSourceRead=row;}
  if(log.first.length<64)log.first.push(row);
  else{if(log.tail.length===64){log.tail.shift();log.dropped++;log.incomplete=true;}log.tail.push(row);}
  if(armed){
   if(log.activationGeneration===1 && log.firstActivation.length<64)log.firstActivation.push(row);
   if(log.activation.length<64)log.activation.push(row);else{log.activationDropped++;log.incomplete=true;}
  }
 }catch{log.incomplete=true;}};
 globalThis.__boardAdmissionRecord=record;
 globalThis.__boardAdmissionObservation=log;
 const observe=(event,dispatchPhase)=>{try{
  const target=event.target,cell=target?.closest?.('.cell')??null;
  const row=cell?Number(cell.dataset.row):null,col=cell?Number(cell.dataset.col):null;
  const currentRoot=document.querySelector?.('[data-testid="game-board"]')??null;
  const cellRoot=cell?.closest?.('[data-testid="game-board"]')??null;
  const path=event.composedPath?.()??[];
  if(dispatchPhase==='capture' && event.isTrusted && event.type==='pointerdown' && row===targetRow && col===targetCol){
   if(armed){log.supersededActivations++;log.incomplete=true;}
   armed=true;log.activationGeneration++;log.activation=[];log.activationDropped=0;
  }
  record('native-'+event.type,{trusted:event.isTrusted,row,col,dispatchPhase,pointerId:event.pointerId??null,eventToken:token(event),targetToken:token(target),currentTargetToken:token(event.currentTarget),currentRootToken:token(currentRoot),cellRootToken:token(cellRoot),targetConnected:Boolean(target?.isConnected),currentRootConnected:Boolean(currentRoot?.isConnected),pathContainsCurrentRoot:Boolean(currentRoot&&path.includes(currentRoot)),pathTokens:path.slice(0,8).map(token)},cell??target);
 }catch{log.incomplete=true;}};
 for(const event of ['pointerover','pointerdown','pointerup','pointercancel','click']){
  document.addEventListener(event,value=>observe(value,'capture'),{capture:true,passive:true});
  document.addEventListener(event,value=>observe(value,'bubble'),{capture:false,passive:true});
 }

}

export async function installBoardAdmissionDiagnostics(page,info,{targetRow,targetCol,baseURL}){
 const recipes=JSON.parse(await readFile(new URL('./board-admission-transformations.json',import.meta.url),'utf8'));
 const transforms=[],errors=[];let installed=false;
 const origin=new URL(baseURL).origin;
 await page.addInitScript(installBoardAdmissionCollector,{targetRow,targetCol});
 const handler=async route=>{
  const pathname=new URL(route.request().url()).pathname,recipe=recipes[pathname];
  if(!recipe){await route.continue();return;}
  try{
   const response=await route.fetch();const source=await response.text();
   const body=transformBoardAdmissionModule(source,recipe);
   transforms.push({pathname,sourceSha256:hash(source),outputSha256:hash(body),matches:recipe.operations.length});
   await route.fulfill({response,body});
  }catch{
   errors.push({category:'module-transform-failed',pathname});
   await route.abort('failed');
  }
 };
 const pattern=url=>url.origin===origin && Object.hasOwn(recipes,url.pathname);
 await page.route(pattern,handler);installed=true;
 return {
  async persist(){
   let observation=null,incomplete=errors.length>0;
   try{observation=await page.evaluate(()=>globalThis.__boardAdmissionObservation??null);if(!observation)incomplete=true;}catch{incomplete=true;}
   const missingModules=Object.keys(recipes).filter(pathname=>!transforms.some(row=>row.pathname===pathname));
   const payload={caseTitle:info.title,observation,transforms,errors,missingModules,incomplete:incomplete||missingModules.length>0||!observation?.activation?.length||Boolean(observation?.incomplete),clock:'page.performance/timeOrigin; Node persistence wall clock separate',nodePersistedAt:new Date().toISOString()};
   try{await writeFile(info.outputPath('board-admission-observation.json'),JSON.stringify(payload,null,2));}
   catch{console.error('[board-admission-diagnostic] evidence-write-incomplete');}
   try{await info.attach('board-admission-observation',{body:JSON.stringify(payload),contentType:'application/json'});}
   catch{console.error('[board-admission-diagnostic] evidence-attachment-incomplete');}
   if(installed){try{await page.unroute(pattern,handler);}catch{console.error('[board-admission-diagnostic] route-disposal-incomplete');}}
  },
 };
}
