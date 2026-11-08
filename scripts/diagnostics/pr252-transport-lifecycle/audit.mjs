import fs from 'node:fs';import path from 'node:path';
export function auditTransport(directory){
 const errors=[],files=[],logical=[],listeningPorts=[];let origins=0;
 const names=fs.existsSync(directory)?fs.readdirSync(directory).filter(x=>x.endsWith('.jsonl')):[];
 if(!names.length)errors.push('No actual adapter module ledger');
 for(const name of names){
  const file=path.join(directory,name),raw=fs.readFileSync(file);let rows;
  try{if(!raw.length||raw.at(-1)!==10)throw Error('Empty/truncated ledger');rows=raw.toString('utf8').trimEnd().split('\n').map(JSON.parse);}catch(error){errors.push(name+': '+error.message);continue;}
  const installed=rows.filter(r=>r.type==='installed'),terminal=rows.filter(r=>r.type==='terminal'),listening=rows.filter(r=>r.type==='origin-listening');
  if(installed.length!==1||terminal.length!==1||rows.at(-1)!==terminal[0])errors.push(name+': missing unique module/terminal boundary');
  const end=terminal[0];if(end&&(end.dropped||end.writeErrors||end.pendingObjects.length))errors.push(name+': recorder loss or unterminated native objects');
  if(!listening.length||listening.some(r=>!Number.isSafeInteger(r.ownerId)||!r.ownerId||!Number.isSafeInteger(r.epoch)||r.epoch<1))errors.push(name+': actual owner/origin listening proof missing');
  if(rows.some(r=>r.boot!==rows[0].boot||r.pid!==rows[0].pid||r.slot!==rows[0].slot))errors.push(name+': mixed ledger identity');
  if(rows.some((r,i)=>r.sequence!==i+1))errors.push(name+': missing/out-of-order recorder sequence');
  origins+=listening.length;
  for(const row of listening){if(!Number.isInteger(row.port)||row.port<1||row.port>65535)errors.push(name+': invalid observed listening port');else listeningPorts.push({boot:row.boot,pid:row.pid,slot:row.slot,origin:row.origin,port:row.port});}
  for(const row of rows)if(row.type==='incoming'&&row.logicalRequestId)logical.push({boot:row.boot,pid:row.pid,slot:row.slot,origin:row.origin,ownerId:row.ownerId,epoch:row.epoch,requestObjectId:row.requestId,incomingSocketId:row.incomingSocketId,logicalRequestId:row.logicalRequestId,method:row.method,route:row.route});
  files.push({file,bytes:raw.length,rows:rows.length,slot:rows[0]?.slot,origins:listening.length,terminal:end??null});
 }
 for(const role of['api','web'])if(!files.some(f=>new RegExp('^'+role+'-\\d+$').test(f.slot)))errors.push('Required original '+role+' adapter missing');
 return{complete:errors.length===0,errors,files,origins,listeningPorts,logicalRequests:logical,limits:['INNER ProxyWorker→UserWorker adapter only; earlier PagesFunction→APIpublic hop remains unobserved.','UUID is logical correlation; native object/socket relationships are per boot/process/owner epoch only.','finish/end/close are transport facts, not durable creation or cancellation-cause proof.','No request/response body, secret header, URL query or WebSocket frame payload captured.']};
}
