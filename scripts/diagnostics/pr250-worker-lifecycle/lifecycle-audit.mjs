import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

// This consumes already retained originals. It never edits a ledger or decides
// the original test outcome. Discovery/main imports legitimately have no browser.
export function auditLifecycle(directory,observations){
 const errors=[],inputs=[],cases=new Map(),browserPids=[],coverage=[];
 const bad=(file,code,detail)=>errors.push({file,code,...(detail?{detail}:{})});
 let files=[];
 try{files=fs.readdirSync(directory).filter(name=>/^browser-events-\d+\.jsonl$/.test(name)).sort();}
 catch(error){bad(null,'ledger-directory-unavailable',error.code);}
 if(!files.length)bad(null,'no-ledger-files');
 if(files.length>512)bad(null,'ledger-file-cap');
 const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
 const lossKinds=new Set(['cap-loss','installation-incomplete','event-read-incomplete','worker-unavailable']);
 const pageKinds=new Set(['document-install','installed','constructor-threw','worker-created','post-called','post-returned','post-threw','message','messageerror','native-error','terminate-called','terminate-returned','terminate-threw',...lossKinds]);
 const nodeKinds=new Set(['fixture-import','fixture-loaded','fixture-finished','test-start','test-end','context-created','context-init-installed','context-close','page-created','pageerror','page-crash','page-close','native-frame-navigation','pw-worker-created','pw-worker-closed','console-original','node-exit','node-cap-loss']);
 const truncated=(value,depth=0)=>depth>12||Boolean(value&&typeof value==='object'&&(value.truncated===true||Object.values(value).some(child=>truncated(child,depth+1))));
 for(const file of files.slice(0,512)){
  const pid=Number(file.match(/(\d+)\.jsonl$/)[1]);let rows=[];
  try{
   const raw=fs.readFileSync(path.join(directory,file));inputs.push({file,bytes:raw.length,sha256:createHash('sha256').update(raw).digest('hex')});
   if(!raw.length){bad(file,'empty-ledger');continue;}
   if(raw.length>16*1024*1024+1024){bad(file,'ledger-byte-cap');continue;}
   const text=raw.toString('utf8');if(!text.endsWith('\n'))bad(file,'incomplete-trailing-record');
   rows=text.trimEnd().split('\n').map(line=>JSON.parse(line));
   if(rows.some(row=>!row||typeof row!=='object'||Array.isArray(row)))throw Error('Node record must be an object');
  }catch(error){bad(file,'unreadable-or-malformed-ledger',error.code??error.name);continue;}
  if(rows.length>65537)bad(file,'ledger-row-cap');
  rows.forEach((row,index)=>{if(row.nodePid!==pid||row.nodeSequence!==index+1||!nodeKinds.has(row.kind))bad(file,'invalid-node-record',String(index));});
  const imports=rows.filter(row=>row.kind==='fixture-import'),ends=rows.filter(row=>row.kind==='node-exit');
  if(imports.length!==1||rows[0]?.kind!=='fixture-import')bad(file,'fixture-import-missing-or-duplicate');
  if(ends.length!==1||rows.at(-1)?.kind!=='node-exit'||ends[0]?.incomplete!==false)bad(file,'node-terminal-incomplete');
  if(rows.some(row=>row.kind==='node-cap-loss'))bad(file,'node-cap-loss');
  const loaded=rows.filter(row=>row.kind==='fixture-loaded'),finished=rows.filter(row=>row.kind==='fixture-finished');
  if(loaded.length>1||finished.length!==loaded.length||finished.some(row=>row.incomplete!==false))bad(file,'browser-fixture-terminal-incomplete');
  if(loaded.length){
   browserPids.push(pid);const identity=loaded[0];
   if(!Number.isSafeInteger(identity.workerIndex)||!Number.isSafeInteger(identity.parallelIndex)||identity.projectName!=='webkit'||typeof identity.browserVersion!=='string')bad(file,'invalid-browser-worker-identity');
   const env=imports[0]?.environmentWorkerIdentity;
   if(env?.workerIndex!==String(identity.workerIndex)||env?.parallelIndex!==String(identity.parallelIndex))bad(file,'worker-environment-mismatch');
  }
  const started=rows.filter(row=>row.kind==='test-start'),testEnds=rows.filter(row=>row.kind==='test-end');
  for(const row of started){
   const end=testEnds.filter(end=>end.testId===row.testId&&end.projectName===row.projectName);
   if(typeof row.testId!=='string'||row.projectName!=='webkit'||!Number.isSafeInteger(row.workerIndex)||end.length!==1||end[0]?.workerIndex!==row.workerIndex)bad(file,'case-terminal-incomplete',row.testId);
   if(cases.has(row.testId))bad(file,'duplicate-case',row.testId);else cases.set(row.testId,{pid,row});
  }
  if(testEnds.some(end=>!started.some(start=>start.testId===end.testId)))bad(file,'orphan-case-terminal');
  if(!loaded.length&&rows.some(row=>['context-created','page-created','console-original'].includes(row.kind)))bad(file,'browser-events-without-fixture');
  const contexts=new Map(),pages=new Map(),docs=new Map();
  for(const row of rows){
   if(row.kind==='context-created'){
    if(!uuid(row.contextId)||contexts.has(row.contextId))bad(file,'invalid-context-creation');
    contexts.set(row.contextId,{installed:0,closed:0});
   }else if(row.kind==='context-init-installed'||row.kind==='context-close'){
    const context=contexts.get(row.contextId);if(!context)bad(file,'orphan-context-event');else context[row.kind==='context-close'?'closed':'installed']++;
   }else if(row.kind==='page-created'){
    if(!uuid(row.pageId)||pages.has(row.pageId)||!contexts.has(row.contextId))bad(file,'invalid-page-creation');
    pages.set(row.pageId,{contextId:row.contextId,closed:0,crashed:false,httpObserved:false,documents:new Set()});
   }else if(['page-close','page-crash','native-frame-navigation'].includes(row.kind)){
    const page=pages.get(row.pageId);if(!page||page.contextId!==row.contextId)bad(file,'orphan-page-event');
    else if(row.kind==='page-close')page.closed++;
    else if(row.kind==='page-crash')page.crashed=true;
    else if(row.mainFrame&&/^https?:/.test(row.observedURL))page.httpObserved=true;
   }else if(row.kind==='console-original'){
    const page=pages.get(row.pageId);if(!page||page.contextId!==row.contextId){bad(file,'orphan-console-record');continue;}
    let event;try{if(typeof row.text!=='string'||!row.text.startsWith('__RIGHELT_WORKER_LIFECYCLE_V1__'))throw Error();event=JSON.parse(row.text.slice('__RIGHELT_WORKER_LIFECYCLE_V1__'.length));if(!event||typeof event!=='object'||Array.isArray(event))throw Error();}catch{bad(file,'malformed-page-record');continue;}
    if(event.version!==1||event.contextId!==row.contextId||!uuid(event.documentNonce)||!pageKinds.has(event.kind)){bad(file,'invalid-page-record');continue;}
    if(truncated(event))bad(file,'truncated-page-evidence');
    if(lossKinds.has(event.kind))bad(file,'page-evidence-loss',event.kind);
    const key=event.documentNonce;let document=docs.get(key);
    if(!document){document={pageId:row.pageId,sequence:0,install:0,ready:0,workers:new Set()};docs.set(key,document);page.documents.add(key);}
    if(document.pageId!==row.pageId||event.sequence!==++document.sequence)bad(file,'document-identity-or-sequence');
    if(event.kind==='document-install'){document.install++;if(event.nonceAvailable!==true)bad(file,'document-nonce-unavailable');}
    else if(event.kind==='installed')document.ready++;
    else if(event.kind==='worker-created'){
     if(!Number.isSafeInteger(event.workerOrdinal)||event.workerOrdinal<1||document.workers.has(event.workerOrdinal))bad(file,'invalid-worker-object');
     document.workers.add(event.workerOrdinal);
    }else if(event.kind!=='constructor-threw'&&event.workerOrdinal!==undefined&&!document.workers.has(event.workerOrdinal))bad(file,'orphan-worker-object-event');
   }
  }
  for(const[contextId,value]of contexts)if(value.installed!==1||value.closed!==1)bad(file,'context-terminal-incomplete',contextId);
  for(const[pageId,page]of pages){
   if(page.closed!==1){bad(file,'page-terminal-incomplete',pageId);if(page.crashed)bad(file,'explicit-page-crash-gap',pageId);}
   if(page.httpObserved&&!page.documents.size)bad(file,'http-page-without-document-install',pageId);
  }
  for(const[nonce,document]of docs)if(document.install!==1||document.ready!==1)bad(file,'document-install-incomplete',nonce);
  coverage.push({file,pid,browserFixture:loaded.length===1,cases:started.map(row=>row.testId),contexts:contexts.size,pages:pages.size,documents:docs.size,workers:[...docs.values()].reduce((count,document)=>count+document.workers.size,0)});
 }
 if(!browserPids.length)bad(null,'no-native-browser-fixture');
 if(!coverage.some(row=>row.workers>0))bad(null,'no-worker-object-observed');
 const original=observations?.tests;
 if(!Array.isArray(original)||!original.length)bad(null,'original-case-observations-unavailable');
 else{
  if(original.some(row=>!row||typeof row.id!=='string'||!Array.isArray(row.attempts)))bad(null,'invalid-original-case-observations');
  const required=original.filter(row=>row&&Array.isArray(row.attempts)&&row.attempts.some(attempt=>attempt?.status!=='skipped'));
  for(const row of required)if(!cases.has(row.id))bad(null,'original-executed-case-unobserved',row.id);
  const originalIds=new Set(original.map(row=>row?.id));for(const id of cases.keys())if(!originalIds.has(id))bad(null,'foreign-case-observed',id);
 }
 return{complete:errors.length===0,errors,inputs,coverage,originalCaseOutcomeUnchanged:true,limits:['Discovery and execution-main import-only ledgers are retained without inventing a browser fixture.','Worker object identity is main-realm documentNonce plus ordinal. Public PWWorker URLs and frame navigation events are separate observations, not exact object/document joins.','Every recorded HTTP document must have installed evidence. Public same-document framenavigated events do not count physical documents. Native per-document commit correspondence is not claimed.']};
}
