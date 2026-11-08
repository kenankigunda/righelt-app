import fs from 'node:fs';
import path from 'node:path';
import {TextDecoder} from 'node:util';
import {createHash} from 'node:crypto';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateOwnership(bytes){
 const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 const keys=['inputMethod','hover','hoverMedia','keyboardFocus','tabFocused','visible','inert','expanded'];
 if(!value||Object.keys(value).length!==keys.length||!keys.every(k=>Object.hasOwn(value,k)))throw Error('Ownership schema mismatch');
 for(const key of ['hover','hoverMedia','keyboardFocus','tabFocused','inert'])if(typeof value[key]!=='boolean')throw Error('Ownership boolean missing');
 if(value.visible!=='true'||value.expanded!=='true'||value.inert!==false)throw Error('Native ownership readiness not proved');
 if(value.inputMethod!==(value.hoverMedia?'pointer':'keyboard'))throw Error('Input path does not match original media result');
 if(value.hoverMedia?!value.hover:!(value.keyboardFocus&&value.tabFocused))throw Error('Original branch ownership not proved');
 return {actual:value,keyboardProved:value.inputMethod==='keyboard'&&!value.hoverMedia&&value.keyboardFocus&&value.tabFocused};
}
// Observer only. Never changes status, TestCase, TestResult, attachments or fixture behavior.
export default class InlineOwnershipReporter{
 constructor(options={}){
  this.out=options.outputDir??process.env.RIGHELT_INLINE_OWNERSHIP_OUT;
  this.expected=options.expected??JSON.parse(fs.readFileSync(new URL('./expected-inventory.json',import.meta.url),'utf8'));
  this.write=options.writeExclusive??((file,bytes)=>fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600}));
  this.errors=[];this.records=[];this.results=[];this.globalErrors=[];this.totalBytes=0;this.started=false;
 }
 error(message){if(this.errors.length<128)this.errors.push(message);}
 onBegin(config,suite){
  try{
   if(!path.isAbsolute(this.out))throw Error('Absolute observer output required');
   fs.mkdirSync(this.out,{mode:0o700});this.started=true;
   const tests=suite.allTests();this.actualInventory=tests.map(t=>t.id);
   for(const test of tests){const old=this.expected.tests.find(row=>row.id===test.id);if(!old||test.titlePath().join(' > ')!==old.name||!test.location.file.replaceAll('\\','/').endsWith('/e2e/'+old.file))this.error('Original test identity/title/file mismatch');}
   if(JSON.stringify(this.actualInventory)!==JSON.stringify(this.expected.inventory))this.error('Original full FF1 inventory/order mismatch');
   this.config={workers:config.workers,reporter:config.reporter,projects:config.projects.map(project=>({name:project.name,retries:project.retries,timeout:project.timeout,use:{trace:project.use.trace,screenshot:project.use.screenshot,baseURL:project.use.baseURL,headless:project.use.headless,launchOptions:project.use.launchOptions}}))};
   this.write(path.join(this.out,'effective-config.json'),Buffer.from(JSON.stringify(this.config,null,2)+'\n'));
  }catch(error){this.error('begin:'+error.message);}
 }
 onError(error){if(this.globalErrors.length<128)this.globalErrors.push({message:error.message??String(error),stack:error.stack??null});else this.error('global-error-cap');}
 onTestEnd(test,result){
  // This callback runs after the original test and teardown. There are no Page APIs here.
  this.results.push({testId:test.id,status:result.status,retry:result.retry,expectedStatus:test.expectedStatus});
  if(result.retry!==0)this.error('Unexpected retry');
  for(const[attachmentIndex,attachment]of result.attachments.entries()){
   if(this.records.length>=2048){this.error('Inline attachment count cap');return;}
   const required=attachment.name===this.expected.target.name;
   if(required&&(test.id!==this.expected.target.id||attachment.contentType!==this.expected.target.contentType))this.error('Ownership attachment has foreign test/content type');
   const mime=typeof attachment.contentType==='string'?attachment.contentType.split(';')[0].trim().toLowerCase():'';
   if(!(mime==='application/json'||mime.endsWith('+json'))||!Buffer.isBuffer(attachment.body)){
    if(required)this.error('Required ownership inline Buffer missing');continue;
   }
   const bytes=Buffer.from(attachment.body),entry={testId:test.id,testTitlePath:test.titlePath(),retry:result.retry,nativeStatus:result.status,
    attachmentIndex,name:attachment.name,contentType:attachment.contentType,bytes:bytes.length,sha256:hash(bytes),file:null};
   try{
    if(!this.started||this.records.length>=2048||bytes.length>1024*1024||this.totalBytes+bytes.length>16*1024*1024)throw Error('Inline persistence unavailable/cap');
    const file=`${String(this.records.length).padStart(4,'0')}-${hash(Buffer.from(test.id)).slice(0,16)}.json`;
    // Exact inline bytes are durable before any ownership parsing.
    this.write(path.join(this.out,file),bytes);entry.file=file;this.totalBytes+=bytes.length;
    if(required){
     if(test.id!==this.expected.target.id)throw Error('Foreign ownership test');
     entry.ownership=validateOwnership(bytes);
    }
   }catch(error){entry.error=error.message;this.error('attachment:'+error.message);}
   this.records.push(entry);
  }
 }
 onEnd(result){
  if(this.results.length!==this.expected.inventory.length||new Set(this.results.map(r=>r.testId)).size!==this.expected.inventory.length||this.results.some(r=>!this.expected.inventory.includes(r.testId)))this.error('Missing/duplicate original test completion');
  const required=this.records.filter(r=>r.name===this.expected.target.name&&r.testId===this.expected.target.id);
  if(required.length!==1||!required[0]?.file||required[0]?.error)this.error('One complete original conditional ownership observation required');
  const keyboardProved=required.length===1&&required[0]?.ownership?.keyboardProved===true;
  const observerComplete=this.started&&this.errors.length===0;
  this.summary={diagnosticOnly:true,originalNativeStatus:result.status,observerComplete,keyboardProved,
   conditionalBypassFails:required.length===0,errors:[...this.errors],globalErrors:this.globalErrors,
   inventory:this.actualInventory??[],results:this.results,attachments:this.records,
   limits:'Original outcomes unchanged. No ownership inferred from absent body, screenshots, source or configured profile.'};
  try{if(this.started)this.write(path.join(this.out,'manifest.json'),Buffer.from(JSON.stringify(this.summary,null,2)+'\n'));}
  catch(error){process.stderr.write('[inline-ownership observer] Cannot preserve manifest: '+error.message+'\n');}
  // No return override: original reporters/test outcomes remain authoritative.
 }
}
