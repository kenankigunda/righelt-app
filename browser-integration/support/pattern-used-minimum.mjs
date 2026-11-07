import {admittedHeightFromSource} from './message-reservation-arithmetic.mjs';
import {qualifyCurrentMinHeightAssignment} from './css-declaration-proof.mjs';
import {measureCssUsedSize} from './css-used-size-proof.mjs';
// Called synchronously inside the existing isolated envelope turn. No primary
// or live measured height determines the independent typed CSS policy minimum.
export function measurePatternUsedMinimum({container,copies,intrinsicRows,outerPadding}){
 const typed=copies.filter(node=>node.dataset.promptPattern==='required-retry');
 if(typed.length!==2)throw Error('Complete typed copies required for used minimum');
 const reference=typed.find(node=>node.dataset.sizingFont==='primary');
 if(!reference)throw Error('Typed primary policy reference missing');
 const doc=reference.ownerDocument,win=doc.defaultView,policy=reference.cloneNode(false),wrapper=doc.createElement('div'),policyContainer=doc.createElement('div'),containerStyle=win.getComputedStyle(container);
 policy.removeAttribute('data-sizing-variant');policy.classList.remove('board-preview-label');policy.style.cssText='display:block;height:0;align-self:start;margin:0;min-width:0';
 policy.inert=true;policy.setAttribute('aria-hidden','true');
 // No managed-slot selector may suppress the source CSS rule. This empty
 // source-policy calculator is separate from both live and measured copies.
 wrapper.setAttribute('aria-hidden','true');wrapper.inert=true;wrapper.style.cssText='position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;contain:strict;visibility:hidden;pointer-events:none';
 policyContainer.className='board-message-slot';policyContainer.style.cssText='position:absolute;display:block;height:0;margin:0;padding:0;border:0;box-sizing:border-box';
 policyContainer.style.width=containerStyle.width;policyContainer.style.fontSize=containerStyle.fontSize;policyContainer.style.fontFamily=containerStyle.fontFamily;
 let source;
 try{
  wrapper.append(policyContainer);policyContainer.append(policy);doc.body.append(wrapper);const style=win.getComputedStyle(policy);
  source={pattern:policy.dataset.promptPattern,minHeight:parseFloat(style.minHeight),computedMinHeightText:style.minHeight,rowLines:parseFloat(style.getPropertyValue('--board-message-row-lines')),width:policyContainer.getBoundingClientRect().width,childNodes:policy.childNodes.length,variantPresent:policy.hasAttribute('data-sizing-variant'),previewClassPresent:policy.classList.contains('board-preview-label'),managedParent:policyContainer.hasAttribute('data-height-managed'),removed:false};
 }finally{wrapper.remove();if(source)source.removed=!wrapper.isConnected;}
 if(!source||!Number.isFinite(source.minHeight)||source.minHeight<=0)throw Error('Independent typed CSS minimum missing');
 const fallback=Math.max(0,...intrinsicRows.filter(row=>row.font==='fallback'&&row.pattern==='required-retry').map(row=>row.height));
 if(!Number.isFinite(fallback)||fallback<=0)throw Error('Natural typed fallback missing');
 const inputs=win.__fontOriginalPolicyInputs,fontSize=parseFloat(containerStyle.fontSize),width=container.getBoundingClientRect().width;
 const originalPolicyMinimum=admittedHeightFromSource(inputs,width,fontSize,Number.MIN_VALUE,{pattern:'required-retry'});
 const contentIdeal=admittedHeightFromSource(inputs,width,fontSize,fallback,{pattern:'required-retry'});
 // Source computed CSS remains evidence, never the original numeric operand.
 // The empty source policy was removed; serialize the original operand independently.
 const sourceDeclaration=qualifyCurrentMinHeightAssignment(reference,originalPolicyMinimum,source.computedMinHeightText);
 source.originalPolicyMinimum=originalPolicyMinimum;source.originalSourceSha256=inputs.sourceSha256;source.declaration=sourceDeclaration;
 if(!sourceDeclaration.qualified)throw Error('Original typed policy serialization unqualified');
 return {policySource:source,contentProofs:typed.map(node=>({font:node.dataset.sizingFont,variant:node.dataset.sizingVariant,pattern:'required-retry',proof:measureCssUsedSize(node,contentIdeal,{property:'min-height'})})),slotProofs:[{pattern:'required-retry',proof:measureCssUsedSize(container,contentIdeal+outerPadding,{property:'min-height'})}]};
}
