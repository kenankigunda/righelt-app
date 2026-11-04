// Cold-font reservation for the finite short-prompt grammar. Width frontiers
// are rounded outward to 1/16em across the pinned primary and fallback fonts.
// They are independent of arrival order, live content and font loading state.
export const promptFrontiersEm=Object.freeze([8.5625,10.875,11.8125,19.375]);
const properties={prose:'--board-message-prose-line-height',scale:'--board-inline-action-font-scale',line:'--board-inline-action-line-height',padding:'--board-inline-action-padding-block-em',border:'--board-inline-action-border-px',halfPx:'--board-message-hit-half-px',halfEm:'--board-message-hit-half-em',extraEm:'--board-message-action-extra-em',extraPx:'--board-message-action-extra-px',detachedGap:'--board-message-detached-gap-em'};
// Qualification receipt for the measured CSS contract, not an alternative
// source for layout values. A CSS metric change needs a new font qualification.
const qualifiedSignature='1.5|0.88|1.5|0.2|1|23.0625|0.836|0.469|4|0.5';
const qualified=metrics=>metrics&&Object.keys(properties).map(key=>metrics[key]).join('|')===qualifiedSignature;
export function readPromptMetrics(style){
 const values=Object.fromEntries(Object.entries(properties).map(([key,name])=>[key,parseFloat(style?.getPropertyValue?.(name))]));
 return Object.values(values).every(Number.isFinite)&&qualified(values)?values:null;
}
export function promptReservation(width,fontSize,metrics){
 if(!qualified(metrics)||!Number.isFinite(width)||!Number.isFinite(fontSize)||fontSize<16||fontSize>32||width<8.5*fontSize)return null;
 const s=fontSize,m=metrics,em=width/s;
 const button=m.scale*(m.line+2*m.padding)*s+2*m.border;
 const inset=Math.max(0,m.halfPx-m.halfEm*s);
 // The existing allowance contains two inline-action growths plus 1/8em
 // for font/layout rounding. Keep CSS authoritative for those metrics.
 const rounding=Math.max(0,m.extraEm-2*(m.scale*(m.line+2*m.padding)-m.prose))*s;
 const [narrow,required,replay,wide]=promptFrontiersEm;
 const lines=em<narrow?4:em<required?3:2;
 const badged=lines*m.prose*s+button+m.detachedGap*s+4*inset+rounding;
 const replayRows=(em<narrow?2:1)*m.prose*s+2*button+2*m.detachedGap*s+4*inset;
 const twoActions=2*button+m.detachedGap*s+4*inset;
 // At wide widths both actions fit on their own row. Narrow widths must
 // additionally cover prose/badges and two independently wrapped actions.
 return em>=wide?twoActions:Math.max(badged,em<replay?replayRows:twoActions);
}

// Keep the new cold reservation within the existing compact-height contract.
// Row count is read from the actual replica's CSS container query, not a second
// width table. Permanent fallback and outer focus clearance remain physical.
export function boundedPromptReservation({width,fontSize,metrics,rowLines,intrinsicFallback,outerPadding=0,pattern=null}){
 const estimate=promptReservation(width,fontSize,metrics);
 if(pattern!==null&&pattern!=='required-retry')return null;
 if(estimate===null||!Number.isInteger(rowLines)||rowLines<2||rowLines>7||!Number.isFinite(intrinsicFallback)||intrinsicFallback<=0||!Number.isFinite(outerPadding)||outerPadding<0)return null;
 const inset=Math.max(0,metrics.halfPx-metrics.halfEm*fontSize);
 const inlineAllowance=metrics.extraEm*fontSize+metrics.extraPx+4*inset;
 const button=metrics.scale*(metrics.line+2*metrics.padding)*fontSize+2*metrics.border;
 const growth=Math.max(0,button-metrics.prose*fontSize);
 const rounding=Math.max(0,metrics.extraEm-2*(metrics.scale*(metrics.line+2*metrics.padding)-metrics.prose))*fontSize;
 const detachedAllowance=metrics.detachedGap*fontSize+growth+rounding+4*inset;
 const allowance=pattern==='required-retry'?Math.max(inlineAllowance,detachedAllowance):inlineAllowance;
 const ceiling=Math.max(2,rowLines)*metrics.prose*fontSize+allowance;
 // The qualified detached pattern ceiling is content height; its outer paint
 // padding is added exactly once by the owner. Other compact caps are unchanged.
 return Math.max(intrinsicFallback,Math.min(estimate,ceiling-(pattern==='required-retry'?0:outerPadding)));
}
