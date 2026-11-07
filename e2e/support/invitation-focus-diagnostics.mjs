import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(value).digest('hex');
const MODULE='/shell/app.js';
const FALLBACK='{"version":1,"incomplete":true,"category":"serialization-failed"}';
const CASES=new Set(['Players viewer invitation preserves focus through pending copy and failure','Players restores the selected invitation role after delayed clipboard success','Players restores the selected invitation role after delayed clipboard failure']);
export function transformInvitationFocusModule(source,recipe){
 if(recipe.pathname!==MODULE||hash(source)!==recipe.sourceSha256)throw Error('Invitation focus source identity mismatch');
 const chars=Array.from(source);let result=chars,previous=chars.length;
 for(const op of [...recipe.operations].reverse()){
  if(!Number.isSafeInteger(op.start)||!Number.isSafeInteger(op.end)||op.start<0||op.end<op.start||op.end>previous||chars.slice(op.start,op.end).join('')!==op.before||!op.anchor||source.split(op.anchor).length-1!==op.anchorCount)throw Error('Invitation focus source hunk mismatch');
  result=[...result.slice(0,op.start),...Array.from(op.after),...result.slice(op.end)];previous=op.start;
 }
 const output=result.join('');if(hash(output)!==recipe.outputSha256)throw Error('Invitation focus output identity mismatch');return output;
}
// Serialized into the selected test document. This is the reviewed private
// collector body, with no added DOM query, input, layout read or scheduling.
export function installInvitationFocusCollector(){
  const first=[],tail=[],ids=new WeakMap();let serial=0,seen=0,dropped=0,incomplete=false,original=null,role=null,originalJoin=null,originalMain=null,episode=false;
  const token=node=>{if(!node)return null;if(!ids.has(node))ids.set(node,++serial);return ids.get(node);};
  const allowedRole=value=>['viewer','player1','player2'].includes(value)?value:null;
  const capture=(phase,detail,event)=>{try{
   const target=detail?.closest?.('[data-action="copy-invite"]');
   if(phase==='action-entry'){original=target;role=allowedRole(target?.dataset.inviteRole);originalJoin=target?.closest('[data-game-panel="join"]');originalMain=target?.closest('.shell-main-content');episode=true;}
   if(!episode&&!target)return;
   const currentJoin=document.querySelector('[data-game-panel="join"]'),currentMain=document.querySelector('.shell-main-content');
   const current=role?currentJoin?.querySelector(`[data-action="copy-invite"][data-invite-role="${role}"]`):target;
   const active=document.activeElement;
   const record={seq:++seen,phase,at:performance.now(),timeOrigin:performance.timeOrigin,documentHasFocus:document.hasFocus(),visibility:document.visibilityState,role,activeTag:active?.tagName??null,activeInviteRole:allowedRole(active?.dataset?.inviteRole),activeAction:active?.dataset?.action==='copy-invite'?'copy-invite':null,activeOriginal:active===original,activeCurrent:active===current,originalConnected:original?.isConnected??null,currentConnected:current?.isConnected??null,originalDisabled:original?.disabled??null,currentDisabled:current?.disabled??null,originalJoin:token(originalJoin),currentJoin:token(currentJoin),originalMain:token(originalMain),currentMain:token(currentMain),trusted:event?.isTrusted??null};
   if(first.length<64)first.push(record);else{tail.push(record);if(tail.length>64){tail.shift();dropped++;incomplete=true;}}
  }catch{incomplete=true;}};
  globalThis.__righeltInviteFocusProbe=(phase,detail)=>capture(phase,detail);
  for(const type of ['focusin','focusout','keydown','keyup','click'])document.addEventListener(type,event=>{try{if(event.target?.closest?.('[data-action="copy-invite"]'))capture(`native-${type}`,event.target,event);}catch{incomplete=true;}},{capture:true,passive:true});
  globalThis.__righeltInviteFocusRead=()=>({schema:1,clock:'browser-performance',timeOrigin:performance.timeOrigin,records:[...first,...tail],seen,dropped,incomplete});
}
const phases=new Set(['action-entry','pending-before-set','pending-after-set','pending-before-start-render','pending-after-start-render','clipboard-before-await','clipboard-resolved','clipboard-rejected','pending-before-clear','pending-after-clear','pending-before-end-render','pending-after-end-render','render-before-replacement','render-after-replacement',...['focusin','focusout','keydown','keyup','click'].map(x=>'native-'+x)]);
const boolean=value=>typeof value==='boolean'?value:null;
const number=value=>typeof value==='number'&&Number.isFinite(value)?value:null;
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const role=value=>['viewer','player1','player2'].includes(value)?value:null;
// Copy only scalar fields. Never invoke a page object's custom serializer or
// copy its prototype, IDs, text, URL, command, headers or arbitrary properties.
export function encodeInvitationFocusEvidence(payload,serialize=JSON.stringify){
 try{
  const source=payload.observation;let incomplete=Boolean(payload.incomplete)||!source||!CASES.has(payload.caseTitle);
  const records=source?.records?.slice(0,128).map(row=>{
   const phase=phases.has(row.phase)?row.phase:'unlisted-phase';if(phase==='unlisted-phase')incomplete=true;
   return {seq:integer(row.seq),phase,at:number(row.at),timeOrigin:number(row.timeOrigin),documentHasFocus:boolean(row.documentHasFocus),visibility:['visible','hidden','prerender'].includes(row.visibility)?row.visibility:null,role:role(row.role),activeTag:['BUTTON','BODY','INPUT','A','DIV'].includes(row.activeTag)?row.activeTag:row.activeTag===null?null:'other',activeInviteRole:role(row.activeInviteRole),activeAction:row.activeAction==='copy-invite'?'copy-invite':null,...Object.fromEntries(['activeOriginal','activeCurrent','originalConnected','currentConnected','originalDisabled','currentDisabled','trusted'].map(k=>[k,boolean(row[k])])),...Object.fromEntries(['originalJoin','currentJoin','originalMain','currentMain'].map(k=>[k,integer(row[k])]))};
  })??[];
  if(source&&(source.records.length>128||source.incomplete||source.dropped))incomplete=true;
  if(!records.some(row=>row.phase==='action-entry')||!records.some(row=>row.phase==='pending-after-end-render'))incomplete=true;
  const observation=source?{schema:1,clock:'browser-performance',timeOrigin:number(source.timeOrigin),records,seen:integer(source.seen),dropped:integer(source.dropped),incomplete:Boolean(source.incomplete)||Boolean(source.dropped)}:null;
  const transforms=(payload.transforms??[]).map(row=>({pathname:MODULE,sourceSha256:/^[a-f0-9]{64}$/.test(row.sourceSha256)?row.sourceSha256:null,outputSha256:/^[a-f0-9]{64}$/.test(row.outputSha256)?row.outputSha256:null}));
  const errors=(payload.errors??[]).map(()=>({category:'module-transform-failed'}));
  const safe={version:1,caseTitle:CASES.has(payload.caseTitle)?payload.caseTitle:'unlisted-case',observation,transforms,errors,missingModule:Boolean(payload.missingModule),metadataDropped:integer(payload.metadataDropped??0),incomplete:incomplete||errors.length>0||Boolean(payload.missingModule),clock:'browser-performance/timeOrigin; no Node-clock subtraction'};
  const bytes=serialize(safe);return typeof bytes==='string'?bytes:FALLBACK;
 }catch{return FALLBACK;}
}
export async function persistInvitationFocusEvidence(page,info,details,{write=writeFile,serialize=JSON.stringify,emit=value=>console.error(value)}={}){
 const report=stage=>{try{emit('[invitation-focus-diagnostic] '+stage);}catch{}};
 let observation=null,readFailed=false;try{observation=await page.evaluate(()=>globalThis.__righeltInviteFocusRead?.()??null);}catch{readFailed=true;}
 let bytes;try{bytes=encodeInvitationFocusEvidence({...details,caseTitle:info.title,observation,incomplete:readFailed||!observation||details.incomplete},serialize);}catch{bytes=FALLBACK;}
 try{await write(info.outputPath('invitation-focus-observation.json'),bytes);}catch{report('evidence-write-incomplete');}
 try{await info.attach('invitation-focus-observation',{body:bytes,contentType:'application/json'});}catch{report('evidence-attachment-incomplete');}
}
export async function installInvitationFocusDiagnostics(page,info,{baseURL}){
 if(!CASES.has(info.title))throw Error('Invitation focus diagnostic case not allowlisted');
 const recipe=JSON.parse(await readFile(new URL('./invitation-focus-transformations.json',import.meta.url),'utf8'));
 const origin=new URL(baseURL).origin,transforms=[],errors=[];let metadataDropped=0;
 const remember=(list,row)=>{if(list.length<8)list.push(row);else metadataDropped++;};
 await page.addInitScript(installInvitationFocusCollector);
 const pattern=url=>url.origin===origin&&url.pathname===MODULE;
 const handler=async route=>{
  try{
   const request=route.request(),url=new URL(request.url());if(request.method()!=='GET'||url.search)throw Error('Invitation focus request identity mismatch');
   const response=await route.fetch();if(response.status()!==200)throw Error('Invitation focus response status mismatch');
   const source=await response.text(),body=transformInvitationFocusModule(source,recipe);
   remember(transforms,{pathname:MODULE,sourceSha256:hash(source),outputSha256:hash(body)});await route.fulfill({response,body});
  }catch{remember(errors,{category:'module-transform-failed'});try{await route.abort('failed');}catch{remember(errors,{category:'route-abort-incomplete'});}}
 };
 await page.route(pattern,handler);
 return {async persist(){
  try{await persistInvitationFocusEvidence(page,info,{transforms,errors,missingModule:transforms.length===0,metadataDropped,incomplete:metadataDropped>0});}catch{try{console.error('[invitation-focus-diagnostic] persistence-incomplete');}catch{}}
  try{await page.unroute(pattern,handler);}catch{try{console.error('[invitation-focus-diagnostic] route-disposal-incomplete');}catch{}}
 }};
}
