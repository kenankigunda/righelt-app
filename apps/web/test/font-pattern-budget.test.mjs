import test from 'node:test';
import assert from 'node:assert/strict';
import {fontEnvelopeBudget} from '../../../browser-integration/support/font-pattern-budget.mjs';

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
