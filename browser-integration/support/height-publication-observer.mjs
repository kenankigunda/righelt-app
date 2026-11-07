import {createHash} from 'node:crypto';
export function transformHeightPublication(source,recipe){
 const hash=value=>createHash('sha256').update(value).digest('hex');
 if(hash(source)!==recipe.sourceSha256)throw Error('Height publication source mismatch');
 const {start,end,before,after}=recipe.operation;
 if(!Number.isInteger(start)||!Number.isInteger(end)||source.slice(start,end)!==before||source.indexOf(before)!==start||source.indexOf(before,start+1)!==-1)throw Error('Height publication anchor mismatch');
 const output=source.slice(0,start)+after+source.slice(end);
 if(hash(output)!==recipe.outputSha256)throw Error('Height publication output mismatch');
 return output;
}
// Test-owned init script. No node is retained strongly; source publications are
// stored by their ORIGINAL slot identity and never synthesized from style.
export function installHeightPublicationCollector(){
 const map=new WeakMap();let sequence=0,invalid=0,overflow=false;
 const record=(node,target,fontKey,width)=>{try{
  if(!node||typeof node!=='object'||!Number.isFinite(target)||target<=0||!Number.isFinite(width)||width<=0||typeof fontKey!=='string'||fontKey.length>512){invalid=Math.min(Number.MAX_SAFE_INTEGER,invalid+1);return;}
  if(sequence===Number.MAX_SAFE_INTEGER){overflow=true;return;}
  map.set(node,Object.freeze({target,fontKey,width,sequence:++sequence}));
 }catch{invalid=Math.min(Number.MAX_SAFE_INTEGER,invalid+1);}};
 const read=node=>{try{const value=map.get(node);return value?Object.freeze({...value,expectedNode:node,invalid,overflow}):null;}catch{return null;}};
 Object.defineProperty(globalThis,'__heightPublication',{configurable:true,value:Object.freeze({record,read})});
}
export async function installGuardedHeightPublication({context,baseURL,recipe}){
 const origin=new URL(baseURL).origin;let issues=[],issueDropped=0,transformed=0,disposed=false;const pending=new Set();
 const note=value=>{if(issues.length<8)issues.push(value);else issueDropped=Math.min(Number.MAX_SAFE_INTEGER,issueDropped+1);};
 if(!['localhost','127.0.0.1','[::1]'].includes(new URL(baseURL).hostname))throw Error('Local fixture origin required');
 await context.addInitScript(installHeightPublicationCollector);
 const matches=url=>url.origin===origin&&url.pathname==='/apps/web/board/message-height.js';
 const route=handler=>{
  const work=(async()=>{
   if(disposed)note('route-after-dispose');
   try{
    const response=await handler.fetch();
    if(handler.request().method()!=='GET'||response.status()!==200){note('method-or-status');return handler.fulfill({response});}
    const source=await response.text();
    let body;try{body=transformHeightPublication(source,recipe);}catch{note('binding');return handler.fulfill({response});}
    transformed=Math.min(Number.MAX_SAFE_INTEGER,transformed+1);return await handler.fulfill({response,body});
   }catch(error){note('route-error');throw error;}
  })();
  pending.add(work);void work.then(()=>pending.delete(work),()=>pending.delete(work));return work;
 };
 await context.route(matches,route);
 return {metadata:()=>({transformed,issues:issues.slice(),issueDropped,pending:pending.size,disposed,incomplete:issues.length>0||issueDropped>0||transformed===0||pending.size>0}),async dispose(){disposed=true;try{await context.unroute(matches,route);}finally{while(pending.size)await Promise.allSettled([...pending]);}}};
}
