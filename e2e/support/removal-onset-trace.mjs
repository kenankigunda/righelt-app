import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';

const sha256=value=>createHash('sha256').update(value).digest('hex');

export function transformRemovalOnsetModule(source,recipe){
 if(sha256(source)!==recipe.sourceSha256)throw Error('Removal onset source hash mismatch');
 let output=source,previous=source.length;
 for(const operation of [...recipe.operations].reverse()){
  if(!Number.isInteger(operation.start)||!Number.isInteger(operation.end)||operation.start<0||operation.end>previous||operation.start>operation.end||source.slice(operation.start,operation.end)!==operation.before)throw Error('Removal onset range mismatch');
  if(source.split(operation.anchor).length-1!==operation.anchorCount)throw Error('Removal onset anchor count mismatch');
  output=output.slice(0,operation.start)+operation.after+output.slice(operation.end);previous=operation.start;
 }
 if(sha256(output)!==recipe.outputSha256)throw Error('Removal onset output hash mismatch');
 return output;
}

export function installRemovalOnsetRecorder(){
 const phases=new Set(['input-activated','authoritative-subscriber','board-commit-entry','board-commit-exit','visual-commit-entry','visual-commit-exit','cue-schedule-entry','cue-schedule-exit','audio-source-start','removal-dom-observed','paint-opportunity','native-animation-advanced']);
 const allowedFields=new Set(['removalCount','actionable','duration','expectedCount']);
 let records=[],armed=false,expectedCount=null,dropped=0,incomplete=false,sequence=0;
 const note=(phase,fields={})=>{
  try{
   if(!armed||!phases.has(phase)||!fields||typeof fields!=='object'||Array.isArray(fields)){incomplete=true;return;}
   const scalars={};
   for(const [key,value] of Object.entries(fields)){
    if(!allowedFields.has(key)){incomplete=true;continue;}
    if(typeof value==='boolean'||(typeof value==='number'&&Number.isFinite(value)))scalars[key]=value;else incomplete=true;
   }
   if(records.length===256){records.shift();dropped++;incomplete=true;}
   records.push(Object.freeze({sequence:++sequence,phase,at:performance.now(),...scalars}));
  }catch{incomplete=true;}
 };
 const arm=value=>{
  try{
   const count=value?.expectedCount;
   if(![2,5,9].includes(count))return false;
   records=[];armed=true;expectedCount=count;dropped=0;incomplete=false;sequence=0;return true;
  }catch{return false;}
 };
 const snapshot=()=>{
  try{return Object.freeze({schemaVersion:1,origin:Number.isFinite(performance.timeOrigin)?performance.timeOrigin:null,expectedCount,armed,dropped,incomplete,records:Object.freeze(records.map(row=>Object.freeze({...row})))});}
  catch{return Object.freeze({schemaVersion:1,incomplete:true,reason:'snapshot-unavailable'});}
 };
 globalThis.__righeltRemovalTraceMark=note;
 globalThis.__righeltRemovalTraceArm=arm;
 globalThis.__righeltRemovalTraceSnapshot=snapshot;
 document.addEventListener('pointerdown',event=>{
  try{
   if(!event.isTrusted||!armed)return;
   const target=event.target instanceof Element?event.target.closest('[data-board-preview-action], #shell-board .cell.target'):null;
   if(target)note('input-activated',{expectedCount});
  }catch{incomplete=true;}
 },{capture:true,passive:true});
}

export async function installRemovalOnsetTrace(context,baseURL){
 const recipes=JSON.parse(await readFile(new URL('./removal-onset-transformations.json',import.meta.url),'utf8'));
 const origin=new URL(baseURL).origin,transforms=[],errors=[],pending=new Set();
 const pattern=url=>url.origin===origin&&Object.hasOwn(recipes,url.pathname);
 const handler=route=>{
  const task=(async()=>{
   let pathname;
   try{
    pathname=new URL(route.request().url()).pathname;
    const response=await route.fetch(),source=await response.text(),recipe=recipes[pathname];
    const body=transformRemovalOnsetModule(source,recipe);
    transforms.push(Object.freeze({pathname,sourceSha256:sha256(source),outputSha256:sha256(body),operations:recipe.operations.length}));
    await route.fulfill({response,body});
   }catch{
    errors.push(Object.freeze({category:'module-transform-failed',...(pathname&&Object.hasOwn(recipes,pathname)?{pathname}:{})}));
    try{await route.abort('failed');}catch{}
   }
  })();
  pending.add(task);void task.finally(()=>pending.delete(task));return task;
 };
 await context.route(pattern,handler);
 try{await context.addInitScript(installRemovalOnsetRecorder);}
 catch(error){try{await context.unroute(pattern,handler);}catch{}throw error;}
 return async()=>{
  const cleanup=[];
  try{await context.unroute(pattern,handler);}catch{cleanup.push('owned-route-removal-failed');}
  const settled=await Promise.allSettled([...pending]);
  if(settled.some(row=>row.status==='rejected'))cleanup.push('owned-route-task-rejected');
  const missingModules=Object.keys(recipes).filter(pathname=>!transforms.some(row=>row.pathname===pathname));
  return Object.freeze({transforms:Object.freeze([...transforms]),errors:Object.freeze([...errors]),missingModules:Object.freeze(missingModules),pending:pending.size,cleanup:Object.freeze(cleanup),incomplete:Boolean(errors.length||missingModules.length||pending.size||cleanup.length)});
 };
}
