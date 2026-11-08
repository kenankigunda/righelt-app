import test,{mock} from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import {EventEmitter,errorMonitor} from 'node:events';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {pathToFileURL} from 'node:url';
import {deriveAdapter,ORIGINAL_ADAPTER_SHA256} from './derive.mjs';import {auditTransport} from './audit.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'transport-controls-'));process.env.RIGHELT_TRANSPORT_DIAGNOSTIC_OUT=root;process.env.WRANGLER_LOG_PATH='/controlled/api-1';
const recorderURL=new URL('./recorder.mjs',import.meta.url).href,source=fs.readFileSync(new URL('../../auth-worker-connections.mjs',import.meta.url),'utf8');
const derived=deriveAdapter(source,recorderURL),original=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64')),instrumented=await import('data:text/javascript;base64,'+Buffer.from(derived.source).toString('base64')),recorder=await import('./recorder.mjs');
const logical='7ebf61a5-94f2-417b-8aec-aa8407d09ad1';
function socket(calls){const value=new EventEmitter();value.localPort=9991;value.remotePort=9992;value.connecting=false;value.destroyed=false;value.destroy=function(){if(this.destroyed)return this;calls.push('socket.destroy');this.destroyed=true;this.emit('close');return this;};value.write=()=>{};value.pipe=target=>target;return value;}
async function fixture(module,{failure=false,abort=false,upgrade=false}={}){
 const calls=[],outgoing=[],sockets=[];let server;
 mock.method(http,'createServer',handler=>{server=new EventEmitter();server.handler=handler;server.listen=(port,host,done)=>{calls.push(['listen',port,host]);server.emit('listening');done();};server.address=()=>({port:9990});server.close=done=>{calls.push('server.close');server.emit('close');done();};return server;});
 mock.method(http,'request',(options,onResponse)=>{calls.push(['request',options]);const out=new EventEmitter();out.destroyed=false;out.destroy=()=>{calls.push('outgoing.destroy');out.destroyed=true;out.emit('close');};out.end=()=>out.emit('finish');out.respond=onResponse;outgoing.push(out);return out;});
 try{
  const connection=await module.createWorkerConnectionOrigin('http://127.0.0.1:9887');
  const incomingSocket=socket(calls),request=new EventEmitter(),response=upgrade?incomingSocket:new EventEmitter();sockets.push(incomingSocket);
  request.method='POST';request.url='/api/shell/games?DO_NOT_LOG_QUERY=token';request.rawHeaders=['Cookie','DO_NOT_LOG_COOKIE','X-Righelt-Request-Id',logical];request.socket=incomingSocket;request.complete=true;request.pipe=out=>{calls.push('request.pipe');assert.equal(out,outgoing[0]);request.emit('end');out.emit('finish');return out;};
  if(!upgrade){response.writeHead=(...args)=>calls.push(['writeHead',...args]);response.addTrailers=x=>calls.push(['trailers',x]);response.destroy=()=>{calls.push('response.destroy');response.destroyed=true;response.emit('close');};}
  server.emit('connection',incomingSocket);
  if(upgrade)server.emit('upgrade',request,response,Buffer.alloc(0));else server.handler(request,response);
  const out=outgoing[0],backendSocket=socket(calls);sockets.push(backendSocket);out.emit('socket',backendSocket);
  assert.equal(out.listenerCount('error'),1,'observer must not consume native outgoing errors');assert.equal(server.listenerCount('clientError'),0);
  const nativeError=Object.assign(Error('DO_NOT_LOG_ERROR_DETAIL'),{code:'ECONNRESET',syscall:'read'});
  if(failure){out.emit('error',nativeError);}
  else if(abort){request.emit('aborted');}
  else if(upgrade){
   const back=socket(calls);sockets.push(back);out.emit('upgrade',{statusCode:101,httpVersion:'1.1',rawHeaders:[],complete:true},back,Buffer.alloc(0));
  }else{
   const received=new EventEmitter();received.statusCode=200;received.statusMessage='OK';received.rawHeaders=['Content-Type','application/json','Connection','keep-alive'];received.complete=true;received.trailers={};received.pipe=target=>{assert.equal(target,response);calls.push('response.pipe');received.emit('end');received.emit('close');target.writableFinished=true;target.emit('finish');target.emit('close');return target;};out.respond(received);assert.equal(response.shouldKeepAlive,false);
  }
  request.emit('close');out.emit('close');for(const s of sockets)if(!s.destroyed)s.destroy();await connection.close();
  return{calls,requestCount:outgoing.length,url:connection.url.href};
 }finally{mock.restoreAll();}
}
test('strict full-module derivation has exact original inverse and refuses changed source',()=>{assert.equal(derived.originalSHA256,ORIGINAL_ADAPTER_SHA256);assert.equal(derived.inverseExact,true);assert.throws(()=>deriveAdapter(source+'\n',recorderURL));assert.equal(instrumented.createWorkerConnectionOrigin.length,original.createWorkerConnectionOrigin.length);});
for(const [name,options]of[['POST success',{}],['native error',{failure:true}],['aborted input',{abort:true}],['native upgrade',{upgrade:true}]])test(name+' keeps actual original delegation, options, return and destroy paths',async()=>{
 const before=await fixture(original,options),after=await fixture(instrumented,options);assert.deepEqual(after,before);assert.equal(after.requestCount,1);assert.equal(after.calls.find(x=>Array.isArray(x)&&x[0]==='request')[1].agent,false);
});
test('non-consuming socket error monitor preserves the original uncaught error object',()=>{
 const s=new EventEmitter(),error=Error('native');let monitored=0;s.on(errorMonitor,()=>monitored++);assert.throws(()=>s.emit('error',error),value=>value===error);assert.equal(monitored,1);assert.equal(s.listenerCount('error'),0);
});
test('actual recorder byte-cap and write failure cannot stop or duplicate native forwarding',async()=>{
 const before=recorder.recorderSnapshot();const byteLength=Buffer.byteLength;mock.method(Buffer,'byteLength',()=>128*1024*1024+1);
 try{const value=await fixture(instrumented);assert.equal(value.requestCount,1);}finally{Buffer.byteLength=byteLength;mock.restoreAll();}
 assert.ok(recorder.recorderSnapshot().dropped>before.dropped);
 const writes=fs.writeSync;mock.method(fs,'writeSync',()=>{throw Error('controlled sink failure');});
 try{const value=await fixture(instrumented);assert.equal(value.requestCount,1);}finally{fs.writeSync=writes;mock.restoreAll();}
 assert.ok(recorder.recorderSnapshot().writeErrors>before.writeErrors);
});
test('actual ledger keeps separate native request objects for repeated logical UUID and omits secret/query/body data',async()=>{
 await fixture(instrumented);await fixture(instrumented);
 const rows=fs.readdirSync(root).flatMap(f=>fs.readFileSync(path.join(root,f),'utf8').trimEnd().split('\n').map(JSON.parse)),requests=rows.filter(r=>r.type==='incoming'&&r.logicalRequestId===logical);
 assert.ok(requests.length>=2);assert.equal(new Set(requests.map(r=>r.requestId)).size,requests.length);
 const text=JSON.stringify(rows);for(const secret of['DO_NOT_LOG_QUERY','DO_NOT_LOG_COOKIE','DO_NOT_LOG_ERROR_DETAIL'])assert.ok(!text.includes(secret));
});
test('auditor accepts both closed origin roles and refuses each isolated evidence loss',()=>{
 function rows(slot){return[{boot:slot,pid:slot==='api-1'?1:2,slot,sequence:1,type:'installed'},{boot:slot,pid:slot==='api-1'?1:2,slot,sequence:2,type:'origin-listening',ownerId:1,epoch:1,port:9990},{boot:slot,pid:slot==='api-1'?1:2,slot,sequence:3,type:'terminal',dropped:0,writeErrors:0,pendingObjects:[]}];}
 for(const kind of['positive','absent','empty','truncated','malformed','loss','write-error','missing-origin','pending','missing-terminal','sequence','missing-web']){
  const dir=fs.mkdtempSync(path.join(root,'audit-'));
  for(const slot of['api-1','web-1']){
   if(kind==='absent'||(kind==='missing-web'&&slot==='web-1'))continue;
   const data=rows(slot);let text;
   if(slot==='api-1'){
    if(kind==='loss')data[2].dropped=1;if(kind==='write-error')data[2].writeErrors=1;if(kind==='pending')data[2].pendingObjects=[1];
    if(kind==='missing-origin')data.splice(1,1);if(kind==='missing-terminal')data.pop();if(kind==='sequence')data[1].sequence=8;
   }
   text=data.map(JSON.stringify).join('\n')+'\n';
   if(slot==='api-1'&&kind==='empty')text='';if(slot==='api-1'&&kind==='malformed')text='not JSON\n';if(slot==='api-1'&&kind==='truncated')text=text.trimEnd();
   fs.writeFileSync(path.join(dir,slot+'.jsonl'),text);
  }
  assert.equal(auditTransport(dir).complete,kind==='positive',kind);
 }
});
