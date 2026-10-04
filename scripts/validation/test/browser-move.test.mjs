import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {provePreviewConfirmation,observeGameApplies,makeValidationMove} from '../browser-move.mjs';

function driver({earlyWrite=false,earlyHistory=false,doubleWrite=false,doubleHistory=false,missingPreview=false}={}){
 let history=4,writes=0,activations=0;const calls=[];
 return {calls,history:async()=>history,writes:()=>writes,
  source:async()=>calls.push('source'),
  destination:async()=>{calls.push('destination');activations++;if(activations===1){if(earlyWrite)writes++;if(earlyHistory)history++;}else{writes+=doubleWrite?2:1;history+=doubleHistory?2:1;}},
  preview:async()=>{calls.push('preview');if(missingPreview)throw Error('Preview missing');},
  committed:async expected=>{calls.push('committed');assert.equal(history,expected);},
 };
}
test('preview precedes confirmation and yields exactly one move',async()=>{
 const d=driver();await provePreviewConfirmation(d);
 assert.deepEqual(d.calls,['source','destination','preview','destination','committed']);
});
for(const mutation of ['earlyWrite','earlyHistory','doubleWrite','doubleHistory','missingPreview']){
 test(`rejects ${mutation} without falling back`,async()=>{
  const d=driver({[mutation]:true});await assert.rejects(()=>provePreviewConfirmation(d));
  if(mutation.startsWith('early')||mutation==='missingPreview')assert.equal(d.calls.filter(x=>x==='destination').length,1);
 });
}
test('apply observer counts only this game POST and always detaches',async()=>{
 const page=new EventEmitter();
 const emit=(method,path)=>page.emit('request',{method:()=>method,url:()=>`https://localhost${path}`});
 await assert.rejects(()=>observeGameApplies(page,'game-1',async writes=>{
  emit('GET','/api/shell/games/game-1/apply');emit('POST','/api/shell/games/game-2/apply');
  assert.equal(writes(),0);emit('POST','/api/shell/games/game-1/apply');assert.equal(writes(),1);
  throw Error('injected failure');
 }),/injected failure/);
 assert.equal(page.listenerCount('request'),0);
 await observeGameApplies(page,'game-1',async writes=>assert.equal(writes(),0));
 assert.equal(page.listenerCount('request'),0);
});
test('missing or malformed candidate capability fails before browser activity',async()=>{
 for(const movePreview of [undefined,null,'true',0])await assert.rejects(()=>makeValidationMove({}, {movePreview}),/capability/);
});
test('preview action retrieval errors are propagated with no legacy fallback',async()=>{
 let calls=0;const page={evaluate:async()=>{calls++;throw Error('No legal action');}};
 await assert.rejects(()=>makeValidationMove(page,{movePreview:true}),/No legal action/);assert.equal(calls,1);
});
for(const touch of [true,false]){
 test(`preview source uses actual ${touch?'touch':'pointer'} activation and cleans up on interruption`,async()=>{
  const page=new EventEmitter();let evaluations=0;const activations=[];
  page.evaluate=async()=>++evaluations===1?{gameId:'g',action:{from:{row:1,col:1},to:{row:2,col:1}}}:touch;
  page.locator=selector=>selector.includes('history-move-item')?{count:async()=>4}:selector.includes('switch-game-panel')?{isVisible:async()=>false}:{
   tap:async()=>{activations.push('tap');throw Error('stop after source');},
   click:async()=>{activations.push('click');throw Error('stop after source');},
  };
  await assert.rejects(()=>makeValidationMove(page,{movePreview:true}),/stop after source/);
  assert.deepEqual(activations,[touch?'tap':'click']);assert.equal(page.listenerCount('request'),0);
 });
}
