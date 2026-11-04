import {admittedHeight,messagePaintGuard,budgetPixelPrecision} from './message-reservation-policy.mjs';
const patternOf=row=>{
 const pattern=row.pattern??null;
 if(pattern!==null&&pattern!=='required-retry')throw Error('Unknown Board prompt pattern');
 return pattern;
};
// Independent CSS compact bounds in content coordinates. Each structural group
// keeps its own permanently measured fallback; the slot adds paint exactly once.
export function fontEnvelopeBudget(envelope,coldIntrinsic){
 if(!Array.isArray(envelope.rows)||!envelope.rows.length||!Array.isArray(coldIntrinsic.rows))throw Error('Complete font rows required');
 const fontSize=envelope.rows[0].lineHeight/1.5,outerPadding=messagePaintGuard(fontSize);
 if(!Number.isFinite(fontSize)||fontSize<=0||!Number.isFinite(envelope.outerPadding)||budgetPixelPrecision(envelope.outerPadding)!==budgetPixelPrecision(outerPadding))throw Error('Invalid font/paint coordinates');
 if(envelope.width!==coldIntrinsic.width)throw Error('Cold and current font widths differ');
 if(envelope.rows.length!==coldIntrinsic.rows.length||envelope.rows.some((row,index)=>{
  const cold=coldIntrinsic.rows[index];
  return row.font!==cold.font||row.variant!==cold.variant||patternOf(row)!==patternOf(cold)||row.lineHeight!==envelope.rows[0].lineHeight
   ||!Number.isFinite(cold.lineHeight)||cold.lineHeight!==row.lineHeight
   ||!Number.isFinite(cold.height)||cold.height<=0||cold.minHeight!==0;
 }))throw Error('Cold and current grammar coordinates differ');
 for(const row of coldIntrinsic.rows)patternOf(row);
 const patterns=[...new Set(envelope.rows.map(patternOf))];
 const groups=patterns.map(pattern=>{
  const values=coldIntrinsic.rows.filter(row=>row.font==='fallback'&&patternOf(row)===pattern).map(row=>row.height);
  if(!values.length||values.some(value=>!Number.isFinite(value)||value<=0))throw Error('Pattern intrinsic fallback missing');
  const intrinsicFallback=Math.max(...values),original=admittedHeight(envelope.width,fontSize,intrinsicFallback,{pattern});
  // Untagged compact ceilings retain their original slot bound. A wider
  // physical fallback remains independent of it. Tagged caps are content caps.
  const contentMax=pattern==='required-retry'?original:Math.max(intrinsicFallback,original-outerPadding);
  return {pattern,intrinsicFallback,contentMax,slotMax:contentMax+outerPadding};
 });
 return {fontSize,outerPadding,groups,contentMax:Math.max(...groups.map(group=>group.contentMax)),slotMax:Math.max(...groups.map(group=>group.slotMax)),rows:envelope.rows.map(row=>({font:row.font,variant:row.variant,pattern:patternOf(row),contentMax:groups.find(group=>group.pattern===patternOf(row)).contentMax}))};
}
