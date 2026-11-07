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

export const SOURCE_PRESS_PREFIX='[righelt-source-window-v1]';
export const SOURCE_PRESS_MAX_BYTES=512*1024;
const safeBoardDiagnostic=category=>{try{console.error(`[board-admission-diagnostic] ${category}`);}catch{}};

// Shared producer/receiver codec. Own data descriptors are copied into
// null-prototype records and arrays, so serialization cannot call toJSON.
export function cloneBoardSourceHandoff(input){
 const bad=()=>{throw Error('Invalid source-window handoff');};
 const own=(value,keys)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))bad();
  const descriptors=Object.getOwnPropertyDescriptors(value);
  for(const key of Reflect.ownKeys(descriptors))if(typeof key!=='string'||!keys.includes(key)||!Object.hasOwn(descriptors[key],'value'))bad();
  return descriptors;
 };
 const required=(descriptors,key)=>{if(!Object.hasOwn(descriptors,key)||!Object.hasOwn(descriptors[key],'value'))bad();return descriptors[key].value;};
 const integer=value=>{if(!Number.isSafeInteger(value)||value<0)bad();return value;};
 const number=value=>{if(typeof value!=='number'||!Number.isFinite(value)||value<0)bad();return value;};
 const boolean=value=>{if(typeof value!=='boolean')bad();return value;};
 const array=(value,max,copy)=>{
  if(!Array.isArray(value))bad();const d=Object.getOwnPropertyDescriptors(value),length=required(d,'length');integer(length);if(length>max)bad();
  for(const key of Reflect.ownKeys(d))if(typeof key!=='string'||key!=='length'&&(!/^(0|[1-9]\d*)$/.test(key)||Number(key)>=length)||!Object.hasOwn(d[key],'value'))bad();
  const out=[];Object.setPrototypeOf(out,null);for(let i=0;i<length;i++)out[i]=copy(required(d,String(i)));return out;
 };
 const top=own(input,['version','timeOrigin','sourceWindow']);if(required(top,'version')!==1)bad();const epoch=number(required(top,'timeOrigin'));if(epoch<=0)bad();
 const scalar=['value','row','col','revision','phase','moves','previews','type','kind','interactive','sameNodes','mounted','positionChanged','preservePiecePreviews','resetSelection','legalTarget','hasPreviewAtClicked','hasClickedPiece','allowFreeSelection','usesHoverTargetSelection','count','retryAttempt','reconcileFirst','hadRuntime','trusted','rootToken','callbackToken','eventToken','targetToken','currentTargetToken','currentRootToken','cellRootToken','targetConnected','currentRootConnected','pathContainsCurrentRoot','dispatchPhase','pointerId','connected','pieceChanged','hasSelectedPiece','requestId','button','buttons','sourceConnected'];
 const row=value=>{
  const d=own(value,['sequence','event','subjectToken','now','timeOrigin','pathTokens','source','target','clicked',...scalar]),out=Object.create(null);
  out.sequence=integer(required(d,'sequence'));if(out.sequence<1)bad();out.event=required(d,'event');if(typeof out.event!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(out.event))bad();
  out.subjectToken=required(d,'subjectToken');if(out.subjectToken!==null&&(integer(out.subjectToken)<1))bad();out.now=number(required(d,'now'));out.timeOrigin=number(required(d,'timeOrigin'));if(out.timeOrigin!==epoch)bad();
  for(const key of scalar)if(Object.hasOwn(d,key)){const v=d[key].value;if(v!==null&&typeof v!=='boolean'&&!(typeof v==='string'&&v.length<64)&&!(typeof v==='number'&&Number.isFinite(v)))bad();out[key]=v;}
  if(Object.hasOwn(d,'pathTokens'))out.pathTokens=array(d.pathTokens.value,8,v=>{if(integer(v)<1)bad();return v;});
  for(const key of ['source','target','clicked'])if(Object.hasOwn(d,key)){const pos=own(d[key].value,['row','col']),copy=Object.create(null);copy.row=number(required(pos,'row'));copy.col=number(required(pos,'col'));out[key]=copy;}
  return out;
 };
 const fields=['expectedOrdinal','attemptsObserved','observed','markerRecorded','first','tail','dropped','projectionFailures','incomplete','lastFailure'];
 const d=own(required(top,'sourceWindow'),fields),window=Object.create(null);
 for(const key of ['expectedOrdinal','attemptsObserved','dropped','projectionFailures'])window[key]=integer(required(d,key));if(window.expectedOrdinal<1)bad();
 for(const key of ['observed','markerRecorded','incomplete'])window[key]=boolean(required(d,key));
 window.lastFailure=required(d,'lastFailure');if(window.lastFailure!==null&&(typeof window.lastFailure!=='string'||!/^[a-z][a-z-]{0,63}$/.test(window.lastFailure)))bad();
 window.first=array(required(d,'first'),64,row);window.tail=array(required(d,'tail'),64,row);
 if((window.dropped>0||window.projectionFailures>0||window.lastFailure!==null)&&!window.incomplete)bad();
 if(window.markerRecorded&&(!window.observed||!window.first.length||window.first[0].event!=='fixture-source-class-read'||window.first[0].count!==window.expectedOrdinal))bad();
 if(window.observed&&window.attemptsObserved<window.expectedOrdinal||!window.observed&&(window.markerRecorded||window.first.length||window.tail.length))bad();
 let previous=0;for(const values of [window.first,window.tail])for(let i=0;i<values.length;i++){if(values[i].sequence<=previous)bad();previous=values[i].sequence;}
 const packet=Object.create(null);packet.version=1;packet.timeOrigin=epoch;packet.sourceWindow=window;return packet;
}

export function createBoardSourceConsoleRetention(page,expectedOrdinal){
 let first=null,stopped=false,failures=0,lastFailure=null;
 const fail=category=>{failures=Math.min(1000000,failures+1);lastFailure=category;};
 const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
 const listener=message=>{try{
  const text=message.text();if(typeof text!=='string'||!text.startsWith(SOURCE_PRESS_PREFIX))return;
  if(text.length>SOURCE_PRESS_MAX_BYTES+SOURCE_PRESS_PREFIX.length||Buffer.byteLength(text,'utf8')>SOURCE_PRESS_MAX_BYTES+SOURCE_PRESS_PREFIX.length){fail('handoff-oversize');return;}
  const packet=cloneBoardSourceHandoff(JSON.parse(text.slice(SOURCE_PRESS_PREFIX.length)));
  if(packet.sourceWindow.expectedOrdinal!==expectedOrdinal||!packet.sourceWindow.observed||!packet.sourceWindow.markerRecorded){fail('handoff-scope-invalid');return;}
  if(first){fail(packet.timeOrigin===first.timeOrigin?'handoff-duplicate':'handoff-epoch-conflict');return;}
  first=freeze(packet);
 }catch{fail('handoff-invalid');}};
 try{page.on('console',listener);}catch{fail('listener-install-failed');try{page.off('console',listener);}catch{fail('listener-remove-failed');}}
 const stop=()=>{if(stopped)return;stopped=true;try{page.off('console',listener);}catch{fail('listener-remove-failed');}};
 return {stop,capture(packet){try{const value=cloneBoardSourceHandoff(packet);if(value.sourceWindow.expectedOrdinal!==expectedOrdinal||!value.sourceWindow.observed||!value.sourceWindow.markerRecorded){fail('checkpoint-scope-invalid');return;}if(first){fail('checkpoint-duplicate');return;}first=freeze(value);}catch{fail('checkpoint-invalid');}},failed(){fail('checkpoint-read-failed');},snapshot(live){try{
  let livePacket=null;
  if(live?.sourceWindow){try{livePacket=cloneBoardSourceHandoff({version:1,timeOrigin:live.timeOrigin,sourceWindow:live.sourceWindow});}catch{fail('live-window-invalid');}}
  const liveObserved=livePacket?.sourceWindow.observed===true&&livePacket?.sourceWindow.markerRecorded===true;
  const used=first??(liveObserved?livePacket:null);
  return {retainedPreReloadSourceWindow:first,retention:{incomplete:failures>0||!used||Boolean(used.sourceWindow.incomplete),failures,lastFailure:failures?lastFailure:!used?'handoff-unobserved':null,liveTimeOrigin:typeof live?.timeOrigin==='number'?live.timeOrigin:null,retainedTimeOrigin:first?.timeOrigin??null,selectedSource:first?'retained-pre-reload':liveObserved?'live':'unobserved',epochsMerged:false}};
 }catch{fail('retention-snapshot-failed');return {retainedPreReloadSourceWindow:first,retention:{incomplete:true,failures,lastFailure,epochsMerged:false}};}}};
}

// Serialized by Playwright. Only allowlisted scalars and local weak equality
// tokens leave the page; original app objects and stable keys are never copied.
export function installBoardAdmissionCollector({targetRow,targetCol,sourceAttemptOrdinal}){
 if(sourceAttemptOrdinal!==undefined&&(!Number.isSafeInteger(sourceAttemptOrdinal)||sourceAttemptOrdinal<1))throw Error('Invalid source attempt ordinal');
 const sourceEnabled=sourceAttemptOrdinal!==undefined;let sourceActive=false,sourceRef=null,sourceReads=0;
 const subjects=new WeakMap();let next=0,sequence=0,armed=false;
 const log={version:1,first:[],tail:[],firstActivation:[],activation:[],activationGeneration:0,supersededActivations:0,dropped:0,activationDropped:0,firstSourceRead:null,lastSourceRead:null,sourceReadCount:0,incomplete:false,timeOrigin:performance.timeOrigin};
 if(sourceEnabled)log.sourceWindow={expectedOrdinal:sourceAttemptOrdinal,attemptsObserved:0,observed:false,markerRecorded:false,first:[],tail:[],dropped:0,projectionFailures:0,incomplete:true,lastFailure:'source-attempt-unobserved'};
 const sourceFailure=category=>{try{log.incomplete=true;if(sourceActive){log.sourceWindow.incomplete=true;log.sourceWindow.projectionFailures++;log.sourceWindow.lastFailure=category;}}catch{}};
 const token=value=>{
  if(!value || !['object','function'].includes(typeof value))return null;
  if(!subjects.has(value))subjects.set(value,++next);return subjects.get(value);
 };
 const scalarKeys=new Set(['value','row','col','revision','phase','moves','previews','type','kind','interactive','sameNodes','mounted','positionChanged','preservePiecePreviews','resetSelection','legalTarget','hasPreviewAtClicked','hasClickedPiece','allowFreeSelection','usesHoverTargetSelection','count','retryAttempt','reconcileFirst','hadRuntime','trusted','rootToken','callbackToken','eventToken','targetToken','currentTargetToken','currentRootToken','cellRootToken','targetConnected','currentRootConnected','pathContainsCurrentRoot','dispatchPhase','pointerId','connected','pieceChanged','hasSelectedPiece','requestId','button','buttons','sourceConnected']);
 const sanitize=data=>{
  const safe={};
  for(const [key,value] of Object.entries(data)){
   if(key==='pathTokens'&&Array.isArray(value))safe.pathTokens=value.slice(0,8).filter(item=>Number.isSafeInteger(item)&&item>0);
   if(scalarKeys.has(key) && (value===null || typeof value==='boolean' || typeof value==='string'&&value.length<64 || typeof value==='number'&&Number.isFinite(value)))safe[key]=value;
   if(['source','target','clicked'].includes(key) && value && Number.isFinite(value.row)&&Number.isFinite(value.col))safe[key]={row:value.row,col:value.col};
  }
  return safe;
 };
 const record=(event,data={},subject=null)=>{try{
  const row={sequence:++sequence,event,...sanitize(data),subjectToken:token(subject),now:performance.now(),timeOrigin:performance.timeOrigin};
  if(event==='fixture-ensure-source-read'){log.sourceReadCount++;log.firstSourceRead??=row;log.lastSourceRead=row;}
  if(log.first.length<64)log.first.push(row);
  else{if(log.tail.length===64){log.tail.shift();log.dropped++;log.incomplete=true;}log.tail.push(row);}
  if(armed){
   if(log.activationGeneration===1 && log.firstActivation.length<64)log.firstActivation.push(row);
   if(log.activation.length<64)log.activation.push(row);else{log.activationDropped++;log.incomplete=true;}
  }
  if(sourceActive){
   const window=log.sourceWindow;
   if(row.event==='fixture-source-class-read'&&row.count===sourceAttemptOrdinal)window.markerRecorded=true;
   if(window.first.length<64)window.first.push(row);
   else{if(window.tail.length===64){window.tail.shift();window.dropped++;window.incomplete=true;}window.tail.push(row);}
  }
 }catch{sourceFailure('record-projection-failed');}};
 globalThis.__boardAdmissionRecord=record;
 globalThis.__boardAdmissionObservation=log;
 if(sourceEnabled)globalThis.__boardAdmissionSourceRead=(value,element)=>{try{
  sourceReads++;log.sourceWindow.attemptsObserved=sourceReads;
  if(sourceReads===sourceAttemptOrdinal){
   sourceActive=true;log.sourceWindow.observed=true;log.sourceWindow.incomplete=false;log.sourceWindow.lastFailure=null;
   try{sourceRef=new WeakRef(element);}catch{sourceFailure('source-reference-unavailable');}
  }else if(sourceActive){sourceFailure('additional-source-attempt');}
  const row=Number(element.dataset.row),col=Number(element.dataset.col);
  if(!Number.isInteger(row)||!Number.isInteger(col)||row<0||col<0)sourceFailure('source-coordinate-unobserved');
  record('fixture-source-class-read',{value,row:Number.isFinite(row)?row:null,col:Number.isFinite(col)?col:null,count:sourceReads},element);
 }catch{sourceFailure('source-marker-projection-failed');}};
 const sourceConnected=()=>{
  if(!sourceActive)return null;
  try{const element=sourceRef?.deref();if(!element){sourceFailure('source-reference-unobserved');return null;}return Boolean(element.isConnected);}
  catch{sourceFailure('source-liveness-projection-failed');return null;}
 };
 if(sourceEnabled){
  let attempted=false,stringify,encode,write;
  const sourceWindow=log.sourceWindow,epoch=log.timeOrigin;
  globalThis.__boardAdmissionSourceSnapshot=()=>cloneBoardSourceHandoff({version:1,timeOrigin:epoch,sourceWindow});
  try{stringify=JSON.stringify;encode=new TextEncoder();write=console.debug.bind(console);}catch{sourceFailure('handoff-initialization-failed');}
  const handoff=event=>{if(attempted)return;try{
   if(event?.isTrusted!==true)return;
   const packet=cloneBoardSourceHandoff({version:1,timeOrigin:epoch,sourceWindow});
   if(!packet.sourceWindow.observed||!packet.sourceWindow.markerRecorded)return;
   attempted=true;const body=stringify(packet);
   if(body.length>SOURCE_PRESS_MAX_BYTES||encode.encode(body).length>SOURCE_PRESS_MAX_BYTES){sourceFailure('handoff-oversize');return;}
   write(SOURCE_PRESS_PREFIX+body);
  }catch{attempted=true;sourceFailure('handoff-serialization-or-console-failed');}};
  try{globalThis.addEventListener('pagehide',handoff);}catch{sourceFailure('handoff-listener-unavailable');}
 }
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
  record('native-'+event.type,{trusted:event.isTrusted,row,col,dispatchPhase,pointerId:event.pointerId??null,...(sourceEnabled?{button:event.button??null,buttons:event.buttons??null,sourceConnected:sourceConnected()}:{}),eventToken:token(event),targetToken:token(target),currentTargetToken:token(event.currentTarget),currentRootToken:token(currentRoot),cellRootToken:token(cellRoot),targetConnected:Boolean(target?.isConnected),currentRootConnected:Boolean(currentRoot?.isConnected),pathContainsCurrentRoot:Boolean(currentRoot&&path.includes(currentRoot)),pathTokens:path.slice(0,8).map(token)},cell??target);
 }catch{sourceFailure('native-projection-failed');}};
 for(const event of ['pointerover','pointerdown','pointerup','pointercancel','click',...(sourceEnabled?['mousedown','mouseup']:[])]){
  document.addEventListener(event,value=>observe(value,'capture'),{capture:true,passive:true});
  document.addEventListener(event,value=>observe(value,'bubble'),{capture:false,passive:true});
 }

}

export async function installBoardAdmissionDiagnostics(page,info,{targetRow,targetCol,baseURL,sourceAttemptOrdinal}){
 if(sourceAttemptOrdinal!==undefined&&(!Number.isSafeInteger(sourceAttemptOrdinal)||sourceAttemptOrdinal<1))throw Error('Invalid source attempt ordinal');
 const recipes=JSON.parse(await readFile(new URL('./board-admission-transformations.json',import.meta.url),'utf8'));
 const transforms=[],errors=[];let installed=false;
 const origin=new URL(baseURL).origin;
 const sourceRetention=sourceAttemptOrdinal===undefined?null:createBoardSourceConsoleRetention(page,sourceAttemptOrdinal);
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
 try{
  if(sourceAttemptOrdinal===undefined)await page.addInitScript(installBoardAdmissionCollector,{targetRow,targetCol});
  else await page.addInitScript({content:`(()=>{const SOURCE_PRESS_PREFIX=${JSON.stringify(SOURCE_PRESS_PREFIX)};const SOURCE_PRESS_MAX_BYTES=${SOURCE_PRESS_MAX_BYTES};const cloneBoardSourceHandoff=(${cloneBoardSourceHandoff.toString()});(${installBoardAdmissionCollector.toString()})(${JSON.stringify({targetRow,targetCol,sourceAttemptOrdinal})});})();`});
  await page.route(pattern,handler);installed=true;
 }catch(error){sourceRetention?.stop();throw error;}
 return {
  async checkpoint(){
   if(!sourceRetention)return;
   sourceRetention.stop();
   try{sourceRetention.capture(await page.evaluate(()=>globalThis.__boardAdmissionSourceSnapshot?.()??null));}
   catch{sourceRetention.failed();}
  },
  async persist(){
   try{
   let observation=null,incomplete=errors.length>0;
   try{observation=await page.evaluate(()=>globalThis.__boardAdmissionObservation??null);if(!observation)incomplete=true;}catch{incomplete=true;}
   sourceRetention?.stop();
   const retained=sourceRetention?.snapshot(observation);
   const missingModules=Object.keys(recipes).filter(pathname=>!transforms.some(row=>row.pathname===pathname));
   const payload={caseTitle:info.title,observation,...(retained??{}),transforms,errors,missingModules,incomplete:incomplete||Boolean(retained?.retention.incomplete)||missingModules.length>0||!observation?.activation?.length||Boolean(observation?.incomplete),clock:'page.performance/timeOrigin; Node persistence wall clock separate',nodePersistedAt:new Date().toISOString()};
   try{await writeFile(info.outputPath('board-admission-observation.json'),JSON.stringify(payload,null,2));}
   catch{safeBoardDiagnostic('evidence-write-incomplete');}
   try{await info.attach('board-admission-observation',{body:JSON.stringify(payload),contentType:'application/json'});}
   catch{safeBoardDiagnostic('evidence-attachment-incomplete');}
   if(installed){try{await page.unroute(pattern,handler);}catch{safeBoardDiagnostic('route-disposal-incomplete');}}
   }catch{safeBoardDiagnostic('evidence-persist-incomplete');}finally{sourceRetention?.stop();}
  },
 };
}
