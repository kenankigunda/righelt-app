import {writeFile} from 'node:fs/promises';

// Read-only observation: wrappers always return the original native value or
// rethrow the original error. No retry, request, transaction or activation is added.
export function installPassiveCommandObservations(){
 const records=[];window.passiveCommandObservations=records;
 const envelope=value=>value&&typeof value==='object'?{gameId:value.gameId,identityId:value.identityId,clientCommandId:value.clientCommandId,kind:value.kind,fingerprint:value.fingerprint,authContextId:value.authContextId,expectedGameplayRevision:value.expectedGameplayRevision,operation:value.payload?.operation,action:value.payload?.action}:value;
 const state=()=>{let pending=[],readError;try{pending=Object.keys(JSON.parse(localStorage.getItem('righelt.pendingLocalGames')||'{}'));}catch(error){readError=String(error);}const board=document.querySelector('[data-testid="game-board-wrap"]');return {route:location.hash,focused:document.hasFocus(),hidden:document.hidden,pendingCreationGameIds:pending,storageReadError:readError,reconnecting:board?.getAttribute('data-reconnecting'),busy:board?.getAttribute('aria-busy'),lastError:window.__righeltLastError??null,metrics:{...window.__righeltLiveSyncMetrics}};};
 const note=(kind,details={})=>{try{if(records.length<1500)records.push({at:performance.now(),kind,state:state(),...details});}catch{/* Observation must not change the native operation. */}};
 window.commandObservationCheckpoint=phase=>note('checkpoint',{phase});
 const transactions=new WeakSet(),prototype=window.IDBObjectStore?.prototype;
 if(prototype)for(const method of ['add','put','delete','getAll']){
  const native=prototype[method];if(typeof native!=='function')continue;
  prototype[method]=function(...args){
   let request;try{request=Reflect.apply(native,this,args);}catch(error){note('journal-native-error',{method,error:String(error)});throw error;}
   try{if(this.name==='commands'){
    const tx=this.transaction,details={method,database:tx.db.name,value:method==='add'||method==='put'?envelope(args[0]):args[0]};note('journal-request',details);
    request.addEventListener('success',()=>{try{note('journal-request-success',{...details,result:method==='getAll'?request.result.map(envelope):undefined});}catch{}});
    request.addEventListener('error',()=>note('journal-request-error',{...details,error:String(request.error)}));
    if(!transactions.has(tx)){transactions.add(tx);for(const type of ['complete','abort','error'])tx.addEventListener(type,()=>note('journal-transaction',{database:tx.db.name,type,error:tx.error?String(tx.error):null}));}
   }}catch{/* Native request and its handlers remain untouched. */}
   return request;
  };
 }
 const nativeFetch=window.fetch;
 window.fetch=function(...args){
  const input=args[0],init=args[1],url=String(input?.url??input),method=init?.method??input?.method??'GET';let relevant=false,body;
  try{relevant=new URL(url,location.href).pathname.startsWith('/api/shell/games');if(typeof init?.body==='string')body=JSON.parse(init.body);}catch{}
  if(relevant)note('fetch-start',{url,method,command:envelope(body),commands:body?.commands?.map(envelope)});
  let promise;try{promise=Reflect.apply(nativeFetch,this,args);}catch(error){if(relevant)note('fetch-native-error',{url,method,error:String(error)});throw error;}
  if(relevant)void promise.then(response=>{try{note('fetch-response',{url,method,status:response.status,storageGeneration:response.headers.get('X-Righelt-Storage-Generation')});void response.clone().json().then(body=>note('fetch-body',{url,method,eventSeq:body.eventSeq,revision:body.game?.gameplayRevision,moveIds:body.game?.moves?.map(move=>move.moveId),outcomes:body.commandOutcomes}),()=>{});}catch{}},error=>note('fetch-rejected',{url,method,error:String(error)}));
  return promise;
 };
 const NativeSocket=window.WebSocket;
 window.WebSocket=new Proxy(NativeSocket,{construct(target,args,newTarget){const socket=Reflect.construct(target,args,newTarget);try{const url=String(args[0]);if(new URL(url,location.href).pathname.startsWith('/api/shell/games/')){
  socket.addEventListener('message',event=>{try{const body=JSON.parse(event.data);note('socket-received',{url,type:body.type,reason:body.reason,eventSeq:body.eventSeq,revision:body.game?.gameplayRevision,commandOutcome:body.commandOutcome,clientCommandId:body.clientCommandId});}catch{}});
  const send=socket.send;socket.send=function(...values){try{const body=JSON.parse(String(values[0]));note('socket-sent',{url,type:body.type,command:envelope(body),commands:body.commands?.map(envelope)});}catch{}return Reflect.apply(send,this,values);};
 }}catch{}return socket;}});
 note('installed');
}

export async function attachCommandObservations(page,info){
 const receipt=await page.evaluate(()=>({records:window.passiveCommandObservations??[],lastError:window.__righeltLastError??null})).catch(error=>({readError:String(error)}));
 const path=info.outputPath('native-command-observations.json');await writeFile(path,JSON.stringify(receipt,null,2));await info.attach('Passive native command observations',{path,contentType:'application/json'});
}
