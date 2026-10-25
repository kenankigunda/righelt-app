import test from 'node:test';
import assert from 'node:assert/strict';
import {destructionLabel,placeEventLabels} from '../board/event-labels.js';
const viewport={left:0,top:0,width:320,height:500};
const item=(id,left=140,top=200)=>({id,width:75,height:24,anchor:{left,top,right:left+25,bottom:top+25}});
const intersects=(a,b)=>a.left<b.left+b.width&&a.left+a.width>b.left&&a.top<b.top+b.height&&a.top+a.height>b.top;
test('brief cause labels preserve records and do not infer a legacy commander cause',()=>{
 const records=[{reason:'loss_of_supply',message:'Piece at (6, 4) destroyed due to loss of supply',pieceId:'A'}, {reason:'no_retreat',message:'Original no-retreat detail'}, {reason:'commander_unsupplied',message:'Legacy ambiguous removal'}, {reason:'unknown'}, {}];
 const before=structuredClone(records);records.forEach(Object.freeze);
 assert.deepEqual(records.map(destructionLabel),['Lost supply','No retreat','Destroyed','Destroyed','Destroyed']);assert.equal(destructionLabel(null),'Destroyed');assert.deepEqual(records,before);
});
test('labels flip at the top, shift at side edges and stay inside an offset visual viewport',()=>{
 for(const [left,top] of [[0,0],[300,0],[0,480],[300,480]]){
  const [rect]=placeEventLabels({viewport,items:[item('edge',left,top)]});
  assert(rect.left>=8&&rect.top>=8&&rect.left+rect.width<=312&&rect.top+rect.height<=492);
  if(top===0)assert.notEqual(rect.placement,'top');
 }
 assert.equal(placeEventLabels({viewport,items:[item('top-center',140,0)]})[0].placement,'bottom');
 const shifted={left:80,top:120,width:180,height:220};const [rect]=placeEventLabels({viewport:shifted,items:[item('offset',80,120)]});
 assert(rect.left>=88&&rect.top>=128&&rect.left+rect.width<=252&&rect.top+rect.height<=332);
});
test('a batch of adjacent losses avoids overlapping labels when space is available',()=>{
 const items=Array.from({length:5},(_,index)=>item(`loss-${index}`,110+index*8,200));
 const before=structuredClone(items),placed=placeEventLabels({viewport,items});assert.equal(placed.length,5);
 for(let i=0;i<placed.length;i++)for(let j=i+1;j<placed.length;j++)assert.equal(intersects(placed[i],placed[j]),false,`${i} and ${j}`);
 assert.deepEqual(items,before);assert.deepEqual(placeEventLabels({viewport,items}),placed);
});
test('small viewports and malformed items never produce nonfinite positions',()=>{
 assert.deepEqual(placeEventLabels({viewport:{left:0,top:0,width:0,height:0},items:[item('none')]}),[]);
 assert.deepEqual(placeEventLabels({viewport,items:[{...item('bad'),anchor:{left:NaN}}]}),[]);
 const [rect]=placeEventLabels({viewport:{left:10,top:20,width:60,height:70},items:[{...item('small'),width:400,height:200}]});
 assert.equal(rect.width,44);assert.equal(rect.height,54);assert.equal(rect.left,18);assert.equal(rect.top,28);
});
