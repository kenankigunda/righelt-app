import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {promptReservation,boundedPromptReservation,readPromptMetrics,promptFrontiersEm} from '../board/prompt-reservation.js';
const css=readFileSync(new URL('../shell/board-ux.css',import.meta.url),'utf8');
const metrics=readPromptMetrics({getPropertyValue:name=>css.match(new RegExp(name+':([\\d.]+)'))?.[1]??''});
test('actual CSS metrics cover independently measured complete-grammar endpoints',()=>{
 for(const [size,width,height]of [[16,136,160.15625],[16,137,149.140625],[16,172,136.15625],[16,189,125.140625],[16,310,104.15625],[32,272,265.9375],[32,274,217.9375],[32,344,174.96875],[32,378,169.9375],[32,620,126.96875]])
  assert(promptReservation(width,size,metrics)>=height,`${size}px at ${width}px must cover ${height}`);
});
test('reservation retains continuous native-action metrics at intermediate text sizes and width frontiers',()=>{
 for(let size=16;size<=32;size+=.25){
  let previous=Infinity;
  for(const width of [8.5,...promptFrontiersEm].flatMap(em=>[em*size-.01,em*size,em*size+.01]).filter(width=>width>=8.5*size)){
   const value=promptReservation(width,size,metrics);assert(Number.isFinite(value)&&value>0);
   assert(value<=previous,'widening cannot increase reserve');previous=value;
  }
 }
});
test('unsupported domains and missing CSS metrics stay explicit',()=>{
 assert.equal(readPromptMetrics({getPropertyValue:()=>''}),null);
 for(const [width,size]of [[300,15],[300,33],[270,32],[NaN,16]])assert.equal(promptReservation(width,size,metrics),null);
 assert.equal(promptReservation(300,16,null),null);
});

test('finite changed or negative CSS metrics require new qualification',()=>{
 for(const value of ['-1','1.6'])assert.equal(readPromptMetrics({getPropertyValue:name=>name==='--board-message-prose-line-height'?value:css.match(new RegExp(name+':([\\d.]+)'))?.[1]??''}),null);
 assert.equal(promptReservation(400,16,{...metrics,prose:1.6}),null);
});

test('compact admission caps excess policy rounding while retaining permanent fallback',()=>{
 const base={width:296.8125,fontSize:16,metrics,rowLines:3,intrinsicFallback:125.140625};
 assert.equal(boundedPromptReservation(base),125.140625);
 assert.equal(boundedPromptReservation({...base,intrinsicFallback:280}),280,'a larger permanent fallback remains admitted independently');
 for(const rowLines of [undefined,0,-1,2.5,8])assert.equal(boundedPromptReservation({...base,rowLines}),null);
});

// Authored private proposal regressions; UNRUN.
test('only structurally tagged required retry receives its detached row cap',()=>{
 const base={width:616,fontSize:32,metrics,rowLines:3,intrinsicFallback:126.96875,outerPadding:8};
 assert(Math.abs(boundedPromptReservation(base)-155.008)<1e-9);
 const tagged=boundedPromptReservation({...base,pattern:'required-retry'});
 assert(Math.abs(tagged-171.504)<1e-9);
 assert.equal(boundedPromptReservation({...base,pattern:'unknown'}),null);
 assert.equal(boundedPromptReservation({...base,pattern:'required-retry',intrinsicFallback:300}),300);
});
test('detached cap adds paint once and leaves normal wide reservation unchanged',()=>{
 const base={width:366.8125,fontSize:16,metrics,rowLines:4,intrinsicFallback:104.15625};
 assert.equal(boundedPromptReservation({...base,pattern:'required-retry'}),104.25);
 const tagged={width:616,fontSize:32,metrics,rowLines:3,intrinsicFallback:126.96875,pattern:'required-retry'};
 assert.equal(boundedPromptReservation({...tagged,outerPadding:0}),boundedPromptReservation({...tagged,outerPadding:8}));
});

// Independent policy paint-accounting regression; authored UNRUN.
test('typed independent compact policy adds paint after the permanent fallback maximum',async()=>{
 const {admittedHeight}=await import('../../../browser-integration/support/message-reservation-policy.mjs');
 assert.equal(admittedHeight(616,32,300,{pattern:'required-retry',outerPadding:8}),308);
 assert.equal(admittedHeight(616,32,300),300,'untagged policy retains its original convention');
});

// Fresh Linux431 full-grammar receipt: untagged optional End turn + retry at
// exactly189px exceeds the previous analytic branch. This is a frontier
// refinement inside the original compact cap, not a new structural allowance.
test('outward replay frontier covers the measured untagged189px primary and keeps original compact caps',()=>{
 const base={width:189,fontSize:16,metrics,rowLines:5,intrinsicFallback:104.15625,outerPadding:0};
 const value=boundedPromptReservation(base);
 assert(Number.isFinite(value));assert(value>=128.15625,'measured untagged189px primary must fit before font admission');
 assert.equal(value,136.25);assert(value<=170.25,'original independent untagged compact ceiling retained');
 for(const size of [16,32])for(const delta of [-.125,0,.125]){
  const width=11.8125*size+delta,reserve=boundedPromptReservation({width,fontSize:size,metrics,rowLines:delta<0?6:5,intrinsicFallback:size===16?104.15625:155,outerPadding:size===16?0:8});
  assert(Number.isFinite(reserve));assert(reserve>0);
 }
 assert.equal(promptReservation(366.8125,16,metrics),104.25,'normal390 geometry estimate is unchanged');
 assert.equal(boundedPromptReservation({...base,pattern:'unknown'}),null);
});
