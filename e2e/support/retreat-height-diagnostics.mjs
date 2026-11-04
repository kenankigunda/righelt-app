import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {transformBoardAdmissionModule} from './board-admission-diagnostics.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export const transformRetreatHeightModule = transformBoardAdmissionModule;

// Serialized by Playwright. Accessors and application objects never escape.
export function installRetreatHeightCollector() {
 const owners=new WeakMap();let nextOwner=0,sequence=0,armed=false,frozen=null;
 const log={version:1,first:[],tail:[],windowFirst:[],windowTail:[],dropped:0,windowDropped:0,incomplete:false,timeOrigin:performance.timeOrigin};
 const keys=new Set(['value','row','col','coord','target','origin','width','from','to','initial','metricChange','reducedMotion','pressing','duration']);
 const scalar=value=>value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=48;
 const clean=(input,depth=0)=>{
  if(scalar(input))return input;
  if(!input||typeof input!=='object'||depth>1)return null;
  const result={},descriptors=Object.getOwnPropertyDescriptors(input);
  for(const [key,descriptor] of Object.entries(descriptors)){
   if(!keys.has(key))continue;
   if(!Object.hasOwn(descriptor,'value')){log.incomplete=true;continue;}
   result[key]=clean(descriptor.value,depth+1);
  }
  return result;
 };
 const token=owner=>{
  if(!owner||!['object','function'].includes(typeof owner))return null;
  if(!owners.has(owner))owners.set(owner,++nextOwner);
  return owners.get(owner);
 };
 const append=(first,tail,row,capacity,dropKey)=>{
  if(first.length<capacity){first.push(row);return;}
  if(tail.length===capacity){tail.shift();log[dropKey]++;log.incomplete=true;}
  tail.push(row);
 };
 const record=(event,data,owner)=>{try{
  if(typeof event!=='string'||event.length>48){log.incomplete=true;return;}
  const safe=clean(data)||{};
  if(!armed&&event==='hover-start'&&safe.value?.row===3&&safe.value?.col===2)armed=true;
  const row={sequence:++sequence,event,data:safe,ownerToken:token(owner),now:performance.now()};
  append(log.first,log.tail,row,32,'dropped');
  if(armed)append(log.windowFirst,log.windowTail,row,64,'windowDropped');
 }catch{log.incomplete=true;}};
 const freeze=()=>{
  if(frozen)return frozen;
  const clone=JSON.parse(JSON.stringify({...log,armed}));
  const immutable=value=>{if(value&&typeof value==='object'){for(const item of Object.values(value))immutable(item);Object.freeze(value);}return value;};
  frozen=immutable(clone);return frozen;
 };
 globalThis.__retreatHeightRecord=record;
 globalThis.__retreatHeightFreeze=freeze;
}

export async function finishRetreatHeightDiagnostics(diagnostics) {
 if(!diagnostics)return;
 try{await diagnostics.persist();}
 catch{try{console.error('[retreat-height-diagnostic] persistence-incomplete');}catch{}}
}

// The Page dependency keeps the timeout snapshot ahead of Page teardown.
// No fixture timeout override: behavioral and cleanup allowances stay original.
export async function retreatHeightFixture({page,baseURL},use,info) {
 const diagnostic=info.title==='mandatory follow and exact sequence replay (none)'?await installRetreatHeightDiagnostics(page,info,{baseURL}):null;
 try{await use(diagnostic);}
 finally{await finishRetreatHeightDiagnostics(diagnostic);}
}

export async function installRetreatHeightDiagnostics(page,info,{baseURL}) {
 const recipes=JSON.parse(await readFile(new URL('./retreat-height-transformations.json',import.meta.url),'utf8'));
 const transforms=[],errors=[],pending=new Set();let installed=false,droppedMetadata=0,persisted=false;
 const addError=value=>{if(errors.length<64)errors.push(value);else droppedMetadata++;};
 const origin=new URL(baseURL).origin;
 await page.addInitScript(installRetreatHeightCollector);
 const pattern=url=>url.origin===origin&&Object.hasOwn(recipes,url.pathname);
 const handler=route=>{
  const work=(async()=>{
   let pathname='unavailable';
   try{
    const request=route.request(),url=new URL(request.url()),recipe=recipes[url.pathname];pathname=Object.hasOwn(recipes,url.pathname)?url.pathname:'unavailable';
    if(url.origin!==origin||!recipe||request.method()!=='GET')throw Error('module-request-contract');
    const response=await route.fetch();
    if(response.status()!==200)throw Error('module-response-contract');
    const source=await response.text(),body=transformRetreatHeightModule(source,recipe);
    if(transforms.length<64)transforms.push({pathname,sourceSha256:hash(source),outputSha256:hash(body),matches:recipe.operations.length});else droppedMetadata++;
    await route.fulfill({response,body});
   }catch{
    addError({category:'module-transform-incomplete',pathname});
    try{await route.abort('failed');}catch{addError({category:'module-abort-incomplete',pathname});}
   }
  })();
  pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;
 };
 await page.route(pattern,handler);installed=true;
 return {
  async persist(){
   if(persisted)return;
   persisted=true;
   // This is the first operation in the original finally, before route teardown.
   let observation=null;
   try{observation=await page.evaluate(()=>globalThis.__retreatHeightFreeze?.()??null);}
   catch{addError({category:'snapshot-incomplete'});}
   const cleanup={incomplete:false,errors:[]};
   if(installed){try{await page.unroute(pattern,handler);}catch{cleanup.incomplete=true;cleanup.errors.push({category:'owned-unroute-incomplete'});}}
   await Promise.allSettled([...pending]);
   const missingModules=Object.keys(recipes).filter(pathname=>!transforms.some(row=>row.pathname===pathname));
   const persistence={incomplete:false,errors:[]};
   const payload={observation,transforms,errors,missingModules,cleanup,persistence,droppedMetadata,incomplete:!observation?.armed||Boolean(observation?.incomplete)||Boolean(errors.length)||Boolean(missingModules.length)||cleanup.incomplete||droppedMetadata>0,clock:'browser performance.now/timeOrigin; no CPU or exact cell-rectangle measurement'};
   let body;
   try{body=JSON.stringify(payload,null,2);}catch{try{console.error('[retreat-height-diagnostic] serialization-incomplete');}catch{}return;}
   try{await writeFile(info.outputPath('retreat-height-observation.json'),body);}
   catch{persistence.incomplete=true;persistence.errors.push({category:'evidence-write-incomplete'});payload.incomplete=true;body=JSON.stringify(payload,null,2);try{console.error('[retreat-height-diagnostic] evidence-write-incomplete');}catch{}}
   try{await info.attach('retreat-height-observation',{contentType:'application/json',body});}
   catch{persistence.incomplete=true;persistence.errors.push({category:'attachment-incomplete'});try{console.error('[retreat-height-diagnostic] attachment-incomplete');}catch{}}
   try{await writeFile(info.outputPath('retreat-height-cleanup.json'),JSON.stringify({cleanup,persistence},null,2));}
   catch{try{console.error('[retreat-height-diagnostic] cleanup-receipt-incomplete');}catch{}}
  },
 };
}
