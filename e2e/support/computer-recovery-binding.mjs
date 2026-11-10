import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {performance} from 'node:perf_hooks';

export const RECOVERY_BINDING_ACK='[righelt-final-binding-v1]';
export const RECOVERY_BINDING_DEADLINE_MS=2000;
export const RECOVERY_BINDING_TOTAL_MS=5000;
const INSTALLER_SOURCES=Object.freeze({
 'lib/utils/isomorphic/protocolMetainfo.js':'7db22e2f6e0e20f9db797ee3f3a86d4ec68b0e520975c7391a76bd42fe0da2e6',
 'lib/server/page.js':'3d236ad57de9eebdf4d165e3943522c041cafb0e136d479c9c0e9aeedeb0692a',
 'lib/client/page.js':'6a208320db739beea9330450e519a36df513556536f51ebf8b4fab1c60b250d5',
 'lib/server/dispatchers/pageDispatcher.js':'eccc0ce018eb6c8dc04b9ba495303fa88f6f1f7d560bec14082a7c06d7a526ba',
 'lib/server/dispatchers/dispatcher.js':'2095dd3718036f65d98497650ceee527cb8f23654b7edb7ee191420c01347358',
 'lib/server/trace/recorder/tracing.js':'5c7cb7524d514b6f3ffbb026f41d297d1517b4f5808ce82f2e3fcde617e50514',
 'lib/generated/bindingsControllerSource.js':'425b1f058ac1472f23ae78bb00b413d606aea4f4db207ff6156cb7064d21a2d4',
});
export async function requireRecoveryBindingInstaller(){
 const own=createRequire(path.join(process.cwd(),'package.json')),test=own.resolve('@playwright/test/package.json'),pw=createRequire(test).resolve('playwright/package.json'),core=createRequire(pw).resolve('playwright-core/package.json');
 if(JSON.parse(await readFile(core,'utf8')).version!=='1.59.1')throw Error('Unsupported recovery binding installer');
 for(const[file,expected]of Object.entries(INSTALLER_SOURCES))if(createHash('sha256').update(await readFile(path.join(path.dirname(core),file))).digest('hex')!==expected)throw Error('Recovery binding installer source changed: '+file);
}

// One setup closure per physical main document; no final-state read here.
export function armComputerRecoveryBinding(settings,produce){
 if(globalThis!==globalThis.top)return;
 const {publisherName,signalName,namespace,measurementName,ackPrefix,maxBytes}=settings;
 const ownerDocument=document,ownerWindow=globalThis,origin=performance.timeOrigin,armNonce=crypto.randomUUID(),publish=globalThis[publisherName],write=console.debug.bind(console);let assigned=false;
 const same=()=>{if(document!==ownerDocument||globalThis!==ownerWindow||globalThis.top!==ownerWindow||performance.timeOrigin!==origin)throw Error('Retired final recovery document');};
 const incomplete=()=>{try{write(ackPrefix+JSON.stringify({namespace,armNonce,phase:'failed'}));}catch{}};
 if(typeof publish!=='function'||Object.hasOwn(globalThis,signalName)){incomplete();return;}
 Object.defineProperty(globalThis,signalName,{configurable:true,set(signal){
  if(assigned||typeof signal!=='function'){incomplete();return;}assigned=true;
  // Never invoke signal: its client callback is not registered until the
  // configuration request returns. Only the preinstalled publisher is used.
  const work=(async()=>{
   same();const response=await publish({kind:'request',namespace,armNonce});same();
   if(response?.armNonce!==armNonce||response?.ticket?.namespace!==namespace)throw Error('Foreign final recovery ticket');
   const raw=produce({measurementName,recoveryRead:response.ticket});
   if(typeof raw!=='string'||raw.length>maxBytes||new TextEncoder().encode(raw).byteLength>maxBytes)throw Error('Final recovery payload too large');
   const accepted=await publish({kind:'payload',namespace,armNonce,readId:response.ticket.readId,raw});same();
   if(accepted?.namespace!==namespace||accepted?.armNonce!==armNonce||accepted?.readId!==response.ticket.readId||accepted?.phase!=='accepted')throw Error('Final recovery publisher rejected');
   write(ackPrefix+JSON.stringify({...accepted,phase:'complete'}));
  })();work.catch(incomplete);
 }});
}
export function createRecoveryBindingInit(produce){
 // Compile on Node and serialize normally. No browser eval, state read or
 // alternate schema; the exact existing compiled DTO producer is embedded.
 return new Function('settings',`return (${armComputerRecoveryBinding.toString()})(settings,(${produce.toString()}));`);
}

export async function installComputerRecoveryBinding(page,{namespace,produce,measurementName,capture,failed,maxBytes,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout,verifyInstaller=requireRecoveryBindingInstaller}){
 await verifyInstaller();
 const publisherName='__righeltFinalPublisher_'+randomUUID().replaceAll('-','_'),signalName='__righeltFinalSignal_'+randomUUID().replaceAll('-','_');
 let ticket,beginAt,totalDeadline,deadline,armNonce,value,raw,ack=false,signal,publisher,init,resolveDelivery,delivery,timer,totalTimer,primary,disposed=false,started=false,configSettled=false,configurationIssued=false,configurationIssuedAt,requestReceivedAt,payloadAt,completionAt,configSettledAt,disposeStartedAt,disposeDoneAt,disposeWork,disposeDone=false,stage='SETUP',failureStage,timeoutBudget;const owned=new Set(),cleanupErrors=[];
 const poison=reason=>{if(!primary){failureStage=stage;primary=Error('Final recovery binding: '+reason);}failed(reason==='foreign-document'?'read-failed':reason==='read-timed-out'?'read-timed-out':'read-failed');resolveDelivery?.(null);};
 const checkBudget=()=>{if(ticket&&now()>totalDeadline){timeoutBudget??='total';poison('read-timed-out');}else if(armNonce&&!ack&&now()>deadline){timeoutBudget??='read';poison('read-timed-out');}};
 const alive=()=>{checkBudget();if(disposed||primary||!ticket)throw primary??Error('Final recovery binding inactive');};
 const sourceOK=source=>source?.page===page&&source?.context===page.context()&&source?.frame===page.mainFrame();
 const publish=async(source,message)=>{
  const task=Promise.resolve().then(()=>{
   try{
    alive();if(!started||!configurationIssued)throw Error('Early final recovery assignment');if(!sourceOK(source)||message?.namespace!==namespace)throw Error('Foreign final recovery publisher');
    const keys=message.kind==='request'?['kind','namespace','armNonce']:['kind','namespace','armNonce','readId','raw'];if(Object.keys(message).length!==keys.length||Object.keys(message).some(key=>!keys.includes(key)))throw Error('Malformed final recovery publisher');
    if(message.kind==='request'){
     if(armNonce||typeof message.armNonce!=='string'||!message.armNonce||message.armNonce.length>128)throw Error('Repeated final recovery request');
     requestReceivedAt=now();armNonce=message.armNonce;stage='READING';deadline=Math.min(totalDeadline,requestReceivedAt+RECOVERY_BINDING_DEADLINE_MS);timer=setTimer(()=>{timeoutBudget??=deadline===totalDeadline?'total':'read';poison('read-timed-out');},Math.max(0,deadline-now()));return{ticket,armNonce};
    }
    if(message.kind!=='payload'||!armNonce||message.armNonce!==armNonce||message.readId!==ticket.readId||raw!==undefined)throw Error('Foreign/repeated final recovery payload');
    if(typeof message.raw!=='string'||message.raw.length>maxBytes||Buffer.byteLength(message.raw,'utf8')>maxBytes)throw Error('Final recovery payload too large');
    const parsed=JSON.parse(message.raw);capture(parsed);alive();raw=message.raw;value=parsed;payloadAt=now();stage='PUBLISHED';
    return{namespace,armNonce,readId:ticket.readId,documentNonce:parsed.boardRecovery.documentNonce,phase:'accepted'};
   }catch(error){checkBudget();poison(timeoutBudget?'read-timed-out':'read-failed');throw error;}
  });owned.add(task);try{return await task;}finally{owned.delete(task);}
 };
 const consoleMessage=message=>{try{
  const text=message.text();if(typeof text!=='string'||!text.startsWith(RECOVERY_BINDING_ACK))return;
  alive();if(text.length>2048||Buffer.byteLength(text,'utf8')>2048||message.page()!==page||message.worker()!==null||message.type()!=='debug')throw Error('Foreign final recovery completion');
  const data=JSON.parse(text.slice(RECOVERY_BINDING_ACK.length));if(data.phase!=='complete'||ack||!raw||data.namespace!==namespace||data.armNonce!==armNonce||data.readId!==ticket.readId||data.documentNonce!==value.boardRecovery.documentNonce)throw Error('Missing/conflicting final recovery completion');
  alive();ack=true;completionAt=now();stage='ACKED';clearTimer(timer);resolveDelivery(value);
 }catch{checkBudget();poison(timeoutBudget?'read-timed-out':'read-failed');}};
 const navigated=frame=>{if(ticket&&frame===page.mainFrame())poison('foreign-document');},closed=()=>poison('read-failed');
 const listeners=[['console',consoleMessage],['framenavigated',navigated],['close',closed],['crash',closed],['pageerror',closed]];
 const dispose=()=>{
  if(disposeWork)return disposeWork;disposeStartedAt=now();checkBudget();disposed=true;clearTimer(timer);disposeWork=(async()=>{
  for(const item of [signal,publisher,init])if(item)try{await item.dispose();}catch(error){cleanupErrors.push(error);}
  for(const[name,fn]of listeners)try{page.off(name,fn);}catch(error){cleanupErrors.push(error);}
  disposeDone=true;disposeDoneAt=now();checkBudget();clearTimer(totalTimer);if(!primary)stage='DISPOSED';if(cleanupErrors.length){poison('read-failed');throw new AggregateError([...(primary?[primary]:[]),...cleanupErrors],'Final recovery binding cleanup failed');}
 })();disposeWork.catch(()=>{});return disposeWork;
 };
 try{
  for(const[name,fn]of listeners)page.on(name,fn);
  publisher=await page.exposeBinding(publisherName,publish);
  init=await page.addInitScript(createRecoveryBindingInit(produce),{publisherName,signalName,namespace,measurementName,maxBytes,ackPrefix:RECOVERY_BINDING_ACK});
 }catch(error){try{await dispose();}catch(cleanup){throw new AggregateError([error,cleanup],'Final recovery setup and cleanup failed');}throw error;}
 return{
  begin(next,at){if(ticket||disposed||primary)throw Error('Final recovery binding scope unavailable');ticket=next;beginAt=at;totalDeadline=beginAt+RECOVERY_BINDING_TOTAL_MS;stage='ARMING';delivery=new Promise(resolve=>{resolveDelivery=resolve;});totalTimer=setTimer(()=>{timeoutBudget??='total';poison('read-timed-out');},Math.max(0,totalDeadline-now()));},
  start(){if(started||!ticket||primary)throw Error('Final recovery binding start unavailable');started=true;
   const operation=Promise.resolve().then(()=>{alive();configurationIssued=true;configurationIssuedAt=now();return page.exposeBinding(signalName,()=>{poison('read-failed');throw primary;});});
   signal=undefined;const original=operation.then(item=>{signal=item;configSettled=true;configSettledAt=now();checkBudget();return item;},error=>{configSettled=true;configSettledAt=now();checkBudget();poison('read-failed');throw error;});original.catch(()=>{});
   this.original=original;return delivery.then(snapshot=>{if(primary||!snapshot)throw primary??Error('Final recovery delivery missing');return snapshot;});},
  async complete(){let originalError;try{await this.original;}catch(error){originalError=error;}
   await Promise.allSettled([...owned]);if(!ack||!raw||!configSettled)poison('read-failed');
   try{await dispose();}catch(error){if(originalError)throw new AggregateError([originalError,error],'Final recovery configuration and cleanup failed');throw error;}
   if(originalError)throw originalError;if(primary)throw primary;
  },
  dispose,
  fail:poison,
  cancel(){if(started&&!disposed)poison('read-failed');},
  healthy:()=>Boolean(ack&&raw&&configSettled&&disposeDone&&!primary&&!cleanupErrors.length),
  report:()=>({kind:'source-pinned-binding-v2',started,stage,failureStage,beginAt,totalDeadline,deadline,configurationIssued,configurationIssuedAt,requestReceivedAt,armNonce,payloadAt,completionAt,configSettledAt,disposeStartedAt,disposeDoneAt,timeoutBudget,readBudgetMs:RECOVERY_BINDING_DEADLINE_MS,totalAcceptanceBudgetMs:RECOVERY_BINDING_TOTAL_MS,ack,configSettled,cleanupIncomplete:cleanupErrors.length>0,disposeDone,incomplete:Boolean(primary),reason:primary?.message??null,ownedCallbackTasks:owned.size,claim:'Browser publisher promise settled +owned callback work +signal configuration only; no global internal drain.'}),
 };
}
