import test from 'node:test';
import assert from 'node:assert/strict';
import {createComputerControlWork} from '../shell/computer-control-work.js';
const context=()=>({transport:{},accountGeneration:1,game:{id:'first-game'}});
test('same owner scope shares its pending controls',()=>{const get=createComputerControlWork(),c=context();get(c).controlWork++;assert.equal(get({...c,game:{id:c.game.id}}).controlWork,1);});
for(const field of ['game','transport','accountGeneration'])test(`foreign ${field} scope retains independent pending control work`,()=>{
 const get=createComputerControlWork(),c=context(),old=get(c);old.leaseWork=Promise.resolve();old.resumeWork=Promise.resolve();old.controlWork=1;
 const next={...c,[field]:field==='game'?{id:'second-game'}:field==='transport'?{}:2},current=get(next);
 assert.notEqual(current,old);assert.deepEqual(current,{leaseWork:null,leaseWorkAction:null,resumeWork:null,controlWork:0});
 old.leaseWork=null;old.controlWork--;assert.equal(get(next),current);assert.equal(get(c),old);
});
