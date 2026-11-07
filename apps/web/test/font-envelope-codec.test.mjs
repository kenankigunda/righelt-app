import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeFontBoundarySamples} from '../../../browser-integration/support/font-envelope-codec.mjs';

test('compact font boundary decoding preserves all234 envelopes and192 ordered full rows',()=>{
 let count=0;
 for(const phase of ['cold','loaded','warm'])for(const scale of [100,200]){
  const envelopeCount=scale===100?37:41;
  const originals=Array.from({length:envelopeCount},(_,sample)=>({scale,width:272+sample/8,primary:sample+1,fallback:sample+2,intrinsicPrimary:sample+3,
   rows:Array.from({length:192},(_,index)=>({font:index<96?'primary':'fallback',variant:`narration:${index%96}`,text:`${index} – Your opponent moved a piece`,
    height:sample+index+phase.length,lineHeight:scale/10+index/1000,minHeight:sample+scale+index}))}));
  const definitions=originals[0].rows.map(({font,variant,text})=>({font,variant,text}));
  const samples=originals.map(envelope=>({...envelope,rows:envelope.rows.map(({height,lineHeight,minHeight})=>[height,lineHeight,minHeight])}));
  const decoded=decodeFontBoundarySamples({definitions,samples});
  assert.deepEqual(decoded,originals);assert.equal(decoded.length,envelopeCount);assert.ok(decoded.every(sample=>sample.rows.length===192));
  // Each measured value belongs to its own sample, not a cached first-width row.
  assert.notEqual(decoded[0].rows[0].height,decoded[1].rows[0].height);
  assert.notStrictEqual(decoded[0].rows[0],decoded[1].rows[0]);count+=decoded.length;
 }
 assert.equal(count,234);
});

test('compact font boundary decoding rejects missing rows and metric fields',()=>{
 const definitions=[{font:'primary',variant:'one',text:'Select a piece'}];
 assert.throws(()=>decodeFontBoundarySamples({definitions,samples:[{rows:[]}]}),/row count changed/);
 assert.throws(()=>decodeFontBoundarySamples({definitions,samples:[{rows:[[20,24]]}]}),/Complete font boundary metrics/);
});

test('compact font boundary decoding preserves structural patterns and fresh intrinsic coordinates',()=>{
 const definitions=[{font:'primary',variant:'prompt:20',text:'Required move',pattern:'required-retry'},{font:'fallback',variant:'prompt:0',text:'Select a piece',pattern:null}];
 const samples=[100,200].map(scale=>({scale,width:616,outerPadding:scale===100?0:8,rows:[[scale+1,scale+2,scale+3],[scale+4,scale+5,scale+6]],intrinsicRows:[[scale+7,scale+8,0],[scale+9,scale+10,0]]}));
 const result=decodeFontBoundarySamples({definitions,samples});
 for(let index=0;index<2;index++)for(const field of ['rows','intrinsicRows'])for(let row=0;row<2;row++){
  assert.deepEqual(result[index][field][row],{...definitions[row],height:samples[index][field][row][0],lineHeight:samples[index][field][row][1],minHeight:samples[index][field][row][2]});
 }
 assert.equal(result[0].outerPadding,0);assert.equal(result[1].outerPadding,8);
 assert.notStrictEqual(result[0].rows[0],result[0].intrinsicRows[0]);
 assert.throws(()=>decodeFontBoundarySamples({definitions,samples:[{...samples[0],intrinsicRows:[]}]}),/row count changed/);
});
