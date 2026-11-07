// Browser-safe independent TEST policy arithmetic, shared with the Node consumer.
// Inputs come from the source-CSS parser, never computed/live element heights.
export function admittedHeightFromSource(inputs,width,fontSize,intrinsicFallback,{pattern=null,outerPadding=0}={}){
 if(inputs?.schema!==1||!Array.isArray(inputs.bands)||!['baseEm','basePx','actionEm','actionPx','halfPx','halfEm','buttonScale','actionLine','actionPad','border','gapEm'].every(k=>Number.isFinite(inputs[k]))||inputs.bands.some(b=>!['min','max','height'].every(k=>Number.isFinite(b[k]))))throw Error('Original source policy inputs missing');
 if(!Number.isFinite(intrinsicFallback)||intrinsicFallback<=0)throw Error('A nonempty positive intrinsic fallback measurement is required');
 const insetValue=Math.max(0,inputs.halfPx-inputs.halfEm*fontSize);
 const allowance=inputs.actionEm*fontSize+inputs.actionPx+4*insetValue;
 const original=Math.max(intrinsicFallback,inputs.baseEm*fontSize,inputs.basePx,3*fontSize+allowance,...inputs.bands.filter(band=>width>=band.min*fontSize&&width<band.max*fontSize).map(band=>band.height*fontSize+allowance));
 if(pattern!=='required-retry')return original;
 const gap=inputs.gapEm*fontSize;
 const growth=Math.max(0,inputs.buttonScale*(inputs.actionLine+2*inputs.actionPad)*fontSize+2*inputs.border-1.5*fontSize);
 const rounding=Math.max(0,inputs.actionEm-2*(inputs.buttonScale*(inputs.actionLine+2*inputs.actionPad)-1.5))*fontSize;
 const inset=4*Math.max(0,inputs.halfPx-inputs.halfEm*fontSize);
 const rowHeight=Math.max(3*fontSize,...inputs.bands.filter(band=>width>=band.min*fontSize&&width<band.max*fontSize).map(band=>band.height*fontSize));
 return Math.max(original,rowHeight+gap+growth+rounding+inset)+outerPadding;
}
