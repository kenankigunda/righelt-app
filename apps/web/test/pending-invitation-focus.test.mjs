import test from 'node:test';
import assert from 'node:assert/strict';
import {createPendingInvitationFocus} from '../shell/pending-invitation-focus.js';
const fixture = () => {
 const document={body:{},hidden:false,hasFocus:()=>true};
 let scope={owner:{},generation:1,visit:2,route:'#/game/a',panel:'players'}, pending=true, nodes=[];
 const control=(role='viewer')=>({isConnected:true,disabled:false,attrs:{'data-action':'copy-invite','data-game-id':'a','data-invite-role':role},getAttribute(k){return this.attrs[k]??null;},closest(){return this.hiddenAncestor?{}:null;},focus(){document.activeElement=this;}});
 const original=control();document.activeElement=original;nodes=[original];
 const manager=createPendingInvitationFocus({document,getScope:()=>scope});
 const restore=()=>manager.restore({root:{querySelectorAll:()=>nodes},pending:()=>pending});
 return {document,manager,original,control,restore,scope,setNodes:v=>nodes=v,finish:()=>pending=false};
};
test('pending invitation intent survives actual control/root identity replacement',()=>{
 const f=fixture();f.manager.begin(f.original,'copy:a');f.original.disabled=true;f.document.activeElement=f.document.body;
 assert.equal(f.restore(),false);f.original.isConnected=false;const next=f.control();next.disabled=true;f.setNodes([next]);
 assert.equal(f.restore(),false);f.finish();next.disabled=false;assert.equal(f.restore(),true);assert.equal(f.document.activeElement,next);
 f.document.activeElement=f.document.body;assert.equal(f.restore(),false);
});
test('no-transition completion restores the original enabled control',()=>{const f=fixture();f.manager.begin(f.original,'copy:a');f.document.activeElement=f.document.body;f.finish();assert.equal(f.restore(),true);assert.equal(f.document.activeElement,f.original);});
test('intentional movement is not stolen even if focus subsequently returns to body',()=>{const f=fixture();f.manager.begin(f.original,'copy:a');const other={};f.document.activeElement=other;f.manager.noteFocus(other);f.document.activeElement=f.document.body;f.finish();assert.equal(f.restore(),false);});
for(const key of ['owner','generation','visit','route','panel'])test(`retired ${key} cannot restore old invitation intent`,()=>{const f=fixture();f.manager.begin(f.original,'copy:a');f.scope[key]=key==='owner'?{}:'changed';f.document.activeElement=f.document.body;f.finish();assert.equal(f.restore(),false);});
for(const reason of ['hidden','document-blur','disabled','inert','wrong-role','wrong-game'])test(`completion refuses ${reason}`,()=>{
 const f=fixture();f.manager.begin(f.original,'copy:a');f.document.activeElement=f.document.body;f.finish();
 if(reason==='hidden')f.document.hidden=true;if(reason==='document-blur')f.document.hasFocus=()=>false;
 if(reason==='disabled')f.original.disabled=true;if(reason==='inert')f.original.hiddenAncestor=true;
 if(reason==='wrong-role')f.original.attrs['data-invite-role']='player';if(reason==='wrong-game')f.original.attrs['data-game-id']='b';
 assert.equal(f.restore(),false);assert.equal(f.document.activeElement,f.document.body);
});
test('pointer activation without focused control does not manufacture keyboard intent',()=>{const f=fixture();f.document.activeElement=f.document.body;f.manager.begin(f.original,'copy:a');f.finish();assert.equal(f.restore(),false);});

test('deliberate pointer on nonfocusable same-view content retires restoration',()=>{
 const f=fixture();f.manager.begin(f.original,'copy:a');f.original.disabled=true;f.document.activeElement=f.document.body;
 f.manager.notePointer({closest:()=>null});f.original.isConnected=false;const next=f.control();f.setNodes([next]);f.finish();
 assert.equal(f.restore(),false);assert.equal(f.document.activeElement,f.document.body);
});

// Exercise the actual app patch, not a duplicate of its focus condition.
test('actual app panel patch cannot restore a pointer-retired pending copy',async()=>{
 const {readFile}=await import('node:fs/promises');const vm=await import('node:vm');
 const source=await readFile(new URL('../shell/app.js',import.meta.url),'utf8');
 const beginStart=source.indexOf('    const invitationPanel = actionEl.closest(');
 const beginEnd=source.indexOf('    await withPendingButton(getCopyInviteButtonKey(gameId),',beginStart);
 const start=source.indexOf('      const focus=joinEl.contains(document.activeElement)');
 const end=source.indexOf('      if (animateJoin)',start);
 assert.ok(beginStart>0&&beginEnd>beginStart&&start>0&&end>start);
 class Element{};class Input extends Element{};
 const f=fixture(),join=new Element(),map=new WeakMap();let current=f.original;
 f.original.dataset={action:'copy-invite',inviteRole:'viewer'};f.original.matches=()=>false;
 join.contains=node=>node===current;join.querySelector=()=>current;f.original.closest=()=>join;
 map.set(join,{selector:'[data-action="copy-invite"]',selection:null});
 const context={actionEl:f.original,gameId:'a',HTMLElement:Element,HTMLInputElement:Input,panelPendingFocus:map,pendingInvitationFocus:f.manager,getCopyInviteButtonKey:()=> 'copy:a',document:f.document,joinEl:join,markup:'pending',joinMarkupByElement:new WeakMap(),CSS:{escape:x=>x},isButtonPending:()=>true,patchToolHtml:()=>{current.disabled=true;f.document.activeElement=f.document.body;}};
 vm.runInNewContext(`(()=>{${source.slice(beginStart,beginEnd)}})()`,context);assert.equal(map.has(join),false);
 vm.runInNewContext(`(()=>{${source.slice(start,end)}})()`,context);assert.equal(map.has(join),false);
 f.manager.notePointer({closest:()=>null});f.finish();context.isButtonPending=()=>false;context.patchToolHtml=()=>{current.disabled=false;};
 vm.runInNewContext(`(()=>{${source.slice(start,end)}})()`,context);
 assert.equal(map.has(join),false);assert.equal(f.restore(),false);assert.equal(f.document.activeElement,f.document.body);
});
