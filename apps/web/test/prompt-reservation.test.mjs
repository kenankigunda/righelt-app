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
