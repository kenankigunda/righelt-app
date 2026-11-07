import {qualifyCurrentHeightAssignment,qualifyAssignedDeclaration} from './css-declaration-proof.mjs';
import {originalHeightPublication} from './height-publication-adapter.mjs';
import {measurePublicationUsedSize} from './css-used-size-proof.mjs';
// Caller supplies a fresh canonical lookup. Original target comes exclusively
// from the guarded controller assignment, never from the current inline style.
export function currentScalePublication(readCurrentNode,{used=false,readPublication,measurePublication=measurePublicationUsedSize}={}){
 const slot=readCurrentNode();
 if(!slot?.isConnected)return {ready:false,incomplete:true,reason:'missing-current-node'};
 const win=slot.ownerDocument.defaultView,live=slot.querySelector('.board-message-live');
 if(!live)return {ready:false,incomplete:true,reason:'missing-live-metrics'};
 const font=win.getComputedStyle(live),rect=slot.getBoundingClientRect();
 const fontKey=`${font.fontSize}:${font.fontFamily}:${font.lineHeight}`,width=rect.width;
 const original=originalHeightPublication({currentNode:slot,expectedFontKey:fontKey,expectedWidth:width,read:readPublication});
 const raw={fontKey,width,fontSize:parseFloat(font.fontSize),assignedValue:slot.style.height,rectHeight:rect.height,offsetHeight:slot.offsetHeight,managed:slot.dataset.heightManaged==='true'};
 if(!original.qualified)return {ready:false,incomplete:true,reason:original.reason,current:raw};
 const retained={target:original.expectedTarget,fontKey:original.fontKey,width:original.width,sequence:original.sequence};
 const declaration=qualifyCurrentHeightAssignment(slot,original.expectedTarget,slot.style.height);
 const assignmentMatches=declaration.qualified,animating=slot.getAnimations().some(a=>a.pending||a.playState==='running');
 const proof=used&&assignmentMatches&&!animating&&raw.managed?measurePublication(original):null;
 const sameCurrent=readCurrentNode()===slot&&slot.isConnected;
 const afterFont=win.getComputedStyle(live),afterFontKey=`${afterFont.fontSize}:${afterFont.fontFamily}:${afterFont.lineHeight}`,afterWidth=slot.getBoundingClientRect().width;
 const assignmentStillMatches=qualifyAssignedDeclaration({ideal:original.expectedTarget,assignedValue:slot.style.height,declaration:declaration.declaration}).qualified,metricsStillMatch=afterFontKey===fontKey&&afterWidth===width;
 return {ready:sameCurrent&&raw.managed&&assignmentMatches&&assignmentStillMatches&&metricsStillMatch&&!animating&&(!used||proof?.qualification?.qualified===true),incomplete:!sameCurrent||!assignmentMatches||!assignmentStillMatches||!metricsStillMatch||(used&&proof?.qualification?.qualified!==true),scope:used?'original-current-scale-css-used-publication':'original-current-scale-assignment',current:raw,original:retained,declaration,sameCurrent,assignmentMatches,assignmentStillMatches,metricsStillMatch,after:{assignedValue:slot.style.height,fontKey:afterFontKey,width:afterWidth},animating,used:proof};
}
