import {renderBoardMessageSlot} from '../shell/board-message-layout.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {admittedHeight,originalPolicyInputs} from '../../../browser-integration/support/message-reservation-policy.mjs';
import {fontEnvelopeBudget,fontEnvelopeBudgetForBrowser,validateFontEnvelope,fontEnvelopeInventoryViolations} from '../../../browser-integration/support/font-pattern-budget.mjs';

const fixture=({ordinary=60,typed=80}={})=>{
 const rows=[null,'required-retry'].flatMap((pattern,index)=>['primary','fallback'].map(font=>({font,variant:`prompt:${index}`,pattern,height:index?typed:ordinary,lineHeight:48,minHeight:0})));
 return {envelope:{width:616,outerPadding:8,rows:structuredClone(rows)},cold:{width:616,rows}};
};
test('typed content cap and old ordinary slot cap keep separate paint coordinates',()=>{
 const {envelope,cold}=fixture(),budget=fontEnvelopeBudget(envelope,cold);
 const ordinary=budget.groups.find(row=>row.pattern===null),typed=budget.groups.find(row=>row.pattern==='required-retry');
 assert.equal(ordinary.contentMax,155.008);
 assert.equal(ordinary.slotMax,163.008);
 assert.equal(typed.contentMax,171.504);
 assert.equal(typed.slotMax,179.504);
 assert.equal(budget.slotMax,179.504);
});
test('each pattern keeps its own wider intrinsic fallback without raising the other cap',()=>{
 const {envelope,cold}=fixture({ordinary:300,typed:80}),budget=fontEnvelopeBudget(envelope,cold);
 assert.equal(budget.groups[0].contentMax,300);
 assert.equal(budget.groups[0].slotMax,308);
 assert.equal(budget.groups[1].contentMax,171.504);
 assert.equal(budget.slotMax,308);
 const swapped=fixture({ordinary:60,typed:300}),other=fontEnvelopeBudget(swapped.envelope,swapped.cold);
 assert.equal(other.groups[0].contentMax,155.008);
 assert.equal(other.groups[1].contentMax,300);
 assert.equal(other.groups[1].slotMax,308);
});
test('a currently oversized measured row never inflates its independent expected cap',()=>{
 const {envelope,cold}=fixture();envelope.rows[0].height=9000;
 const budget=fontEnvelopeBudget(envelope,cold);
 assert.equal(budget.rows[0].contentMax,155.008);
 assert.ok(envelope.rows[0].height>budget.rows[0].contentMax);
});
test('missing or unknown structural groups cannot borrow another fallback',()=>{
 const {envelope,cold}=fixture();cold.rows[3].font='primary';envelope.rows[3].font='primary';
 assert.throws(()=>fontEnvelopeBudget(envelope,cold),/intrinsic fallback missing/);
 const unknown=fixture();unknown.envelope.rows[0].pattern='mystery';
 assert.throws(()=>fontEnvelopeBudget(unknown.envelope,unknown.cold),/Unknown Board prompt pattern/);
});
test('width, row identity, scale and paint mismatch fail closed',()=>{
 for(const mutate of [x=>x.envelope.width++,x=>x.cold.rows.pop(),x=>x.cold.rows.reverse(),x=>x.envelope.rows[0].lineHeight=NaN,x=>x.envelope.outerPadding=16]){
  const value=fixture();mutate(value);assert.throws(()=>fontEnvelopeBudget(value.envelope,value.cold));
 }
});
test('finite cold scale mismatch and CSS-reserved intrinsic rows fail closed before fallback admission',()=>{
 for(const mutate of [x=>x.cold.rows[1].lineHeight=24,x=>x.cold.rows[1].minHeight=300,x=>x.cold.rows[1].minHeight=NaN,x=>x.cold.rows[1].height=Infinity]){
  const value=fixture();mutate(value);
  assert.throws(()=>fontEnvelopeBudget(value.envelope,value.cold),/grammar coordinates differ/);
 }
});

const fullFixture=()=>{
 const rows=['primary','fallback'].flatMap(font=>Array.from({length:79},(_,index)=>({font,variant:`prompt:${index}`,pattern:index===21?'required-retry':null,height:20,lineHeight:24,minHeight:0})));
 return {envelope:{width:366.8125,outerPadding:0,rows:structuredClone(rows)},cold:{width:366.8125,rows}};
};
test('pure font validator accepts the complete two-font grammar without changing source caps',()=>{
 const {envelope,cold}=fullFixture(),result=validateFontEnvelope(envelope,cold);
 assert.deepEqual(result.violations,[]);assert.deepEqual(result.budget,fontEnvelopeBudget(envelope,cold));
});
test('pure validator retains every oversized row instead of allowing the other pattern maximum to mask it',()=>{
 const {envelope,cold}=fullFixture();envelope.rows[0].height=9000;envelope.rows[21].height=8000;envelope.rows[81].height=7000;
 const result=validateFontEnvelope(envelope,cold),bad=result.violations.filter(x=>x.kind==='row-content-cap');
 assert.deepEqual(bad.map(x=>x.index),[0,21,81]);assert.equal(result.budget.rows[0].contentMax,fontEnvelopeBudget(envelope,cold).rows[0].contentMax);
});
test('pure validator preserves current count, known-tag, two-font and same-variant structural controls',()=>{
 const cases=[['grammar-count',x=>x.envelope.rows.pop()],['unknown-pattern',x=>x.envelope.rows[0].pattern='unqualified'],['typed-count',x=>x.envelope.rows[0].pattern='required-retry'],['typed-fonts',x=>x.envelope.rows.find(row=>row.font==='fallback'&&row.pattern==='required-retry').font='primary'],['typed-variant',x=>x.envelope.rows.find(row=>row.font==='fallback'&&row.pattern==='required-retry').variant='different']];
 for(const [kind,mutate]of cases){const x=fullFixture();mutate(x);assert(validateFontEnvelope(x.envelope,x.cold).violations.some(v=>v.kind===kind),kind);}
});
test('pure validator retains strict cold scale, intrinsic-minimum and row metric failure controls',()=>{
 for(const mutate of [x=>x.cold.rows[1].lineHeight=48,x=>x.cold.rows[1].minHeight=300,x=>x.envelope.outerPadding=8]){
  const x=fullFixture();mutate(x);assert(validateFontEnvelope(x.envelope,x.cold).violations.some(v=>v.kind==='budget-input'));
 }
 for(const height of [NaN,Infinity,0,-1]){const x=fullFixture();x.envelope.rows[1].height=height;assert(validateFontEnvelope(x.envelope,x.cold).violations.some(v=>v.kind==='row-content-cap'));}
});
test('pure validator matches the original every-row cap predicate across positive and failing samples',()=>{
 for(const extra of [0,1,100,10000]){
  const x=fullFixture();x.envelope.rows[13].height+=extra;const budget=fontEnvelopeBudget(x.envelope,x.cold);
  const oldRejected=x.envelope.rows.some((row,index)=>Number(row.height.toFixed(3))>Number(budget.rows[index].contentMax.toFixed(3)));
  const actual=validateFontEnvelope(x.envelope,x.cold).violations.some(v=>v.kind==='row-content-cap');assert.equal(actual,oldRejected);
 }
});

// Retained Firefox CSSOM serialization is independent of the original numeric operand.
const declarationFor=ideal=>({schema:1,ideal,property:'min-height',inputValue:`${ideal}px`,serializedValue:'125.498px',detached:true,childNodes:0,declarationCount:1,declaredProperty:'min-height',priority:''});
const proofFor=(ideal,width,usedHeight)=>({schema:1,ideal,declarationProof:declarationFor(ideal),property:'min-height',width,assignedValue:'125.498px',computedMinHeight:125.498,computedHeight:usedHeight,rectHeight:usedHeight,offsetHeight:Math.round(usedHeight),children:0,childNodes:0,textLength:0,flowFootprint:0,removed:true,contractMatch:true,boxSizing:'border-box',transform:'none',zoom:1,ancestorsUntransformed:true,maxHeight:'none',pseudoFree:true,pseudoBeforeContent:'none',pseudoAfterContent:'none',pseudoBeforeDisplay:'none',pseudoAfterDisplay:'none'});
const firefoxFixture=()=>{
 const x=fullFixture(),base=fontEnvelopeBudget(x.envelope,x.cold),group=base.groups.find(g=>g.pattern==='required-retry');
 const originalPolicyMinimum=admittedHeight(x.envelope.width,base.fontSize,Number.MIN_VALUE,{pattern:'required-retry'});
 Object.assign(x.envelope,{usedMinimumProfile:'firefox',probeWidth:x.envelope.width});
 x.envelope.usedSize={policySource:{pattern:'required-retry',minHeight:125.498,computedMinHeightText:'125.498px',originalPolicyMinimum,originalSourceSha256:originalPolicyInputs.sourceSha256,declaration:{qualified:true,incomplete:false,ideal:originalPolicyMinimum,inputValue:`${originalPolicyMinimum}px`,serializedValue:'125.498px',mode:'independent-empty-declaration',declaration:declarationFor(originalPolicyMinimum)},rowLines:3,width:x.envelope.width,childNodes:0,variantPresent:false,previewClassPresent:false,managedParent:false,removed:true},contentProofs:base.rows.filter(row=>row.pattern==='required-retry').map(row=>({font:row.font,variant:row.variant,pattern:row.pattern,proof:proofFor(row.contentMax,x.envelope.width,125.5)})),slotProofs:[{pattern:'required-retry',proof:proofFor(group.slotMax,x.envelope.width,125.5)}]};
 return x;
};
test('Firefox typed rounding uses independently qualified empty CSS proofs and a separate physical slot proof',()=>{
 const x=firefoxFixture();for(const row of x.envelope.rows)if(row.pattern==='required-retry')row.height=125.5;
 assert(validateFontEnvelope(x.envelope,x.cold).violations.some(v=>v.kind==='row-content-cap'),'original ideal catches observed125.5vs125.498');
 const q=validateFontEnvelope(x.envelope,x.cold,{browserName:'firefox'});assert.deepEqual(q.violations,[]);assert.equal(q.budget.qualificationMode,'firefox-typed-css-used');
 assert.equal(q.budget.rows[21].contentMax,125.5);assert.equal(q.budget.groups.find(g=>g.pattern==='required-retry').slotMax,125.5);
 assert.equal(q.budget.groups.find(g=>g.pattern===null).slotMax,fontEnvelopeBudget(x.envelope,x.cold).groups.find(g=>g.pattern===null).slotMax);
});
test('other engines retain original ideal bounds and cannot inherit Firefox used-cap credit',()=>{
 for(const browserName of ['chromium','webkit']){
  const x=firefoxFixture();x.envelope.usedMinimumProfile=browserName;x.envelope.usedSize={error:'unqualified-used-domain'};
  const q=fontEnvelopeBudgetForBrowser(x.envelope,x.cold,{browserName}),original=fontEnvelopeBudget(x.envelope,x.cold);
  assert.equal(q.qualificationMode,'ideal');assert.deepEqual(q.rows,original.rows);assert.deepEqual(q.groups,original.groups);
 }
});
test('actual browser binding and mandatory Firefox proof cannot fall back to a passing ideal',()=>{
 for(const mutate of [x=>x.envelope.usedMinimumProfile='webkit',x=>x.envelope.usedSize=null,x=>x.envelope.usedSize.policySource.minHeight+=1,x=>x.envelope.usedSize.policySource.previewClassPresent=true,x=>x.envelope.usedSize.policySource.managedParent=true,x=>x.envelope.usedSize.policySource.width+=1]){
  const x=firefoxFixture();mutate(x);assert.throws(()=>fontEnvelopeBudgetForBrowser(x.envelope,x.cold,{browserName:'firefox'}));
 }
 const x=firefoxFixture();assert.throws(()=>fontEnvelopeBudgetForBrowser(x.envelope,x.cold,{browserName:'unknown'}));
});
test('wrong independent ideal, row identity, pseudo content and missing physical proof reject',()=>{
 for(const mutate of [x=>x.envelope.usedSize.contentProofs[0].proof.ideal+=1,x=>x.envelope.usedSize.contentProofs[0].variant='prompt:22',x=>x.envelope.usedSize.contentProofs[0].proof.childNodes=1,x=>x.envelope.usedSize.contentProofs[0].proof.pseudoAfterContent='"generated"',x=>x.envelope.usedSize.slotProofs=[]]){
  const x=firefoxFixture();mutate(x);assert.throws(()=>fontEnvelopeBudgetForBrowser(x.envelope,x.cold,{browserName:'firefox'}));
 }
});
test('one row can never borrow the qualified global slot or another pattern cap',()=>{
 const x=firefoxFixture(),base=fontEnvelopeBudget(x.envelope,x.cold);x.envelope.rows[0].height=base.rows[0].contentMax+1;
 const result=validateFontEnvelope(x.envelope,x.cold,{browserName:'firefox'});assert(result.violations.some(v=>v.kind==='row-content-cap'&&v.index===0));
});


test('current production sizing output contains every independent two-font grammar identity',()=>{
 const html=renderBoardMessageSlot();const rows=[...html.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)].flatMap(([,opening,markup])=>{
  const font=opening.match(/data-sizing-font="([^"]+)"/),variant=opening.match(/data-sizing-variant="([^"]+)"/);if(!font||!variant)return[];
  return[{font:font[1],variant:variant[1],pattern:opening.match(/data-prompt-pattern="([^"]+)"/)?.[1]??null,markup}];
 });
 assert.equal(rows.length,158);for(const font of ['primary','fallback'])assert.equal(rows.filter(row=>row.font===font).length,79);
 assert.deepEqual(fontEnvelopeInventoryViolations(rows),[]);const typed=rows.filter(row=>row.pattern==='required-retry');assert.deepEqual(typed.map(row=>row.font),['primary','fallback']);assert.equal(new Set(typed.map(row=>row.variant)).size,1);for(const row of typed)for(const text of ['Select a rush to restore supply','Obligatory','Try again'])assert(row.markup.includes(text),'the actual typed row must describe obligatory supply-restoring rush and Retry');
});
for(const kind of ['duplicate-omits-variant','foreign-variant','foreign-font'])test(`same-count grammar ${kind} cannot pass complete sizing coverage`,()=>{
 const x=fullFixture();
 if(kind==='duplicate-omits-variant')x.envelope.rows[1]={...x.envelope.rows[0]};
 if(kind==='foreign-variant')x.envelope.rows[1].variant='prompt:79';
 if(kind==='foreign-font')x.envelope.rows[1].font='foreign';
 x.cold.rows=structuredClone(x.envelope.rows);
 assert.equal(x.envelope.rows.length,158);const result=validateFontEnvelope(x.envelope,x.cold);
 assert(result.violations.some(v=>v.kind==='grammar-identity'));assert(!result.violations.some(v=>v.kind==='grammar-count'||v.kind==='budget-input'),'same-count identity check is independently required');
});

test('a same-count typed pair on different valid variants still fails structural identity',()=>{
 const x=fullFixture();for(const row of x.envelope.rows)if(row.font==='fallback'&&['prompt:21','prompt:22'].includes(row.variant))row.pattern=row.variant==='prompt:22'?'required-retry':null;
 x.cold.rows=structuredClone(x.envelope.rows);const result=validateFontEnvelope(x.envelope,x.cold);
 assert.equal(x.envelope.rows.length,158);assert(result.violations.some(v=>v.kind==='typed-variant'));assert(!result.violations.some(v=>v.kind==='grammar-count'||v.kind==='budget-input'));
});
