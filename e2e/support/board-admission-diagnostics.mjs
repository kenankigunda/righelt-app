import {installComputerRecoveryBinding} from './computer-recovery-binding.mjs';
import {COMPUTER_UI_FRAME_MEASURE} from '../../apps/web/shell/frame-presentation.js';
import {readFile, writeFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';

const hash = value => createHash('sha256').update(value).digest('hex');
export const transformBoardAdmissionModule = (source, recipe) => {
 if(hash(source)!==recipe.sourceSha256)throw new Error('Board diagnostic source hash mismatch');
 let result=source, previous=source.length;
 for(const operation of [...recipe.operations].reverse()){
  if(operation.end>previous || source.slice(operation.start,operation.end)!==operation.before)throw new Error('Board diagnostic range mismatch');
  if(source.split(operation.anchor).length-1!==operation.anchorCount)throw new Error('Board diagnostic anchor count mismatch');
  result=result.slice(0,operation.start)+operation.after+result.slice(operation.end);previous=operation.start;
 }
 result=recipe.prefix+result;
 if(hash(result)!==recipe.outputSha256)throw new Error('Board diagnostic output hash mismatch');
 return result;
};

export const SOURCE_PRESS_PREFIX='[righelt-source-window-v1]';
export const COMPUTER_RECOVERY_FINAL_PREFIX='[righelt-computer-final-read-v1]';
// Separate from the 512KiB authority cap: the full DTO also contains up to
// 1024 journal rows and 1064 scalar readiness rows. Leave generous headroom,
// refuse unexpected expansion, and never truncate any producer's evidence.
export const COMPUTER_RECOVERY_FINAL_MAX_BYTES=4*1024*1024;
export const SOURCE_PRESS_MAX_BYTES=512*1024;
export const COMPUTER_RECOVERY_CATEGORIES=Object.freeze(['rules_timeout','stale_state','session_changed','sync_recovering','journal_timeout','storage_reset','invalid_credentials','invalid_action','move-not-submitted','computer_control_changed','invalid_rules_response','upgrade_required']);
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

// The runner's existing fixture slot includes setup and teardown, never body.
export const COMPUTER_RECOVERY_FIXTURE_BUDGET_MS=5000;
export const COMPUTER_RECOVERY_CLEANUP_RESERVE_MS=750;
export async function runComputerRecoveryPersistence(diagnostic,{setupElapsedMs,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const start=now(),setup=Number.isFinite(setupElapsedMs)&&setupElapsedMs>=0?setupElapsedMs:COMPUTER_RECOVERY_FIXTURE_BUDGET_MS;
 const remainingMs=()=>Math.max(0,COMPUTER_RECOVERY_FIXTURE_BUDGET_MS-setup-(now()-start));
 let timer;const expired=()=>{const state=diagnostic.finalRecoveryHandoff?.end(),error=Error('Computer recovery fixture budget exhausted');return state?.cleanupIncomplete?new AggregateError([error,Error('Computer recovery handoff listener cleanup incomplete')],'Computer recovery fixture budget and cleanup failed'):error;};
 const deadline=new Promise((_,reject)=>{timer=setTimer(()=>reject(expired()),remainingMs());});
 // Own both promises even when the deadline wins. Persist still attempts each
 // sink/route independently; an overrun can never become a successful fixture.
 const work=Promise.resolve().then(()=>diagnostic.persist({remainingMs,setTimer,clearTimer}));
 let primary;try{const value=await Promise.race([work,deadline]);if(remainingMs()<=0)throw expired();return value;}
 catch(error){primary=error;throw error;}
 finally{clearTimer(timer);const state=diagnostic.finalRecoveryHandoff?.end();if(state?.cleanupAttemptedHere&&state.cleanupIncomplete)throw new AggregateError([...(primary?[primary]:[]),Error('Computer recovery handoff listener cleanup incomplete')],'Computer recovery fixture cleanup failed');}
}

// One self-contained guard is used by the Node receiver and mechanically embedded
// in the existing final read. Reject values JSON would otherwise silently change.
export function cloneComputerRecoveryHandoff(packet,expected,maxBytes){
 const bad=(reason='handoff-invalid')=>{const error=Error('Invalid computer recovery handoff');error.recoveryReason=reason;throw error;};
 const copy=(value,seen=new Set(),depth=0)=>{
  if(value===null||typeof value==='boolean'||typeof value==='string'&&value.length<=2048||typeof value==='number'&&Number.isFinite(value))return value;
  if(!value||typeof value!=='object'||depth>12||seen.has(value))bad();
  seen.add(value);const descriptors=Object.getOwnPropertyDescriptors(value),array=Array.isArray(value),out=array?Object.setPrototypeOf([],null):Object.create(null);
  if(array)for(let i=0;i<descriptors.length.value;i++)if(!Object.hasOwn(descriptors,String(i)))bad();
  for(const key of Reflect.ownKeys(descriptors)){
   if(typeof key!=='string'||!Object.hasOwn(descriptors[key],'value'))bad();
   if(array&&key==='length')continue;
   Object.defineProperty(out,key,{value:copy(descriptors[key].value,seen,depth+1),enumerable:true,writable:false,configurable:false});
  }
  seen.delete(value);return Object.freeze(out);
 };
 const envelope=copy(packet);
 if(envelope.namespace!==expected.namespace||envelope.readId!==expected.readId||envelope.gameId!==expected.gameId||envelope.documentGeneration!==expected.documentGeneration)bad('foreign-handoff');
 const observation=envelope.observation;
 if(!Number.isFinite(envelope.timeOrigin)||envelope.timeOrigin<=0||!Number.isFinite(observation?.timeOrigin)||observation.timeOrigin<=0||typeof envelope.documentNonce!=='string'||!envelope.documentNonce||envelope.documentNonce.length>128||observation.documentNonce!==envelope.documentNonce||observation?.recoveryNamespace!==expected.namespace||observation?.version!==1)bad('foreign-document');
 const serialized=JSON.stringify(envelope);
 if(serialized.length>maxBytes||new TextEncoder().encode(serialized).byteLength>maxBytes)bad();
 return envelope;
}

// This final snapshot is a plain-data DTO. Copy its own data without invoking
// inherited JSON hooks; optional journal undefined/holes keep persisted JSON rules.
export function cloneFinalRecoveryJSONDomain(input){
 const seen=new Set();
 const copy=value=>{
  if(value===null||value===undefined||typeof value==='boolean'||typeof value==='string')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:null;
  if(typeof value!=='object'||seen.has(value))throw Error('Invalid final recovery snapshot');
  seen.add(value);const descriptors=Object.getOwnPropertyDescriptors(value),array=Array.isArray(value),out=array?Object.setPrototypeOf([],null):Object.create(null);
  if(!array){
   const prototypes=new Set();
   for(let proto=Object.getPrototypeOf(value);proto;proto=Object.getPrototypeOf(proto)){
    if(prototypes.has(proto)||Object.hasOwn(proto,'constructor')&&Object.getPrototypeOf(proto)!==null)throw Error('Unsupported final recovery DTO object');
    prototypes.add(proto);
   }
  }
  if(array)out.length=descriptors.length.value;
  for(const key of Reflect.ownKeys(descriptors)){
   if(descriptors[key].enumerable===false)continue;
   if(typeof key!=='string'||!Object.hasOwn(descriptors[key],'value'))throw Error('Invalid final recovery snapshot descriptor');
   if(array&&key==='length')continue;
   Object.defineProperty(out,key,{value:copy(descriptors[key].value),enumerable:true,writable:false,configurable:false});
  }
  seen.delete(value);return out;
 };
 return copy(input);
}

export function readComputerRecoverySnapshot({measurementName,recoveryRead}){
      let readinessPage;
      try{readinessPage=globalThis.__righeltReadinessFreeze?.();}catch{readinessPage={incomplete:true,reason:'snapshot-unavailable'};}
      const match=location.hash.match(/^#\/game\/([^?#/]+)/);
      const boardRecovery=recoveryRead?{...recoveryRead,gameId:match?decodeURIComponent(match[1]):null,documentNonce:globalThis.__boardAdmissionRecoveryDocument??null,timeOrigin:performance.timeOrigin,observation:globalThis.__boardAdmissionObservation??null}:null;
      return {...window.retreatJournalObservations,...(boardRecovery?{boardRecovery}:{}),presentation:performance.getEntriesByName(measurementName).at(-1)?.detail??null,...(readinessPage?{readinessPage}:{})};
    }

// Compiled on Node, then serialized normally by Playwright. No browser eval or
// second Page read. Optional journal fields retain their existing persisted JSON
// domain; the authority-bearing recovery packet is validated BEFORE encoding.
export function createComputerRecoveryJSONRead(read,publishConsole=false){
 return new Function('input',`"use strict";const guard=(${cloneComputerRecoveryHandoff.toString()});const snapshot=(${cloneFinalRecoveryJSONDomain.toString()});const value=(${read.toString()})(input);if(input.recoveryRead){value.boardRecovery=guard(value.boardRecovery,input.recoveryRead,${SOURCE_PRESS_MAX_BYTES});}const serialized=JSON.stringify(snapshot(value));${publishConsole?`if(input.recoveryRead){if(serialized.length>${COMPUTER_RECOVERY_FINAL_MAX_BYTES}||new TextEncoder().encode(serialized).byteLength>${COMPUTER_RECOVERY_FINAL_MAX_BYTES})throw Error("Final recovery snapshot too large");console.debug(${JSON.stringify(COMPUTER_RECOVERY_FINAL_PREFIX)}+serialized);}`:""}return serialized;`);
}

// Node-only owner of the one existing final afterEach read. No browser operation.
export function createComputerRecoveryHandoff(page,namespace){
 let gameId,ticket,result,delivery,retained=false,consumed=false,ended=false,listenerRemoved=false,cleanupIncomplete=false,journalReadTimedOut=false,documentGeneration=0;
 let consoleMode=false,consoleInstalled=false,consoleText,consoleDelivery,resolveConsole,originalCall,originalSettled=false,originalRaw;
 const fail=reason=>{if(!result?.incomplete)result={incomplete:true,reason,observation:null};resolveConsole?.(null);};
 const navigated=frame=>{if(frame===page.mainFrame()){documentGeneration++;if(ticket)fail('foreign-document');}};
 page.on('framenavigated',navigated);
 const capture=(owner,packet)=>{
   if(ended||consumed){return;}
   if(result){fail('handoff-reused');return;}
   if(owner!==page){fail('foreign-page');return;}
   try{
    if(!ticket||!packet){fail('handoff-missing');return;}
    const envelope=cloneComputerRecoveryHandoff(packet,{namespace,readId:ticket.readId,gameId,documentGeneration},SOURCE_PRESS_MAX_BYTES);
    const observation=envelope.observation,immutable=observation;
    result=Object.freeze({incomplete:false,reason:null,namespace,readId:ticket.readId,gameId,documentGeneration,documentNonce:envelope.documentNonce,timeOrigin:envelope.timeOrigin,observationTimeOrigin:observation.timeOrigin,observation:immutable});
   }catch(error){let reason='handoff-invalid';try{const value=Object.getOwnPropertyDescriptor(error,'recoveryReason')?.value;if(['foreign-handoff','foreign-document'].includes(value))reason=value;}catch{}fail(reason);}
  };
 const consoleListener=message=>{try{
  const text=message.text();if(typeof text!=='string'||!text.startsWith(COMPUTER_RECOVERY_FINAL_PREFIX))return;
  if(!ticket||!consoleMode||message.page()!==page||message.worker()!==null||message.type()!=='debug'){fail('foreign-page');return;}
  if(consoleText!==undefined){fail('handoff-reused');return;}
  const raw=text.slice(COMPUTER_RECOVERY_FINAL_PREFIX.length);
  if(raw.length>COMPUTER_RECOVERY_FINAL_MAX_BYTES||Buffer.byteLength(raw,'utf8')>COMPUTER_RECOVERY_FINAL_MAX_BYTES){fail('handoff-invalid');return;}
  const value=cloneFinalRecoveryJSONDomain(JSON.parse(raw));
  capture(page,value?.boardRecovery);if(result?.incomplete)return;
  consoleText=raw;resolveConsole(value);
 }catch{fail('handoff-invalid');}};
 const removeListener=()=>{if(listenerRemoved)return;listenerRemoved=true;
  try{page.off('framenavigated',navigated);}catch{cleanupIncomplete=true;fail('handoff-listener-cleanup-failed');}
  if(consoleInstalled)try{page.off('console',consoleListener);}catch{cleanupIncomplete=true;fail('handoff-listener-cleanup-failed');}
 };
 return {
  bindGame(id){if(gameId||typeof id!=='string'||!id)throw Error('Recovery game scope unavailable');gameId=id;},
  begin(owner,{consoleDelivery:useConsole=false}={}){if(owner!==page||!gameId||ticket||consumed||ended)throw Error('Recovery final read scope unavailable');ticket=Object.freeze({namespace,readId:randomUUID(),gameId,documentGeneration});
   if(useConsole){consoleMode=true;consoleDelivery=new Promise(resolve=>{resolveConsole=resolve;});delivery=consoleDelivery;consoleInstalled=true;try{page.on('console',consoleListener);}catch(error){fail('handoff-listener-install-failed');throw error;}}
   return ticket;},
  capture,
  retain(owner,promise){
   if(owner!==page||!ticket||retained||consumed||ended){fail('foreign-handoff');return;}
   retained=true;
   // The original promise owns rejection even if journal persistence fails first.
   delivery=Promise.resolve(promise).then(value=>{
    if(ended||consumed)return;
    if(value?.boardRecovery)capture(owner,value.boardRecovery);else fail('read-missing');
   },()=>{if(!ended&&!consumed)fail('read-failed');});
  },
  retainConsoleRead(owner,promise){
   if(owner!==page||!ticket||!consoleMode||retained||consumed||ended){fail('foreign-handoff');throw Error('Recovery console read scope unavailable');}
   retained=true;
   // Own rejection immediately, but never report success before the original
   // call settles in the same afterEach hook, including its tracing barrier.
   originalCall=Promise.resolve(promise).then(raw=>{originalSettled=true;originalRaw=raw;return raw;},error=>{originalSettled=true;fail('read-failed');throw error;});
   originalCall.catch(()=>{});
   return consoleDelivery;
  },
  async completeOriginalRead(){
   if(!consoleMode||!originalCall){fail('read-missing');throw Error('Recovery original call unavailable');}
   const raw=await originalCall;
   if(typeof raw!=='string'||consoleText===undefined||raw!==consoleText)fail('handoff-conflict');
   if(result?.incomplete)throw Error('Computer recovery original call incomplete: '+result.reason);
  },
  journalTimedOut(){journalReadTimedOut=true;if(consoleMode)fail('read-timed-out');},
  async awaitDelivery({remainingMs=()=>0,setTimer=setTimeout,clearTimer=clearTimeout}={}){
   if(result||!delivery)return;
   const wait=Math.max(0,remainingMs()-COMPUTER_RECOVERY_CLEANUP_RESERVE_MS);
   if(!Number.isFinite(wait)||wait<=0){fail('read-budget-exhausted');return;}
   let timer;try{
    await Promise.race([delivery,new Promise(resolve=>{timer=setTimer(()=>{fail('read-budget-exhausted');resolve();},wait);})]);
   }finally{clearTimer(timer);}
  },
  failed(reason){fail(['read-failed','read-timed-out','read-missing'].includes(reason)?reason:'read-failed');},
  end(){ended=true;if(!consumed)fail('fixture-ended');const cleanupAttemptedHere=!listenerRemoved;removeListener();return{cleanupIncomplete,cleanupAttemptedHere};},
  consume(){if(consumed)return Object.freeze({incomplete:true,reason:'handoff-reused',observation:null});if(consoleMode&&(!originalSettled||typeof originalRaw!=='string'||originalRaw!==consoleText))fail('read-pending-or-conflicting');consumed=true;
   if(result&&!result.incomplete&&result.documentGeneration!==documentGeneration)fail('foreign-document');
   removeListener();
   return Object.freeze({...result??{incomplete:true,reason:'handoff-missing',observation:null},journalReadTimedOut,cleanupIncomplete});},
 };
}
export async function installComputerRecoveryBindingOwner(page,namespace,owner,options={}){
 let activeTicket,beginAt,started=false,poisoned=false;
 const transport=await installComputerRecoveryBinding(page,{namespace,produce:createComputerRecoveryJSONRead(readComputerRecoverySnapshot),measurementName:COMPUTER_UI_FRAME_MEASURE,maxBytes:COMPUTER_RECOVERY_FINAL_MAX_BYTES,
  capture(value){if(!activeTicket||!value?.boardRecovery)throw Error('Final recovery packet missing');cloneComputerRecoveryHandoff(value.boardRecovery,activeTicket,SOURCE_PRESS_MAX_BYTES);owner.capture(page,value.boardRecovery);},failed:reason=>{poisoned=true;owner.failed(reason);},...options});
 return{
  ...owner,
  begin(pageOwner,settings){beginAt=performance.now();activeTicket=owner.begin(pageOwner);if(settings?.bindingDelivery){transport.begin(activeTicket,beginAt);return activeTicket;}return activeTicket;},
  startBindingRead(pageOwner){if(pageOwner!==page||!activeTicket||started)throw Error('Final recovery binding read scope unavailable');started=true;return transport.start();},
  async completeOriginalRead(){await transport.complete();if(poisoned)throw Error('Final recovery binding incomplete');},
  journalTimedOut(){owner.journalTimedOut();if(started)transport.fail('read-timed-out');},
  disposeBindingDelivery:()=>transport.dispose(),
  consume(){if(started&&!transport.healthy())owner.failed('read-failed');const result=owner.consume(),binding=transport.report();return{...result,cleanupIncomplete:result.cleanupIncomplete||binding.cleanupIncomplete,binding};},
  end(){transport.cancel();return owner.end();},
 };
}
export async function persistComputerRecoveryEvidence({handoff,info,payload,write=writeFile,removeRoute,primaryError}){
 const failures=[];
 const operations=[()=>write(info.outputPath('board-admission-observation.json'),JSON.stringify(payload,null,2)),()=>info.attach('board-admission-observation',{body:JSON.stringify(payload),contentType:'application/json'}),removeRoute];
 const settled=await Promise.allSettled(operations.map(operation=>Promise.resolve().then(operation)));
 for(const value of settled)if(value.status==='rejected')failures.push(value.reason);
 if(handoff.incomplete)failures.unshift(Error('Computer recovery final handoff incomplete: '+handoff.reason));
 if(handoff.cleanupIncomplete)failures.push(Error('Computer recovery handoff listener cleanup incomplete'));
 if(failures.length)throw new AggregateError([...(primaryError?[primaryError]:[]),...failures],'Computer recovery evidence incomplete');
}

// Serialized by Playwright. Only allowlisted scalars and local weak equality
// tokens leave the page; original app objects and stable keys are never copied.
export function installBoardAdmissionCollector({targetRow,targetCol,sourceAttemptOrdinal,recoveryCategories,recoveryNamespace,armAction=null}){
 if(sourceAttemptOrdinal!==undefined&&(!Number.isSafeInteger(sourceAttemptOrdinal)||sourceAttemptOrdinal<1))throw Error('Invalid source attempt ordinal');
 const sourceEnabled=sourceAttemptOrdinal!==undefined;let sourceActive=false,sourceRef=null,sourceReads=0;
 const subjects=new WeakMap();let next=0,sequence=0,armed=false;
 const log={version:1,first:[],tail:[],firstActivation:[],activation:[],activationGeneration:0,supersededActivations:0,dropped:0,activationDropped:0,firstSourceRead:null,lastSourceRead:null,sourceReadCount:0,incomplete:false,timeOrigin:performance.timeOrigin};
 if(recoveryNamespace){
  const documentNonce=crypto.randomUUID();
  Object.defineProperty(globalThis,'__boardAdmissionRecoveryDocument',{value:documentNonce,writable:false,configurable:false});
  log.recoveryNamespace=recoveryNamespace;log.documentNonce=documentNonce;
  // Separate timeout observations never churn the existing Board/source buffers.
  const rulesTimeouts=log.rulesTimeouts={version:1,timeOrigin:log.timeOrigin,rows:[],dropped:0,incomplete:false};let timeoutSequence=0;
  const dropTimeout=()=>{rulesTimeouts.dropped++;rulesTimeouts.incomplete=true;};
  globalThis.__boardAdmissionRulesTimeout=value=>{try{
   if(!value||typeof value!=='object')throw Error('Invalid timeout scalar packet');
   const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors),allowed=['jobId','type','scopeKind','active'];
   if(keys.length!==allowed.length||keys.some(key=>!allowed.includes(key))||allowed.some(key=>!Object.hasOwn(descriptors[key]??{},'value')))throw Error('Invalid timeout descriptor');
   const jobId=descriptors.jobId.value,type=descriptors.type.value,scopeKind=descriptors.scopeKind.value,active=descriptors.active.value;
   if(!Number.isSafeInteger(jobId)||jobId<1||!['project','equivalent','previews','rush-guidance','other'].includes(type)||!['admit','project','reconcile','piece','rush-guidance','other'].includes(scopeKind)||typeof active!=='boolean')throw Error('Invalid timeout scalar');
   const now=performance.now();if(!Number.isFinite(now)||now<0)throw Error('Invalid timeout clock');
   if(rulesTimeouts.rows.length===64){dropTimeout();return;}
   rulesTimeouts.rows.push({sequence:++timeoutSequence,jobId,type,scopeKind,active,now});
  }catch{dropTimeout();}};

 }
 if(sourceEnabled)log.sourceWindow={expectedOrdinal:sourceAttemptOrdinal,attemptsObserved:0,observed:false,markerRecorded:false,first:[],tail:[],dropped:0,projectionFailures:0,incomplete:true,lastFailure:'source-attempt-unobserved'};
 const sourceFailure=category=>{try{log.incomplete=true;if(sourceActive){log.sourceWindow.incomplete=true;log.sourceWindow.projectionFailures++;log.sourceWindow.lastFailure=category;}}catch{}};
 const token=value=>{
  if(!value || !['object','function'].includes(typeof value))return null;
  if(!subjects.has(value))subjects.set(value,++next);return subjects.get(value);
 };
 const scalarKeys=new Set(['value','row','col','revision','phase','moves','previews','type','kind','interactive','sameNodes','mounted','positionChanged','preservePiecePreviews','resetSelection','legalTarget','hasPreviewAtClicked','hasClickedPiece','allowFreeSelection','usesHoverTargetSelection','count','retryAttempt','reconcileFirst','hadRuntime','trusted','rootToken','callbackToken','eventToken','targetToken','currentTargetToken','currentRootToken','cellRootToken','targetConnected','currentRootConnected','pathContainsCurrentRoot','dispatchPhase','pointerId','connected','pieceChanged','hasSelectedPiece','requestId','button','buttons','sourceConnected']);
 // Runtime errors have a dedicated closed schema. No arbitrary error strings or getters.
 const errorNames=["Error","TypeError","RangeError","ReferenceError","SyntaxError","URIError","EvalError","AggregateError"], errorCategories=["rules_cancelled","invalid_rules_response","rules_worker_failed","rules_timeout","session_changed","stale_state","journal_timeout","sync_recovering","storage_reset","storage_generation_unverified","invalid_saved_command","cleanup_unverified","untracked_saved_command","invalid_cleanup_receipt"];
 const errorField=(data,key,allowed)=>{
  try{
   const descriptor=data!==null&&['object','function'].includes(typeof data)?Object.getOwnPropertyDescriptor(data,key):null;
   return descriptor&&Object.hasOwn(descriptor,'value')&&typeof descriptor.value==='string'?allowed.find(value=>value===descriptor.value)??null:null;
  }catch{return null;}
 };
 const sanitize=(data,event)=>{
  if(event==='computer-session-recovery-error')return{errorCategory:errorField(data,'errorCategory',recoveryCategories??[])};
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
  if(sourceActive){
   const window=log.sourceWindow;
   if(row.event==='fixture-source-class-read'&&row.count===sourceAttemptOrdinal)window.markerRecorded=true;
   if(window.first.length<64)window.first.push(row);
   else{if(window.tail.length===64){window.tail.shift();window.dropped++;window.incomplete=true;}window.tail.push(row);}
  }
 }catch{sourceFailure('record-projection-failed');}};
 if(recoveryCategories){
  log.firstComputerRecovery=null;
  globalThis.__boardAdmissionRecovery=error=>{try{
   let category=null;
   for(const key of ['code','message']){
    let descriptor;try{descriptor=error&&(typeof error==='object'||typeof error==='function')?Object.getOwnPropertyDescriptor(error,key):null;}catch{category=null;break;}
    if(!descriptor||!Object.hasOwn(descriptor,'value')||typeof descriptor.value!=='string')continue;
    category=recoveryCategories.find(value=>value===descriptor.value)??(key==='message'&&descriptor.value==='Rules calculation timed out'?'rules_timeout':null);
    if(category!==null)break;
   }
   log.firstComputerRecovery??={observed:true,errorCategory:category};
   record('computer-session-recovery-error',{errorCategory:category});
  }catch{log.incomplete=true;}};
 }
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
  const matchingActivation=armAction==='end-turn'
   ? event.type==='click'&&event.isTrusted===false&&target?.dataset?.boardPreviewAction==='end-turn'
   : armAction===null&&event.isTrusted&&event.type==='pointerdown'&&row===targetRow&&col===targetCol;
  if(dispatchPhase==='capture' && matchingActivation){
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

export async function installBoardAdmissionDiagnostics(page,info,{targetRow,targetCol,baseURL,sourceAttemptOrdinal,computerSessionRecovery=false,moduleTransform,armAction=null}){
 if(sourceAttemptOrdinal!==undefined&&(!Number.isSafeInteger(sourceAttemptOrdinal)||sourceAttemptOrdinal<1))throw Error('Invalid source attempt ordinal');
 const recipes=JSON.parse(await readFile(new URL(computerSessionRecovery?'./computer-session-recovery-transformation.json':'./board-admission-transformations.json',import.meta.url),'utf8'));
 const transforms=[],errors=[];let installed=false;
 const recoveryNamespace=computerSessionRecovery?randomUUID():null;
 let recoveryHandoff=computerSessionRecovery?createComputerRecoveryHandoff(page,recoveryNamespace):null;
 const origin=new URL(baseURL).origin;
 const sourceRetention=sourceAttemptOrdinal===undefined?null:createBoardSourceConsoleRetention(page,sourceAttemptOrdinal);
 const handler=async route=>{
  const pathname=new URL(route.request().url()).pathname,recipe=recipes[pathname];
  if(!recipe){await route.continue();return;}
  try{
   const response=await route.fetch();const source=await response.text();
   const transformed=transformBoardAdmissionModule(source,recipe);
   const body=moduleTransform?moduleTransform(pathname,source,transformed):transformed;
   transforms.push({pathname,sourceSha256:hash(source),outputSha256:hash(body),matches:recipe.operations.length});
   await route.fulfill({response,body});
  }catch{
   errors.push({category:'module-transform-failed',pathname});
   await route.abort('failed');
  }
 };
 const pattern=url=>url.origin===origin && Object.hasOwn(recipes,url.pathname);
 try{
  if(recoveryHandoff)recoveryHandoff=await installComputerRecoveryBindingOwner(page,recoveryNamespace,recoveryHandoff);
  if(sourceAttemptOrdinal===undefined)await page.addInitScript(installBoardAdmissionCollector,{targetRow,targetCol,armAction,...(computerSessionRecovery?{recoveryCategories:COMPUTER_RECOVERY_CATEGORIES,recoveryNamespace}:{})});
  else await page.addInitScript({content:`(()=>{const SOURCE_PRESS_PREFIX=${JSON.stringify(SOURCE_PRESS_PREFIX)};const SOURCE_PRESS_MAX_BYTES=${SOURCE_PRESS_MAX_BYTES};const cloneBoardSourceHandoff=(${cloneBoardSourceHandoff.toString()});(${installBoardAdmissionCollector.toString()})(${JSON.stringify({targetRow,targetCol,sourceAttemptOrdinal,armAction,...(computerSessionRecovery?{recoveryCategories:COMPUTER_RECOVERY_CATEGORIES,recoveryNamespace}:{})})});})();`});
  await page.route(pattern,handler);installed=true;
 }catch(error){
  sourceRetention?.stop();const cleanup=[];
  try{await recoveryHandoff?.disposeBindingDelivery?.();}catch(failure){cleanup.push(failure);}
  const disposed=recoveryHandoff?.consume();if(disposed?.cleanupIncomplete)cleanup.push(Error('Computer recovery handoff listener cleanup incomplete'));
  if(cleanup.length)throw new AggregateError([error,...cleanup],'Diagnostic setup and cleanup failed');throw error;
 }
 return {
  finalRecoveryHandoff:recoveryHandoff,
  async checkpoint(){
   if(!sourceRetention)return;
   sourceRetention.stop();
   try{sourceRetention.capture(await page.evaluate(()=>globalThis.__boardAdmissionSourceSnapshot?.()??null));}
   catch{sourceRetention.failed();}
  },
  async persist(options={}){
   if(recoveryHandoff){
    try{
    let bindingCleanupError;try{await recoveryHandoff.disposeBindingDelivery();}catch(error){bindingCleanupError=error;recoveryHandoff.failed('read-failed');}
    await recoveryHandoff.awaitDelivery(options);
    const handoff=recoveryHandoff.consume(),observation=handoff.observation;
    const missingModules=Object.keys(recipes).filter(pathname=>!transforms.some(row=>row.pathname===pathname));
    const payload={caseTitle:info.title,observation,handoff:{...handoff,observation:undefined},transforms,errors,missingModules,incomplete:handoff.incomplete||errors.length>0||missingModules.length>0||!observation?.activation?.length||Boolean(observation?.incomplete)||Boolean(observation?.rulesTimeouts?.incomplete),clock:'page.performance/timeOrigin; Node persistence wall clock separate',nodePersistedAt:new Date().toISOString()};
    await persistComputerRecoveryEvidence({handoff,info,payload,primaryError:bindingCleanupError,removeRoute:async()=>{if(installed)await page.unroute(pattern,handler);}});return;
    }finally{sourceRetention?.stop();}
   }
   try{
   let observation=null,incomplete=errors.length>0;
   try{observation=await page.evaluate(()=>globalThis.__boardAdmissionObservation??null);if(!observation)incomplete=true;}catch{incomplete=true;}
   sourceRetention?.stop();
   const retained=sourceRetention?.snapshot(observation);
   const missingModules=Object.keys(recipes).filter(pathname=>!transforms.some(row=>row.pathname===pathname));
   const payload={caseTitle:info.title,activationMode:armAction==='end-turn'?'synthetic-end-turn-click':'trusted-board-pointerdown',observation,...(retained??{}),transforms,errors,missingModules,incomplete:incomplete||Boolean(retained?.retention.incomplete)||missingModules.length>0||!observation?.activation?.length||Boolean(observation?.incomplete),clock:'page.performance/timeOrigin; Node persistence wall clock separate',nodePersistedAt:new Date().toISOString()};
   try{await writeFile(info.outputPath('board-admission-observation.json'),JSON.stringify(payload,null,2));}
   catch{safeBoardDiagnostic('evidence-write-incomplete');}
   try{await info.attach('board-admission-observation',{body:JSON.stringify(payload),contentType:'application/json'});}
   catch{safeBoardDiagnostic('evidence-attachment-incomplete');}
   if(installed){try{await page.unroute(pattern,handler);}catch{safeBoardDiagnostic('route-disposal-incomplete');}}
   }catch{safeBoardDiagnostic('evidence-persist-incomplete');}finally{sourceRetention?.stop();}
  },
 };
}
