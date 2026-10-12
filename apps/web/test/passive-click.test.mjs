import test from 'node:test';
import assert from 'node:assert/strict';
import {isPassivePageClick} from '../shell/passive-click.js';
const element = selector => ({matches: list => list.split(',').includes(selector)});
test('a detached clicked child keeps its original interactive owner',()=>{
 const child={matches:()=>false,closest:()=>null};
 for(const owner of ['#shell-board','.shell-flyout','button','input','[data-action]'])
  assert.equal(isPassivePageClick({composedPath:()=>[child,element(owner),{}]}),false);
});
test('ordinary page space permits dismissal, including a text-node target',()=>{
 assert.equal(isPassivePageClick({composedPath:()=>[{},element('p'),element('main')]}),true);
});
