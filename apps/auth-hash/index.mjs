import { hashPassword, verifyPassword, validPassword, parseHash } from './hash.mjs';
const json = (body,status=200) => Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function readHashInputUnsafe(request) {
  if(request.method!=='POST' || new URL(request.url).pathname!=='/hash' || request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json') return null;
  const reader=request.body?.getReader(); if(!reader) return null;
  let total=0; const chunks=[];
  while(true) { const {value,done}=await reader.read(); if(done) break; total+=value.byteLength; if(total>2048) {await reader.cancel();return null;} chunks.push(value); }
  const bytes=new Uint8Array(total);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  let body;try {body=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));} catch {return null;}
  if(!body || !validPassword(body.password)) return null;
  if(body.operation==='hash' && Object.keys(body).length===2) return body;
  if(body.operation==='verify' && Object.keys(body).length===3 && parseHash(body.encoded)) return body;
  return null;
}
export async function readHashInput(request) {
  try {return await readHashInputUnsafe(request);} catch {return null;}
}
export class PasswordHashDO {
  async fetch(request) {
    const input=await readHashInput(request);
    if(!input) return json({error:'invalid_input'},400);
    try {return json(input.operation==='hash' ? {encoded:hashPassword(input.password)} : {verified:verifyPassword(input.password,input.encoded)});}
    catch {return json({error:'temporarily_unavailable'},503);}
  }
}
export default {
  async fetch(request,env) {
    // Private service only, fixed singleton, no client-selected DO identity.
    const input=await readHashInput(request);
    if(!input) return json({error:'invalid_input'},400);
    try {return await env.PASSWORD_HASH.get(env.PASSWORD_HASH.idFromName('password-hash-v1')).fetch('https://auth.internal/hash',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)});}
    catch {return json({error:'temporarily_unavailable'},503);}
  }
};
