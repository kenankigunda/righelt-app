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
