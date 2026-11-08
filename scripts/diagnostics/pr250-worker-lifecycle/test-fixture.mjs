import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {installWorkerLifecycle} from './page-observer.mjs';
const candidate=process.env.RIGHELT_DIAGNOSTIC_CANDIDATE,out=process.env.RIGHELT_DIAGNOSTIC_OUT;
if(!candidate||!out||!path.isAbsolute(candidate)||!path.isAbsolute(out))throw Error('Explicit diagnostic roots required');
const original=await import(pathToFileURL(path.join(candidate,'node_modules/@playwright/test/index.mjs')).href);
export const expect=original.expect;
// The exact original BrowserType is forwarded, never wrapped or relaunched.
export const chromium=original.chromium;
const prefix='__RIGHELT_WORKER_LIFECYCLE_V1__';
let rows=0,bytes=0,incomplete=false,nodeSequence=0;
fs.mkdirSync(out,{recursive:true,mode:0o700});
const fd=fs.openSync(path.join(out,`browser-events-${process.pid}.jsonl`),'ax',0o600);
const save=(kind,value)=>{
  try{
    const row=JSON.stringify({kind,nodePid:process.pid,nodeSequence:++nodeSequence,nodeNow:performance.now(),...value})+'\n';
    if(rows>=65536||bytes+Buffer.byteLength(row)>16*1024*1024){if(!incomplete){incomplete=true;fs.writeSync(fd,JSON.stringify({kind:'node-cap-loss',nodePid:process.pid})+'\n');}return;}
    fs.writeSync(fd,row);rows++;bytes+=Buffer.byteLength(row);
  }catch{incomplete=true;}
};
process.once('exit',()=>{save('node-exit',{rows,bytes,incomplete});fs.closeSync(fd);});
const environmentWorkerIdentity={workerIndex:process.env.TEST_WORKER_INDEX??null,parallelIndex:process.env.TEST_PARALLEL_INDEX??null};
save('fixture-import',{candidate,workerPid:process.pid,environmentWorkerIdentity});
const contexts=new WeakMap(),pages=new WeakSet();
function observePage(page,contextId,contextCreatedUnderTestId){
  if(pages.has(page))return;pages.add(page);const pageId=randomUUID();
  save('page-created',{contextId,pageId,contextCreatedUnderTestId});
  page.on('console',message=>{
    const text=message.text();if(!text.startsWith(prefix))return;
    // Retain the original scalar JSON before parsing. No console argument handles.
    save('console-original',{contextId,pageId,text});
    try{const row=JSON.parse(text.slice(prefix.length));if(row.contextId!==contextId||row.version!==1)throw Error();const truncated=value=>value&&typeof value==='object'&&(value.truncated===true||Object.values(value).some(truncated));if(['cap-loss','installation-incomplete','event-read-incomplete'].includes(row.kind)||!row.documentNonce||truncated(row))incomplete=true;}
    catch{incomplete=true;}
  });
  page.on('pageerror',error=>save('pageerror',{contextId,pageId,name:error.name,message:error.message,stack:error.stack}));
  page.on('worker',worker=>{
    const nativeWorkerId=randomUUID();save('pw-worker-created',{contextId,pageId,nativeWorkerId,url:worker.url()});
    worker.on('close',()=>save('pw-worker-closed',{contextId,pageId,nativeWorkerId}));
  });
  page.on('crash',()=>save('page-crash',{contextId,pageId}));
  page.on('framenavigated',frame=>save('native-frame-navigation',{contextId,pageId,mainFrame:frame===page.mainFrame(),observedURL:frame.url()}));
  page.on('close',()=>save('page-close',{contextId,pageId}));
}
async function observeContext(context,createdUnderTestId){
  if(contexts.has(context))return;
  const contextId=randomUUID();contexts.set(context,contextId);save('context-created',{contextId,createdUnderTestId});
  context.on('page',page=>observePage(page,contextId,createdUnderTestId));
  context.on('close',()=>save('context-close',{contextId}));
  for(const page of context.pages())observePage(page,contextId,createdUnderTestId);
  await context.addInitScript(installWorkerLifecycle,{prefix,contextId,maxRows:4096,maxText:65536});
  save('context-init-installed',{contextId});
}
export const test=original.test.extend({
  _workerLifecycleCase:[async({},use,info)=>{
    const identity={testId:info.testId,title:info.title,projectName:info.project.name,workerIndex:info.workerIndex,parallelIndex:info.parallelIndex};
    save('test-start',identity);
    try{await use();}finally{save('test-end',{...identity,observedStatusAtFixtureEnd:info.status});}
  },{auto:true}],
  browser:[async({browser},use,workerInfo)=>{
    const create=browser.newContext,createPage=browser.newPage;
    // Original Browser/context objects and all original options stay intact.
    // Await observer setup before handing a context/page to the original test.
    const creator=()=>{try{return original.test.info().testId;}catch{return null;}};
    browser.newContext=async function(...args){const createdUnderTestId=creator();const context=await Reflect.apply(create,this,args);await observeContext(context,createdUnderTestId);return context;};
    browser.newPage=async function(...args){const createdUnderTestId=creator();const page=await Reflect.apply(createPage,this,args);await observeContext(page.context(),createdUnderTestId);return page;};
    save('fixture-loaded',{candidate,workerPid:process.pid,browserVersion:browser.version(),workerIndex:workerInfo.workerIndex,parallelIndex:workerInfo.parallelIndex,projectName:workerInfo.project.name});
    try{await use(browser);}finally{
      browser.newContext=create;browser.newPage=createPage;
      save('fixture-finished',{rows,bytes,incomplete});
    }
  },{scope:'worker'}]
});
