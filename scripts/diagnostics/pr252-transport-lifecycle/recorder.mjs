// Passive metadata only. Never change an application callback's return/error path.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {errorMonitor} from 'node:events';
import {threadId} from 'node:worker_threads';
const root=process.env.RIGHELT_TRANSPORT_DIAGNOSTIC_OUT,boot=randomUUID(),pid=process.pid;
const ids=new WeakMap(),owners=new WeakMap(),watched=new WeakSet(),pending=new Set();
let ordinal=0,sequence=0,written=0,bytes=0,dropped=0,writeErrors=0,fd;
const MAX_ROWS=250000,MAX_BYTES=128*1024*1024;
const slot=path.basename(process.env.WRANGLER_LOG_PATH??'unavailable');
const id=value=>{if(!value||!['object','function'].includes(typeof value))return null;if(!ids.has(value))ids.set(value,++ordinal);return ids.get(value);};
function emit(type,data={},force=false){
 try{
  const row=JSON.stringify({boot,pid,threadId,slot,sequence:++sequence,nodeMonotonicNs:process.hrtime.bigint().toString(),type,...data})+'\n';
  if(!force&&(written>=MAX_ROWS||bytes+Buffer.byteLength(row)>MAX_BYTES)){dropped++;return;}
  if(fd===undefined){writeErrors++;return;}
  fs.writeSync(fd,row);written++;bytes+=Buffer.byteLength(row);
 }catch{writeErrors++;}
}
try{if(root){fs.mkdirSync(root,{recursive:true,mode:0o700});fd=fs.openSync(path.join(root,`${pid}-${boot}.jsonl`),'ax',0o600);}}catch{writeErrors++;}
const safe=fn=>(...args)=>{try{return fn(...args);}catch{writeErrors++;}};
const scalarError=error=>({name:['Error','TypeError','RangeError','AbortError','AggregateError'].includes(error?.name)?error.name:'Other',code:typeof error?.code==='string'&&/^[A-Z0-9_]{1,48}$/.test(error.code)?error.code:'other',syscall:['read','write','connect','accept','listen','shutdown'].includes(error?.syscall)?error.syscall:'other'});
const state=object=>({destroyed:object.destroyed===true,complete:object.complete===true,aborted:object.aborted===true,writableFinished:object.writableFinished===true});
function watch(object,kind,relation={}){
 const objectId=id(object);if(!objectId||watched.has(object))return objectId;
 watched.add(object);pending.add(objectId);emit('object-born',{objectId,kind,...relation});
 object.once('close',safe(()=>{pending.delete(objectId);emit('object-close',{objectId,kind,...relation,...state(object)});}));
 // errorMonitor observes errors without consuming the emitter's default behavior.
 object.on(errorMonitor,safe(error=>emit('object-error',{objectId,kind,...relation,...scalarError(error)})));
 return objectId;
}
function socket(socket,relation){
 const socketId=watch(socket,'socket',relation);
 emit('socket-assigned',{socketId,...relation,connecting:socket.connecting===true,localPort:socket.localPort??null,remotePort:socket.remotePort??null});
 socket.once('connect',safe(()=>emit('socket-connect',{socketId,...relation,localPort:socket.localPort??null,remotePort:socket.remotePort??null})));
 return socketId;
}
function route(request){
 const pathname=new URL(request.url,'http://owned.invalid').pathname;
 if(pathname==='/api/shell/games')return pathname;
 if(pathname.startsWith('/api/shell/games/'))return '/api/shell/games/:id/:operation';
 if(pathname.startsWith('/api/'))return '/api/:other';
 return '/:asset-or-control';
}
function logicalId(request){
 const pairs=request.rawHeaders??[];
 for(let i=0;i<pairs.length;i+=2)if(String(pairs[i]).toLowerCase()==='x-righelt-request-id')return /^[0-9a-f-]{36}$/i.test(pairs[i+1])?pairs[i+1]:null;
 return null;
}
export const createTransportObservation=safe((owner,target)=>{
 let ownerId=null,epoch=0;
 if(owner&&['object','function'].includes(typeof owner)){
  if(!owners.has(owner))owners.set(owner,{ownerId:id(owner),epoch:0});
  const value=owners.get(owner);ownerId=value.ownerId;epoch=++value.epoch;
 }
 const origin=++ordinal,base={origin,ownerId,epoch,targetPort:Number(target.port)};
 emit('origin-created',base);
 return {
  server:safe(server=>{const serverId=watch(server,'server',base);server.on('connection',safe(value=>socket(value,{...base,serverId})));server.on('listening',safe(()=>emit('origin-listening',{...base,serverId,port:server.address()?.port??null})));}),
  request:safe((request,response,upgrade=false)=>{
   const requestId=watch(request,'incoming-request',base),relation={...base,requestId,incomingSocketId:id(request.socket)};
   const frontendId=watch(response,upgrade?'upgrade-client':'frontend-response',relation);
   emit('incoming',{...relation,frontendId,logicalRequestId:logicalId(request),method:['GET','HEAD','POST','PUT','PATCH','DELETE','OPTIONS','CONNECT','TRACE'].includes(request.method)?request.method:'OTHER',route:route(request),upgrade});
   request.once('end',safe(()=>emit('incoming-end',{...relation,...state(request)})));
   request.once('aborted',safe(()=>emit('incoming-aborted',{...relation,...state(request)})));
   response.once('finish',safe(()=>emit('frontend-finish',{...relation,frontendId,...state(response)})));
   return relation;
  }),
  outgoing:safe((relation,outgoing)=>{
   const outgoingId=watch(outgoing,'outgoing-request',relation??base);
   outgoing.on('socket',safe(value=>socket(value,{...(relation??base),outgoingId,reusedSocket:outgoing.reusedSocket===true})));
   outgoing.once('finish',safe(()=>emit('outgoing-finish',{...(relation??base),outgoingId,...state(outgoing)})));
  }),
  response:safe((relation,incoming,upgrade=false,backend=null)=>{
   const responseId=upgrade?id(incoming):watch(incoming,'backend-response',relation??base);
   emit('backend-response',{...(relation??base),responseId,status:incoming.statusCode,upgrade,complete:incoming.complete===true});
   if(upgrade&&backend)socket(backend,{...(relation??base),responseId});
   if(!upgrade)incoming.once('end',safe(()=>emit('backend-end',{...(relation??base),responseId,...state(incoming)})));
  }),
  retire:safe(()=>emit('origin-retire',base)),close:safe(()=>emit('origin-close-requested',base)),
 };
});
export const inertTransportObservation=Object.freeze({server(){},request(){},outgoing(){},response(){},retire(){},close(){}});
emit('installed',{limits:{rows:MAX_ROWS,bytes:MAX_BYTES},node:process.version});
process.once('exit',()=>{emit('terminal',{written,bytes,dropped,writeErrors,pendingObjects:[...pending]},true);try{if(fd!==undefined)fs.closeSync(fd);}catch{}});
// Read-only control introspection; never used by the observed application path.
export const recorderSnapshot=()=>({written,bytes,dropped,writeErrors,pendingObjects:[...pending]});
