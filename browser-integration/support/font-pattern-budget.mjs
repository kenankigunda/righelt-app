import {qualifyAssignedDeclaration} from './css-declaration-proof.mjs';
import {qualifyUsedSize} from './css-used-size-proof.mjs';
import {admittedHeight,messagePaintGuard,budgetPixelPrecision,originalPolicyInputs} from './message-reservation-policy.mjs';
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

// Only Firefox's observed typed CSS-used domain takes this path. Other engine
// profiles retain their original ideal bounds. Proofs never use a live height.
export function fontEnvelopeBudgetForBrowser(envelope,coldIntrinsic,{browserName}={}){
 if(!['chromium','firefox','webkit'].includes(browserName)||envelope.usedMinimumProfile!==browserName)throw Error('Actual browser budget profile missing or mismatched');
 const ideal=fontEnvelopeBudget(envelope,coldIntrinsic);
 if(browserName!=='firefox')return {...ideal,qualificationMode:'ideal',browserName};
 const used=envelope.usedSize,typed=ideal.rows.filter(row=>row.pattern==='required-retry'),groups=ideal.groups.filter(group=>group.pattern==='required-retry');
 const policyMinimum=admittedHeight(envelope.width,ideal.fontSize,Number.MIN_VALUE,{pattern:'required-retry'});
 const sourceText=used?.policySource?.computedMinHeightText;
 const sourceNumber=typeof sourceText==='string'&&/^\d+(?:\.\d+)?(?:e[+-]?\d+)?px$/i.test(sourceText)?Number(sourceText.slice(0,-2)):NaN;
 if(!Number.isFinite(envelope.probeWidth)||envelope.probeWidth<=0||!used||used.error||used.policySource?.pattern!=='required-retry'||used.policySource?.childNodes!==0||used.policySource?.variantPresent!==false||used.policySource?.previewClassPresent!==false||used.policySource?.managedParent!==false||used.policySource?.width!==envelope.probeWidth||used.policySource?.removed!==true||!Number.isFinite(used.policySource.minHeight)||!Number.isFinite(sourceNumber)||sourceNumber<=0||used.policySource.minHeight!==sourceNumber||used.policySource.originalSourceSha256!==originalPolicyInputs.sourceSha256||used.policySource.originalPolicyMinimum!==policyMinimum||!qualifyAssignedDeclaration({ideal:policyMinimum,assignedValue:used.policySource.computedMinHeightText,declaration:used.policySource.declaration?.declaration,property:'min-height'}).qualified)throw Error('Independent Firefox typed CSS policy input unqualified');
 if(!Array.isArray(used.contentProofs)||used.contentProofs.length!==typed.length||!Array.isArray(used.slotProofs)||used.slotProofs.length!==groups.length)throw Error('Firefox typed proof inventory changed');
 const rows=ideal.rows.map(row=>{
  if(row.pattern!=='required-retry')return row;
  const matches=used.contentProofs.filter(entry=>entry.font===row.font&&entry.variant===row.variant&&entry.pattern===row.pattern);
  if(matches.length!==1)throw Error('Firefox row proof identity mismatch');
  const proof=qualifyUsedSize(matches[0].proof,{ideal:row.contentMax,property:'min-height',width:envelope.probeWidth});
  if(!proof.qualified)throw Error('Firefox row used minimum unqualified: '+proof.reason);
  return {...row,idealContentMax:row.contentMax,contentMax:proof.usedHeight,usedQualification:proof};
 });
 const qualifiedGroups=ideal.groups.map(group=>{
  if(group.pattern!=='required-retry')return group;
  const matches=used.slotProofs.filter(entry=>entry.pattern===group.pattern);if(matches.length!==1)throw Error('Firefox slot proof identity mismatch');
  const proof=qualifyUsedSize(matches[0].proof,{ideal:group.slotMax,property:'min-height',width:envelope.probeWidth});
  if(!proof.qualified)throw Error('Firefox physical slot used minimum unqualified: '+proof.reason);
  return {...group,idealContentMax:group.contentMax,idealSlotMax:group.slotMax,contentMax:Math.max(...rows.filter(row=>row.pattern===group.pattern).map(row=>row.contentMax)),slotMax:proof.usedHeight,usedQualification:proof};
 });
 return {...ideal,browserName,qualificationMode:'firefox-typed-css-used',rows,groups:qualifiedGroups,contentMax:Math.max(...qualifiedGroups.map(group=>group.contentMax)),slotMax:Math.max(...qualifiedGroups.map(group=>group.slotMax))};
}

// The accepted current grammar has 79 variants per font. PR193 added eleven
// models to each original 68-row set. IDs and fonts are checked
// independently, so a duplicate row cannot conceal an omitted sizing model.
export function fontEnvelopeInventoryViolations(rows){
 const expected=new Set(['primary','fallback'].flatMap(font=>Array.from({length:79},(_,index)=>`${font}|prompt:${index}`))),seen=new Set(),violations=[];
 if(rows.length!==158)violations.push({kind:'grammar-count',actual:rows.length,expected:158});
 for(const row of rows){
  const key=typeof row.font==='string'&&typeof row.variant==='string'?`${row.font}|${row.variant}`:null;
  if(!expected.has(key)||seen.has(key))violations.push({kind:'grammar-identity',font:row.font,variant:row.variant,reason:seen.has(key)?'duplicate':'unknown'});
  seen.add(key);
 }
 for(const key of expected)if(!seen.has(key))violations.push({kind:'grammar-identity',missing:key});
 return violations;
}

// Preserve every row/group oracle without paying for tens of thousands of
// Playwright assertion objects. Raw samples remain attached by the caller.
export function validateFontEnvelope(envelope,coldIntrinsic,{browserName}={}){
 const rows=Array.isArray(envelope?.rows)?envelope.rows:[],violations=fontEnvelopeInventoryViolations(rows);
 for(let index=0;index<rows.length;index++)if(![null,'required-retry'].includes(rows[index].pattern??null))violations.push({kind:'unknown-pattern',index,pattern:rows[index].pattern});
 const tagged=rows.filter(row=>row.pattern==='required-retry');
 if(tagged.length!==2)violations.push({kind:'typed-count',actual:tagged.length,expected:2});
 if(tagged.map(row=>row.font).sort().join('|')!=='fallback|primary')violations.push({kind:'typed-fonts',actual:tagged.map(row=>row.font)});
 if(new Set(tagged.map(row=>row.variant)).size!==1)violations.push({kind:'typed-variant',actual:tagged.map(row=>row.variant)});
 let budget=null;
 try{budget=browserName?fontEnvelopeBudgetForBrowser(envelope,coldIntrinsic,{browserName}):fontEnvelopeBudget(envelope,coldIntrinsic);}catch(error){violations.push({kind:'budget-input',message:String(error.message)});}
 if(budget)for(let index=0;index<rows.length;index++){
  const row=rows[index],cap=budget.rows[index].contentMax;
  if(!Number.isFinite(row.height)||row.height<=0||budgetPixelPrecision(row.height)>budgetPixelPrecision(cap))violations.push({kind:'row-content-cap',index,font:row.font,variant:row.variant,pattern:row.pattern??null,height:row.height,contentMax:cap});
 }
 return {budget,violations};
}
