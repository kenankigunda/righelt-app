// Test-only readonly box receipt. Do not infer browser layout by subtracting
// CSS decimal padding from separately rounded DOMRect values.
export function captureControlledMessageBox(){
 const root=document.querySelector('#app'),main=document.querySelector('main[data-shell-panel="board"]'),slot=main?.querySelector('.board-message-slot');
 const sample=node=>{
  if(!node)return null;
  const style=getComputedStyle(node),r=node.getBoundingClientRect();
  return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},css:{width:style.width,boxSizing:style.boxSizing,fontSize:style.fontSize,paddingLeft:style.paddingLeft,paddingRight:style.paddingRight,paddingTop:style.paddingTop,paddingBottom:style.paddingBottom,borderLeft:style.borderLeftWidth,borderRight:style.borderRightWidth,marginLeft:style.marginLeft,marginRight:style.marginRight},inlineWidth:node.style.width,inlineSize:node.style.inlineSize,connected:node.isConnected};
 };
 return {schema:1,viewport:innerWidth,body:sample(document.body),root:sample(root),main:sample(main),slot:sample(slot),rootClass:root?.className??null,rootContainsMain:Boolean(root&&main&&root.contains(main)),mainContainsSlot:Boolean(main&&slot&&main.contains(slot)),rootDistinctFromMain:root!==main,layoutMode:root?.dataset.shellLayoutMode??null};
}
export function qualifyControlledMessageBox(receipt,{expectedFontSize}={}){
 const fail=reason=>({qualified:false,incomplete:true,reason});
 if(!receipt||receipt.schema!==1||!Number.isFinite(expectedFontSize)||expectedFontSize<=0)return fail('binding');
 for(const name of ['body','root','main','slot'])if(!receipt[name]?.connected||!Number.isFinite(receipt[name].rect?.width)||receipt[name].rect.width<=0)return fail('missing-box');
 if(!receipt.rootClass?.split(/\s+/).includes('app-root')||!receipt.rootContainsMain||!receipt.mainContainsSlot||!receipt.rootDistinctFromMain)return fail('source-hierarchy');
 if(['paddingLeft','paddingRight','paddingTop','paddingBottom'].some(key=>parseFloat(receipt.body.css[key])!==0))return fail('duplicate-document-gutter');
 if(receipt.root.inlineWidth||receipt.root.inlineSize||receipt.main.inlineWidth||receipt.main.inlineSize)return fail('forced-width');
 const fontSize=parseFloat(receipt.slot.css.fontSize),width=receipt.slot.rect.width;
 if(fontSize!==expectedFontSize||receipt.slot.css.boxSizing!=='border-box')return fail('font-box-contract');
 if(width<8.5*fontSize)return fail('unsupported-domain');
 return {qualified:true,incomplete:false,fontSize,width,emWidth:width/fontSize,minimum:8.5*fontSize,comparison:'measured DOMRect width vs original policy domain; CSS box values recorded, not ideal-subtracted'};
}
