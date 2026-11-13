import test from 'node:test';
import assert from 'node:assert/strict';
import {createInlineActionAvailability} from '../board/inline-action-availability.js';
import {patchBoardMessage} from '../board/message-presentation.js';
const control=(intrinsic=false)=>{let disabled=intrinsic;const writes=[];return {writes,get disabled(){return disabled;},set disabled(value){writes.push(value);disabled=value;}};};
test('turn-control availability applies each genuine transition once and never temporarily enables a blocked button',()=>{
 const button=control(),owner=createInlineActionAvailability(),root={querySelectorAll:()=>[button]};
 owner.sync(root,false);assert.deepEqual(button.writes,[]);owner.sync(root,true);owner.sync(root,true);owner.sync(root,true);assert.deepEqual(button.writes,[true]);assert(owner.owns(button));
 owner.sync(root,false);owner.sync(root,false);assert.deepEqual(button.writes,[true,false]);assert(!owner.owns(button));owner.sync(root,true);assert.deepEqual(button.writes,[true,false,true]);
});
test('intrinsic disabled state and detached or replaced controls never gain a temporary availability exemption',()=>{
 const intrinsic=control(true),owned=control(),replacement=control(true),owner=createInlineActionAvailability();let current=[intrinsic,owned];const root={querySelectorAll:()=>current};
 owner.sync(root,true);assert(!owner.owns(intrinsic));assert(owner.owns(owned));current=[intrinsic,replacement];owner.sync(root,false);
 assert(!owner.owns(owned));assert.deepEqual(intrinsic.writes,[]);assert.deepEqual(replacement.writes,[]);assert.equal(intrinsic.disabled,true);assert.equal(replacement.disabled,true);owner.clear();assert(!owner.owns(replacement));
});

// Controlled DOM nodes exercise the real patcher. Browser parsing, native focus
// and painted-frame timing remain explicit native acceptance questions.
function element(action,{disabled=false,extra=[]}={}){
 const attrs=new Map([['class','board-preview-inline-button'],['data-board-message-action',action],...extra]);if(disabled)attrs.set('disabled','');
 const text={nodeType:3,nodeName:'#text',nodeValue:'Pass',childNodes:[]};
 const node={nodeType:1,nodeName:'BUTTON',childNodes:[text],firstChild:text,title:'',dataset:{boardMessageAction:action},writes:[],matches:()=>true,getAttribute:key=>attrs.get(key)??null,querySelectorAll:()=>[],get attributes(){return [...attrs].map(([name,value])=>({name,value}));},get disabled(){return attrs.has('disabled');},set disabled(value){this.writes.push(value);if(value)attrs.set('disabled','');else attrs.delete('disabled');}};
 return node;
}
function patchFixture(current,next){
 const parsed={childNodes:[next],querySelectorAll:()=>[],set innerHTML(value){this.requested=value;}};
 const root={ownerDocument:{createElement:()=>parsed},childNodes:[current]};
 return {root,parsed};
}
test('actual message patch ignores only the current runtime owner disabled decoration without changing it',()=>{
 const current=element('pass'),next=element('pass'),owner=createInlineActionAvailability();owner.sync({querySelectorAll:()=>[current]},true);const f=patchFixture(current,next);
 assert.equal(patchBoardMessage(f.root,'<button data-board-message-action="pass">Pass</button>',{isRuntimeDisabled:owner.owns}),true);
 assert.equal(f.root.childNodes[0],current);assert.equal(current.disabled,true);assert.deepEqual(current.writes,[true]);assert.equal(current.childNodes[0].nodeValue,'Pass');
});
for(const change of ['unmanaged-disabled','incoming-disabled','different-action','different-semantic-attribute'])test(`actual message patch preserves ${change} as a real content difference`,()=>{
 const current=element('pass',{disabled:change==='unmanaged-disabled'}),owner=createInlineActionAvailability();if(change!=='unmanaged-disabled')owner.sync({querySelectorAll:()=>[current]},true);
 const next=element(change==='different-action'?'end-turn':'pass',{disabled:change==='incoming-disabled',extra:change==='different-semantic-attribute'?[['aria-label','Different action']]:[]});
 const f=patchFixture(current,next);assert.equal(patchBoardMessage(f.root,'<button>next parser result</button>',{isRuntimeDisabled:owner.owns}),false);assert.equal(current.disabled,true);
});
