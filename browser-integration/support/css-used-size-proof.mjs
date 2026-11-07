import {qualifyCurrentHeightAssignment,qualifyCurrentMinHeightAssignment,qualifyAssignedDeclaration} from './css-declaration-proof.mjs';
// Test-only proof. Browser used sizing is measured, never inferred from an
// assumed engine subpixel denominator. Live content cannot set this oracle.
const positive=value=>Number.isFinite(value)&&value>0;
export function primitiveAgreement(a,b){
 return Number.isFinite(a)&&Number.isFinite(b)&&a===b;
}
export function qualifyUsedSize(proof,{ideal,property,width}={}){
 const fail=reason=>({qualified:false,incomplete:true,reason});
 if(!proof||!positive(ideal)||!positive(width)||!['height','min-height'].includes(property))return fail('invalid-input');
 if(proof.schema!==1||proof.ideal!==ideal||proof.property!==property||proof.width!==width)return fail('binding');
 if(proof.pseudoFree!==true||proof.pseudoBeforeContent!=='none'||proof.pseudoAfterContent!=='none'||proof.pseudoBeforeDisplay!=='none'||proof.pseudoAfterDisplay!=='none')return fail('generated-pseudo');
 if(proof.children!==0||proof.childNodes!==0||proof.textLength!==0||proof.flowFootprint!==0||!proof.removed)return fail('probe-content-or-lifecycle');
 if(!proof.contractMatch||proof.boxSizing!=='border-box'||proof.transform!=='none'||proof.zoom!==1||!proof.ancestorsUntransformed)return fail('box-contract');
 const assignment=qualifyAssignedDeclaration({ideal,assignedValue:proof.assignedValue,declaration:proof.declarationProof,property});
 const assigned=assignment.qualified;
 const computedMinimum=property==='min-height'&&assigned?Number(assignment.serializedValue.slice(0,-2)):0;
 if(!assigned||proof.computedMinHeight!==computedMinimum||proof.maxHeight!=='none')return fail('cascade');
 if(!positive(proof.computedHeight)||!positive(proof.rectHeight)||!Number.isInteger(proof.offsetHeight)||proof.offsetHeight<=0)return fail('nonfinite-used-size');
 if(!primitiveAgreement(proof.rectHeight,proof.computedHeight))return fail('unsupported-used-representation');
 return {qualified:true,incomplete:false,ideal,usedHeight:proof.rectHeight,offsetHeight:proof.offsetHeight,width,property};
}
export function qualifyPublication(publication,proof){
 const bound=qualifyUsedSize(proof,{ideal:publication?.target,property:'height',width:publication?.width});
 if(!bound.qualified)return bound;
 if(publication.sameNode!==true||publication.connected!==true||publication.computedMinHeight!==0||publication.maxHeight!=='none'||publication.managed!==true||publication.assignedValue!==proof.assignedValue||!publication.contractMatch||publication.transform!=='none'||publication.zoom!==1||!publication.ancestorsUntransformed||publication.animating)return {qualified:false,incomplete:true,reason:'publication-contract'};
 if(!primitiveAgreement(publication.computedHeight,bound.usedHeight)||!primitiveAgreement(publication.rectHeight,bound.usedHeight)||publication.offsetHeight!==bound.offsetHeight)return {qualified:false,incomplete:true,reason:'publication-used-size'};
 return {...bound,publication:true};
}
// Called inside an existing page measurement turn by a small fixture adapter.
// Only the test-owned EMPTY probe is written. The reference is read-only.
export function measureCssUsedSize(reference,ideal,{property='min-height'}={}){
 const doc=reference.ownerDocument,win=doc.defaultView;
 if(!positive(ideal)||!['height','min-height'].includes(property))throw Error('Invalid independent used-size assignment');
 const computed=win.getComputedStyle(reference),rect=reference.getBoundingClientRect();
 const names=['font-family','font-size','font-weight','font-style','font-stretch','font-variant','line-height','letter-spacing','word-spacing','writing-mode','direction','box-sizing','padding-top','padding-bottom','padding-left','padding-right','border-top-width','border-bottom-width','border-left-width','border-right-width','border-top-style','border-bottom-style','border-left-style','border-right-style'];
 const contract=Object.fromEntries(names.map(name=>[name,computed.getPropertyValue(name)]));
 const ancestorsUntransformed=node=>{for(let n=node;n;n=n.parentElement){const s=win.getComputedStyle(n);if(s.transform!=='none'||Number(s.zoom||1)!==1)return false;}return true;};
 const probe=doc.createElement('div'),pseudoStyle=doc.createElement('style');
 pseudoStyle.textContent='[data-css-used-size-probe]::before,[data-css-used-size-probe]::after{content:none!important;display:none!important;}';
 probe.setAttribute('data-css-used-size-probe','');
 probe.setAttribute('aria-hidden','true');probe.inert=true;
 probe.style.cssText='all:initial;position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;margin:0;transform:none;zoom:1;overflow:hidden;min-width:0;max-width:none;min-height:0;max-height:none;height:0;';
 for(const [name,value]of Object.entries(contract))probe.style.setProperty(name,value);
 // computed width follows the same border-box contract; using BCR width would
 // import a transform or a rounding result into the assigned width.
 probe.style.width=computed.width;probe.style.setProperty(property,`${ideal}px`);
 let receipt;
 try{
  doc.head.append(pseudoStyle);doc.body.append(probe);const before=win.getComputedStyle(probe,'::before'),after=win.getComputedStyle(probe,'::after');const used=win.getComputedStyle(probe),r=probe.getBoundingClientRect();
  const contractMatch=names.every(name=>used.getPropertyValue(name)===contract[name])&&used.width===computed.width;
  const declaration=(property==='height'?qualifyCurrentHeightAssignment:qualifyCurrentMinHeightAssignment)(probe,ideal,probe.style.getPropertyValue(property));
  receipt={schema:1,declarationProof:declaration?.declaration??null,pseudoFree:before.content==='none'&&after.content==='none'&&before.display==='none'&&after.display==='none',pseudoBeforeContent:before.content,pseudoAfterContent:after.content,pseudoBeforeDisplay:before.display,pseudoAfterDisplay:after.display,ideal,property,width:rect.width,assignedValue:probe.style.getPropertyValue(property),computedMinHeight:parseFloat(used.minHeight),computedHeight:parseFloat(used.height),rectHeight:r.height,offsetHeight:probe.offsetHeight,children:probe.children.length,childNodes:probe.childNodes.length,textLength:probe.textContent.length,flowFootprint:used.position==='fixed'?0:null,boxSizing:used.boxSizing,transform:used.transform,zoom:Number(used.zoom||1),maxHeight:used.maxHeight,contractMatch,ancestorsUntransformed:ancestorsUntransformed(reference)&&ancestorsUntransformed(probe),padding:{top:used.paddingTop,bottom:used.paddingBottom,left:used.paddingLeft,right:used.paddingRight},border:{top:used.borderTopWidth,bottom:used.borderBottomWidth,left:used.borderLeftWidth,right:used.borderRightWidth},assignedWidth:probe.style.width,computedWidth:used.width,removed:false};
 }finally{probe.remove();pseudoStyle.remove();if(receipt)receipt.removed=!probe.isConnected;}
 return receipt;
}

export function measurePublicationUsedSize({expectedNode,currentNode,expectedTarget,measure=measureCssUsedSize}){
 // Expected target is an explicit original publication value supplied by the
 // fixture. Never synthesize it from whatever inline style happens to be now.
 if(!expectedNode||currentNode!==expectedNode||!expectedNode.isConnected||!positive(expectedTarget))return {qualified:false,incomplete:true,reason:'expected-publication-binding'};
 const slot=currentNode,win=slot.ownerDocument.defaultView,assignedValue=slot.style.height;
 const declaration=qualifyCurrentHeightAssignment(slot,expectedTarget,assignedValue);
 if(!declaration.qualified)return {qualified:false,incomplete:true,reason:'assigned-target-changed',declaration};
 const proof=measure(slot,expectedTarget,{property:'height'});
 const style=win.getComputedStyle(slot),rect=slot.getBoundingClientRect();
 const ancestorsUntransformed=(()=>{for(let n=slot;n;n=n.parentElement){const s=win.getComputedStyle(n);if(s.transform!=='none'||Number(s.zoom||1)!==1)return false;}return true;})();
 const publication={target:expectedTarget,width:rect.width,managed:slot.dataset.heightManaged==='true',sameNode:currentNode===expectedNode,connected:slot.isConnected,assignedValue:slot.style.height,computedMinHeight:parseFloat(style.minHeight),maxHeight:style.maxHeight,computedHeight:parseFloat(style.height),rectHeight:rect.height,offsetHeight:slot.offsetHeight,contractMatch:proof.contractMatch,transform:style.transform,zoom:Number(style.zoom||1),ancestorsUntransformed,animating:slot.getAnimations().some(a=>a.pending||a.playState==='running')};
 return {proof,publication,declaration,qualification:qualifyPublication(publication,proof)};
}
