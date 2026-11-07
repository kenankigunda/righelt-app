import {expect} from '@playwright/test';
export const settledMessage=async(page,{publishedManagedHeight=false,info}={})=>{
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 let publicationFailure;
 try{
 await page.waitForFunction(requirePublished=>{
  const slots=[...document.querySelectorAll('.board-message-slot')];
  if(requirePublished&&slots.length===0)return false;
  return slots.every(slot=>{
   if(slot.getAnimations().some(animation=>animation.pending||animation.playState==='running'))return false;
   if(!requirePublished)return true;
   const adapter=globalThis.fixturePublicationFor;
   return typeof adapter==='function'&&adapter(slot)?.ready===true;
  });
 },publishedManagedHeight);
 }catch(error){publicationFailure=error;throw error;}finally{
  if(publishedManagedHeight){try{if(!info)throw Error('Managed publication evidence owner missing');const raw=await page.evaluate(()=>window.fixturePublicationLast??{incomplete:true,reason:'missing-adapter-receipt'});await info.attach('Managed publication original target and CSS used proof',{body:JSON.stringify(raw),contentType:'application/json'});}catch(error){console.error(JSON.stringify({kind:'managed-publication-evidence-incomplete',name:error?.name??'Error'}));if(!publicationFailure)throw error;}}
 }
};

// DOMRect.bottom can be a double sum of separately rounded top/height.
// Verify that composition, cancel the unchanged origins, and bound only the
// actual float32 primitives. Non-float32 primitives remain exact.
export const edgeDelta=(next,previous,slotNext,slotPrevious,primitives,label)=>{
 const bound=primitives.reduce((sum,value)=>sum+(value!==0&&Math.fround(value)===value?2**(Math.floor(Math.log2(Math.abs(value)))-24):0),0);
 expect(Math.abs((next-previous)-(slotNext-slotPrevious)),`${label}: ${JSON.stringify({edges:[next,previous,slotNext,slotPrevious],primitives,bound,float32:primitives.map(value=>Math.fround(value)===value)})}`).toBeLessThanOrEqual(bound);
 return{edges:[next,previous,slotNext,slotPrevious],primitives,bound};
};
export const measureSemanticGeometry=(page,{geckoProfile=null,rawCaptureBinding=null}={})=>page.locator('main').evaluate(async(main,{profile,rawCaptureBinding})=>{
 if(profile?.engine==='firefox'){
  const {measureGeckoSemanticSample}=await import('/browser-integration/support/gecko-semantic-sample.mjs');
  return measureGeckoSemanticSample(main,{profile,rawCaptureBinding});
 }
 const rect=node=>{const value=node.getBoundingClientRect();return{x:value.x,y:value.y,top:value.top,bottom:value.bottom,width:value.width,height:value.height,offsetHeight:node.offsetHeight};};
 return{devicePixelRatio,card:rect(main),board:rect(main.querySelector('#board')),boardLayoutHeight:getComputedStyle(main.querySelector('#board')).height,cardLayoutHeight:getComputedStyle(main).height,slotLayoutHeight:getComputedStyle(main.querySelector('.board-message-slot')).height,slot:rect(main.querySelector('.board-message-slot'))};
},{profile:geckoProfile,rawCaptureBinding});
export const assertSemanticGeometry=(initial,current)=>{
 expect({x:current.board.x,width:current.board.width,layoutHeight:current.boardLayoutHeight}).toEqual({x:initial.board.x,width:initial.board.width,layoutHeight:initial.boardLayoutHeight});
 expect({x:current.slot.x,y:current.slot.y,width:current.slot.width,cardTop:current.card.y}).toEqual({x:initial.slot.x,y:initial.slot.y,width:initial.slot.width,cardTop:initial.card.y});
 for(const sample of [initial,current])for(const rect of [sample.card,sample.board,sample.slot])expect(rect.bottom,'viewport edge must retain its measured top+height provenance').toBe(rect.top+rect.height);
 const slotHeights=[current.slot.height,initial.slot.height];
 const board=edgeDelta(current.board.top,initial.board.top,current.slot.bottom,initial.slot.bottom,[current.board.top,initial.board.top,...slotHeights],'board movement must come only from semantic slot growth');
 const card=edgeDelta(current.card.bottom,initial.card.bottom,current.slot.bottom,initial.slot.bottom,[current.card.height,initial.card.height,...slotHeights],'card movement must come only from semantic slot growth');
 const proof=current.edgeWitness;
 const bound=proof?.qualified===true&&proof.incomplete===false&&proof.domain?.qualified===true&&proof.calibration?.qualified===true&&proof.raw?.boardTop===current.board.top&&proof.raw?.slotTop===current.slot.top&&proof.raw?.slotHeight===current.slot.height&&proof.raw?.slotBottom===current.slot.bottom;
 if(current.board.y<current.slot.bottom&&bound){expect(proof.appUnitEdges.board).toBe(proof.appUnitEdges.slotBottom);}
 else expect(current.board.y).toBeGreaterThanOrEqual(current.slot.bottom);
 return{board,card};
};
