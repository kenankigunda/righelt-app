import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {CURRENT_COMPUTER_MODEL,COMPUTER_MODELS,computerModelForCreation,createComputerControl,changeComputerControl} from '../../shared-types/src/computer-play.ts';

test('published models retain exact assets and cached creation retains its original default',async()=>{
 assert.equal(CURRENT_COMPUTER_MODEL.id,'trained-20261029-1086');
 for(const model of Object.values(COMPUTER_MODELS)){
  const bytes=await readFile(new URL('../../../apps/web'+model.url,import.meta.url));
  assert.equal(bytes.length,model.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),model.sha256);
 }
 assert.equal(computerModelForCreation(undefined).id,'initial-1554');
 assert.equal(computerModelForCreation(CURRENT_COMPUTER_MODEL.id),CURRENT_COMPUTER_MODEL);
 assert.equal(computerModelForCreation('unpublished'),null);
});

test('a retained game changes model only on explicit upgrade and fences previous workers',()=>{
 const input={ownerId:'owner',authContextId:'session',deviceId:'device',turnIndex:1,now:100};
 const old=changeComputerControl(createComputerControl('owner',{p1:null,p2:'babs'},'initial-1554'),{...input,generation:0,action:'acquire'});
 const before=structuredClone(old);
 const next=changeComputerControl(old,{...input,generation:old.generation,action:'upgrade'});
 assert.equal(old.modelId,'initial-1554');assert.deepEqual(old,before);
 assert.equal(next.modelId,CURRENT_COMPUTER_MODEL.id);assert.equal(next.generation,old.generation+1);
});
