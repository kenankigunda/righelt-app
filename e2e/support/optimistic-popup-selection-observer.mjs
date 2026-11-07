import {createHash} from 'node:crypto';
export const PREFIX='__RIGHELT_POPUP_SELECTION_V1__';
export function transformPopupModule(source,recipe){
 const hash=value=>createHash('sha256').update(value).digest('hex');
 if(hash(source)!==recipe.sourceSha256)throw Error('popup-source-binding');
 let output=source,previous=source.length;
 for(const op of [...recipe.operations].reverse()){
  if(!Number.isInteger(op.start)||!Number.isInteger(op.end)||op.start<0||op.end<op.start||op.end>previous||source.slice(op.start,op.end)!==op.before)throw Error('popup-range-binding');
  output=output.slice(0,op.start)+op.after+output.slice(op.end);previous=op.start;
 }
 if(hash(output)!==recipe.outputSha256)throw Error('popup-output-binding');
 return output;
}
// Serialized as a test-owned init script. Values are reduced without invoking
// getters; raw IDs, stable keys, text and URLs never leave this document.
export function installPopupCollector(){
 const prefix='__RIGHELT_POPUP_SELECTION_V1__';
 const objects=new WeakMap(),primitives=new Map();let token=0,seq=0,overflow=false;
 const id=value=>{
  if(value===null||value===undefined)return 0;
  const object=(typeof value==='object'&&value!==null)||typeof value==='function';
  const map=object?objects:primitives;
  if(!map.has(value))map.set(value,++token);
  return map.get(value);
 };
 const own=(value,key)=>{const d=value&&Object.getOwnPropertyDescriptor(value,key);return d&&'value'in d?d.value:undefined;};
 const record=(kind,value,scope)=>{try{
  if(seq>=2048){if(!overflow){overflow=true;console.debug(prefix+JSON.stringify({schema:1,seq:2049,kind:'overflow',incomplete:true}));}return;}
  const row={schema:1,seq:++seq,kind,scope:id(scope),value:id(value),present:value!==null&&value!==undefined};
  if(typeof value==='boolean')row.boolean=value;
  if(kind==='hydrate-result'){
   const selection=own(value,'selectionAction'),consume=own(value,'shouldConsume');
   row.selection=id(selection);row.consume=consume===true;row.projectionIncomplete=typeof consume!=='boolean';
  }
  if(kind==='render-selection')row.selected=id(own(value,'selectedPieceId'));
  console.debug(prefix+JSON.stringify(row));
 }catch{try{console.debug(prefix+JSON.stringify({schema:1,seq:++seq,kind:'projection-incomplete',incomplete:true}));}catch{}}};
 Object.defineProperty(globalThis,'__popupSelectionProbe',{configurable:true,value:Object.freeze({record})});
}
export function createPopupLedger(){
 const first=[],tail=[];let received=0,dropped=0,incomplete=false,frozen=null;
 const kinds=new Set(['bind-same-nodes','consume-action-key','consume-game','hydrate-action-key','hydrate-already-consumed','hydrate-game','hydrate-initial','hydrate-result','load-action','load-inspection','load-interactive','load-preserve','load-reset','load-restore-inspection','load-runtime','load-selection-action','render-selection','runtime-bind','runtime-create','runtime-destroy','runtime-public','selection-clear','selection-forced-piece','selection-inspection-piece','selection-piece','selection-state-piece','selection-target','selection-target-clear','overflow','projection-incomplete']);
 const tokens=new Set(['scope','value','selection','selected']);
 const flags=new Set(['present','boolean','consume','projectionIncomplete','incomplete']);
 const integer=value=>Number.isSafeInteger(value)&&value>=0;
 const accept=(text,page)=>{
  if(frozen||typeof text!=='string'||!text.startsWith(PREFIX))return;
  try{
   // Limit both UTF-16 length and actual UTF-8 bytes before parsing. Never
   // preserve a rejected payload or nested value in an error receipt.
   if(text.length>4096||Buffer.byteLength(text,'utf8')>4096)throw Error('row-size');
   const row=JSON.parse(text.slice(PREFIX.length)),allowed=['schema','seq','kind','scope','value','present','boolean','selection','selected','consume','projectionIncomplete','incomplete'];
   if(!row||Array.isArray(row)||row.schema!==1||!integer(row.seq)||row.seq===0||row.seq>2049||!kinds.has(row.kind)||!integer(page)||page===0||Object.keys(row).some(key=>!allowed.includes(key)))throw Error('row');
   for(const [key,value]of Object.entries(row)){
    if(tokens.has(key)&&!integer(value))throw Error('token');
    if(flags.has(key)&&typeof value!=='boolean')throw Error('flag');
   }
   if(row.kind==='overflow'||row.kind==='projection-incomplete'){
    if(row.incomplete!==true)throw Error('incomplete-marker');
   }else if(!integer(row.scope)||!integer(row.value)||typeof row.present!=='boolean')throw Error('missing-token');
   if(row.kind==='overflow'||row.incomplete||row.projectionIncomplete)incomplete=true;
   const safe=Object.freeze({...row,page});received++;
   if(first.length<128)first.push(safe);else{if(tail.length===256){tail.shift();dropped++;incomplete=true;}tail.push(safe);}
  }catch{incomplete=true;}
 };
 return {accept,freeze(){if(!frozen)frozen=Object.freeze({schema:1,received,dropped,incomplete:true,receivedWindowIncomplete:incomplete,generationVerified:false,browserFinalAcknowledged:false,completeness:'received-console-only; no browser final-ack; no absence proof',first:Object.freeze([...first]),tail:Object.freeze([...tail])});return frozen;}};
}
export async function installPopupObservation(context,{baseURL,recipes}){
 const base=new URL(baseURL);if(!['localhost','127.0.0.1','[::1]'].includes(base.hostname))throw Error('popup-local-origin');
 const ledger=createPopupLedger(),pending=new Set(),issues=[],routes=[],pages=new WeakMap(),moduleCounts=new Map(recipes.map(recipe=>[recipe.servedPath,0]));let pageToken=0,disposed=false,transformed=0;
 const note=kind=>{if(issues.length<16)issues.push(kind);else if(issues.at(-1)!=='issue-overflow')issues.push('issue-overflow');};
 const consoleListener=message=>{try{const page=message.page();if(!pages.has(page))pages.set(page,++pageToken);ledger.accept(message.text(),pages.get(page));}catch{note('console-incomplete');}};
 context.on('console',consoleListener);
 const dispose=async()=>{
  if(disposed)return;disposed=true;const failures=[];
  try{for(const [match,handler]of routes)try{await context.unroute(match,handler);}catch(error){note('unroute-incomplete');failures.push(error);}}
  finally{while(pending.size)await Promise.allSettled([...pending]);context.off('console',consoleListener);}
  if(failures.length)throw failures[0];
 };
 try{
  await context.addInitScript(installPopupCollector);
  for(const recipe of recipes){
   const match=url=>url.origin===base.origin&&url.pathname===recipe.servedPath;
   const handler=route=>{
    const work=(async()=>{try{
     const response=await route.fetch();
     if(route.request().method()!=='GET'||response.status()!==200){note('method-status');return await route.fulfill({response});}
     const source=await response.text();let body;
     try{body=transformPopupModule(source,recipe);}catch{note('source-binding');return await route.fulfill({response});}
     await route.fulfill({response,body});transformed++;moduleCounts.set(recipe.servedPath,moduleCounts.get(recipe.servedPath)+1);
    }catch(error){note('route-error');throw error;}})();
    pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;
   };
   await context.route(match,handler);routes.push([match,handler]);
  }
 }catch(error){try{await dispose();}catch{}throw error;}
 let snapshot;
 return {freeze(){return snapshot??=(ledger.freeze());},async finish(info){
  // Called before the original context close: no browser evaluation, so body
  // timeouts and a closed popup cannot erase already received Node evidence.
  const first=this.freeze();let cleanupIncomplete=false;
  try{await dispose();}catch{cleanupIncomplete=true;}
  const modules=recipes.map(recipe=>({path:recipe.servedPath,count:moduleCounts.get(recipe.servedPath),sourceSha256:recipe.sourceSha256,outputSha256:recipe.outputSha256}));
  const metadata={issues:[...issues],transformed,modules,pending:pending.size,cleanupIncomplete,incomplete:cleanupIncomplete||issues.length>0||modules.some(module=>module.count===0)};
  try{await info.attach('Popup initial selection lifecycle',{body:JSON.stringify({snapshot:first,metadata}),contentType:'application/json'});}catch{console.error('popup-selection-evidence-incomplete');}
  if(metadata.incomplete)console.error('popup-selection-observer-incomplete');
 }};
}
