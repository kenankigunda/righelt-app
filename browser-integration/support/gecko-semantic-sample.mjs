import {qualifyObservedGeckoSample} from './gecko-case-domain-witness.mjs';

// The captured DOM references survive only in this invocation, never in a receipt.
export async function measureGeckoSemanticSample(main,{profile,rawCaptureBinding}={}){
 const doc=main.ownerDocument,win=doc.defaultView;
 const original={main,slot:main.querySelector('.board-message-slot'),board:main.querySelector('#board')};
 original.wrap=original.board?.parentElement;
 const identity=()=>{
  const board=main.querySelector('#board');
  return {sameMain:doc.querySelector('main')===original.main,sameSlot:main.querySelector('.board-message-slot')===original.slot,sameBoard:board===original.board,sameWrap:board?.parentElement===original.wrap,connected:Object.values(original).every(node=>node?.isConnected===true),sameDocument:Object.values(original).every(node=>node?.ownerDocument===doc)};
 };
 const rect=node=>{const value=node.getBoundingClientRect();return{x:value.x,y:value.y,top:value.top,bottom:value.bottom,width:value.width,height:value.height,offsetHeight:node.offsetHeight};};
 const read=()=>({devicePixelRatio:win.devicePixelRatio,card:rect(original.main),board:rect(original.board),boardLayoutHeight:win.getComputedStyle(original.board).height,cardLayoutHeight:win.getComputedStyle(original.main).height,slotLayoutHeight:win.getComputedStyle(original.slot).height,slot:rect(original.slot)});
 const beforeIdentity=identity(),raw=read();
 const fail=(reason,extra={})=>({...raw,edgeWitness:{qualified:false,incomplete:true,reason,...extra}});
 try{
  if(typeof rawCaptureBinding!=='string'||typeof win[rawCaptureBinding]!=='function')return fail('raw-owner-missing');
  await win[rawCaptureBinding](raw);
 }catch(error){return fail('raw-owner-error',{errorName:error?.name??'Error'});}
 const afterIdentity=identity();
 if(!Object.values(beforeIdentity).every(Boolean)||!Object.values(afterIdentity).every(Boolean))return fail('sample-node-identity',{identity:{before:beforeIdentity,after:afterIdentity}});
 const current=read();
 if(JSON.stringify(current)!==JSON.stringify(raw))return fail('sample-changed-after-raw-persistence',{observed:current});
 // No await between this fresh captured-node read and the actual witness.
 try{return {...raw,edgeWitness:{...qualifyObservedGeckoSample(main,current,profile),identity:{before:beforeIdentity,after:afterIdentity}}};}
 catch(error){return fail('witness-error',{errorName:error?.name??'Error'});}
}
