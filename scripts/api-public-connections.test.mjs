import assert from 'node:assert/strict';
import {test} from 'node:test';
import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import {once,EventEmitter} from 'node:events';
import {createPublicApiConnection,reserveApiBackendPort as actualReserve,waitForOwnedApiReady} from './api-public-connections.mjs';
const cases=(name,fn)=>test(name,{timeout:10000},fn);
const ports=new Set();const recordPort=port=>{ports.add(port);if(process.env.RIGHELT_CONTROL_PORTS)fs.writeFileSync(process.env.RIGHELT_CONTROL_PORTS,JSON.stringify([...ports]));};
async function reserveApiBackendPort(excluded){const port=await actualReserve(excluded);recordPort(port);return port;}
async function backend(handler){
 const sockets=new Set(),server=http.createServer(handler);server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});
 server.listen(0,'127.0.0.1');await once(server,'listening');recordPort(server.address().port);
 return{server,port:server.address().port,async close(){const done=new Promise(r=>server.close(r));for(const s of sockets)s.destroy();await done;}};
}
async function bridge(b){const port=await reserveApiBackendPort([b.port]);return createPublicApiConnection({publicPort:port,backendPort:b.port});}
function request(url,options={},chunks=[]){return new Promise((resolve,reject)=>{const q=http.request(url,{agent:false,...options},r=>{const body=[];r.on('error',reject);r.on('data',x=>body.push(x));r.on('end',()=>resolve({status:r.statusCode,headers:r.headers,trailers:r.trailers,body:Buffer.concat(body)}));});q.on('error',reject);for(const chunk of chunks)q.write(chunk);q.end();});}
cases('explicit public listener preserves original Host, raw path/query, headers, method and entity with one fresh backend socket each',async()=>{
 const rows=[],body=Buffer.alloc(512*1024,137),b=await backend((q,s)=>{const chunks=[];q.on('data',x=>chunks.push(x));q.on('end',()=>{rows.push({method:q.method,url:q.url,rawHeaders:q.rawHeaders,body:Buffer.concat(chunks),socket:q.socket});s.writeHead(409,{'Set-Cookie':['first=1','second=2'],Trailer:'X-Complete'});s.write(body.subarray(0,100));setImmediate(()=>{s.addTrailers({'X-Complete':'yes'});s.end(body.subarray(100));});});}),p=await bridge(b),keep=new http.Agent({keepAlive:true,maxSockets:1});
 try{for(const [method,framing]of[['POST','length'],['PUT','length'],['PATCH','length'],['DELETE','length'],['POST','chunked']]){
  const target=new URL('/api/shell/games?literal=%2f%25&same=1&same=2',p.url),result=await request(target,{method,agent:keep,headers:['Host',`127.0.0.1:${p.url.port}`,'X-Fixture','same','Cookie','one=1; two=2','Content-Type','application/octet-stream',...(framing==='length'?['Content-Length',String(body.length)]:['Transfer-Encoding','chunked'])]},[body.subarray(0,77),body.subarray(77)]);
  const row=rows.at(-1);assert.equal(row.method,method);assert.equal(row.url,target.pathname+target.search);assert.deepEqual(row.body,body);assert.deepEqual(row.rawHeaders.slice(0,8),['Host',`127.0.0.1:${p.url.port}`,'X-Fixture','same','Cookie','one=1; two=2','Content-Type','application/octet-stream']);assert.equal(result.status,409);assert.deepEqual(result.body,body);assert.deepEqual(result.headers['set-cookie'],['first=1','second=2']);assert.equal(result.trailers['x-complete'],'yes');
 }assert.equal(rows.length,5);assert.equal(new Set(rows.map(r=>r.socket)).size,5);}
 finally{keep.destroy();await p.close();await b.close();}
});
cases('postcommit response loss remains an error and one upstream POST, never replayed',async()=>{
 let commits=0;const b=await backend((q)=>{q.resume();q.once('end',()=>{commits++;q.socket.destroy();});}),p=await bridge(b);
 try{await assert.rejects(request(p.url,{method:'POST'},['one immutable command']));assert.equal(commits,1);}finally{await p.close();await b.close();}
});
cases('backend connection failure remains a failed connection without synthetic success or fallback port',async()=>{
 const port=await reserveApiBackendPort([]),publicPort=await reserveApiBackendPort([port]),p=await createPublicApiConnection({publicPort,backendPort:port});
 try{await assert.rejects(request(p.url,{method:'POST'},['not replayed']));assert.equal(Number(p.url.port),publicPort);}finally{await p.close();}
});
cases('client abort closes the real backend stream',async()=>{
 let notify;const closed=new Promise(r=>notify=r),b=await backend((_q,s)=>{s.write('first');s.on('close',notify);}),p=await bridge(b);
 try{await new Promise((resolve,reject)=>{const q=http.get(p.url,s=>{s.once('data',()=>{q.destroy();resolve();});s.on('error',()=>{});});q.on('error',reject);});await closed;}finally{await p.close();await b.close();}
});
cases('native upgrade preserves public Host, raw path, buffered bytes and both directions',async()=>{
 let seen;const b=await backend();b.server.on('upgrade',(q,s,head)=>{seen={url:q.url,host:q.headers.host};s.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\nserver-first');if(head.length)s.write(head);s.pipe(s);});const p=await bridge(b),client=net.connect({host:'127.0.0.1',port:Number(p.url.port)});
 try{const done=new Promise((resolve,reject)=>{let raw='';client.on('data',c=>{raw+=c;if(raw.includes('server-first')&&raw.includes('client-first')&&raw.includes('client-next'))resolve(raw);});client.on('error',reject);});client.write(`GET /api/shell/games/example/live?original=1 HTTP/1.1\r\nHost: 127.0.0.1:${p.url.port}\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\nclient-first`);client.write('client-next');assert.match(await done,/^HTTP\/1.1 101/);assert.deepEqual(seen,{url:'/api/shell/games/example/live?original=1',host:`127.0.0.1:${p.url.port}`});}
 finally{client.destroy();await p.close();await b.close();}
});
cases('rejected upgrade preserves actual HTTP status and complete streamed body',async()=>{
 let calls=0;const b=await backend((_q,s)=>{calls++;s.writeHead(403,{'Content-Type':'text/plain'});s.write('denied-');s.end('complete');}),p=await bridge(b);
 try{const row=await request(p.url,{headers:{Connection:'Upgrade',Upgrade:'fixture'}});assert.equal(row.status,403);assert.equal(row.body.toString(),'denied-complete');assert.equal(calls,1);}finally{await p.close();await b.close();}
});
cases('restart closes old active upgrade before exact public port is rebound to a new owned backend',async()=>{
 const a=await backend();a.server.on('upgrade',(_q,s)=>{s.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\nready');s.pipe(s);});let p=await bridge(a);const publicPort=Number(p.url.port),client=net.connect({host:'127.0.0.1',port:publicPort});let b;
 try{const ready=new Promise((resolve,reject)=>{client.on('data',c=>{if(c.includes('ready'))resolve();});client.on('error',reject);});client.write('GET / HTTP/1.1\r\nHost: original\r\nConnection: Upgrade\r\nUpgrade: fixture\r\n\r\n');await ready;const closed=once(client,'close');closed.catch(()=>{});await p.close();await closed;await a.close();await assert.rejects(request(p.url));b=await backend((_q,s)=>s.end('new-owner'));p=await createPublicApiConnection({publicPort,backendPort:b.port});assert.equal((await request(p.url)).body.toString(),'new-owner');}
 finally{client.destroy();await p.close();await a.close();await b?.close();}
});
cases('foreign/invalid/same ports and occupied public listener fail without fallback or backend dispatch',async()=>{
 for(const [publicPort,backendPort]of[[0,1234],[1234,0],['1234',1235],[1234,1234],[65536,1234]])await assert.rejects(createPublicApiConnection({publicPort,backendPort}));
 let calls=0;const b=await backend((_q,s)=>{calls++;s.end();}),occupied=await backend();
 try{await assert.rejects(createPublicApiConnection({publicPort:occupied.port,backendPort:b.port}),{code:'EADDRINUSE'});assert.equal(calls,0);}finally{await occupied.close();await b.close();}
});

cases('backend readiness requires the exact owned child announcement, not a foreign port or successful health alone',async()=>{
 const child=()=>Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),exitCode:null,signalCode:null});
 const a=child(),ready=waitForOwnedApiReady(a,12345,1000);a.stdout.emit('data',Buffer.from('[wrangler:info] Ready on http://localhost:1234\n'));a.stdout.emit('data',Buffer.from('untrusted Ready on http://localhost:12345\n'));a.stdout.emit('data',Buffer.from('[wrangler:info] Ready on http://localhost:12345\n'));await ready;assert.equal(a.stdout.listenerCount('data'),0);
 const b=child(),failed=waitForOwnedApiReady(b,12345,1000);failed.catch(()=>{});b.stdout.emit('data',Buffer.from('[wrangler:info] Ready on http://localhost:1234\n'));b.stdout.emit('data',Buffer.from('foreign Ready on http://localhost:12345\n'));b.emit('exit',1,null);await assert.rejects(failed,/Owned API exited/);assert.equal(b.stdout.listenerCount('data'),0);
 const c=child();c.exitCode=1;await assert.rejects(waitForOwnedApiReady(c,12345,1000),/Owned API exited/);
});

const readinessChild=()=>Object.assign(new EventEmitter(),{stdout:new EventEmitter(),stderr:new EventEmitter(),exitCode:null,signalCode:null});
cases('split longer-port announcement never qualifies the requested exact port',async()=>{
 const c=readinessChild(),ready=waitForOwnedApiReady(c,1234,1000);ready.catch(()=>{});c.stdout.emit('data',Buffer.from('[wrangler:info] Ready on http://localhost:1234'));c.stdout.emit('data',Buffer.from('5\n'));c.emit('exit',1,null);await assert.rejects(ready,/Owned API exited/);
});
cases('correct split announcement waits for its complete original newline',async()=>{
 const c=readinessChild(),ready=waitForOwnedApiReady(c,1234,1000);let resolved=false;ready.then(()=>resolved=true);c.stdout.emit('data',Buffer.from('[wrangler:info] Ready on http://localhost:1234'));await Promise.resolve();assert.equal(resolved,false);c.stdout.emit('data',Buffer.from('\n'));await ready;
});
