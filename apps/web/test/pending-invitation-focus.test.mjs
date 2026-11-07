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
 const context={actionEl:f.original,gameId:'a',game:{id:'a'},HTMLElement:Element,HTMLInputElement:Input,panelPendingFocus:map,pendingInvitationFocus:f.manager,getCopyInviteButtonKey:()=> 'copy:a',document:f.document,joinEl:join,markup:'pending',joinMarkupByElement:new WeakMap(),CSS:{escape:x=>x},isButtonPending:()=>true,patchToolHtml:()=>{current.disabled=true;f.document.activeElement=f.document.body;}};
 vm.runInNewContext(`(()=>{${source.slice(beginStart,beginEnd)}})()`,context);assert.equal(map.has(join),false);
 vm.runInNewContext(`(()=>{${source.slice(start,end)}})()`,context);assert.equal(map.has(join),false);
 f.manager.notePointer({closest:()=>null});f.finish();context.isButtonPending=()=>false;context.patchToolHtml=()=>{current.disabled=false;};
 vm.runInNewContext(`(()=>{${source.slice(start,end)}})()`,context);
 assert.equal(map.has(join),false);assert.equal(f.restore(),false);assert.equal(f.document.activeElement,f.document.body);
});

test('actual app preserves nonpending viewer role focus when an occupied seat removes its preceding invite',async()=>{
 const {readFile}=await import('node:fs/promises');const vm=await import('node:vm');
 const {invitationOptions}=await import('../shell/invitations.js');
 const game={id:'a',player1:{identityId:'owner'},player2:null};
 assert.deepEqual(invitationOptions(game).map(x=>x.role),['blue','viewer']);
 const source=await readFile(new URL('../shell/app.js',import.meta.url),'utf8');
 const start=source.indexOf('      const focus=joinEl.contains(document.activeElement)');
 const end=source.indexOf('      if (animateJoin)',start);assert.ok(start>0&&end>start);
 class Element{};class Input extends Element{};
 const f=fixture(),join=new Element(),map=new WeakMap(),original=f.original;
 original.dataset={action:'copy-invite',inviteRole:'viewer'};original.matches=()=>false;
 let current=original;
 join.contains=node=>node===original;
 join.querySelector=selector=>{assert.equal(selector,'[data-action="copy-invite"][data-invite-role="viewer"]');return current;};
 // Model only the DOM patch boundary: the positional patch removes the old
 // second button after Blue is occupied; the real app must restore by role.
 const context={game,HTMLElement:Element,HTMLInputElement:Input,panelPendingFocus:map,document:f.document,joinEl:join,markup:'occupied-seat',joinMarkupByElement:new WeakMap(),CSS:{escape:x=>x},isButtonPending:()=>false,getCopyInviteButtonKey:id=>`copy:${id}`,patchToolHtml:()=>{original.isConnected=false;current=f.control();f.setNodes([current]);f.document.activeElement=f.document.body;}};
 game.player2={identityId:'friend'};assert.deepEqual(invitationOptions(game).map(x=>x.role),['viewer']);
 // No manager.begin: the user only focused Viewer, never started clipboard work.
 f.finish();vm.runInNewContext(`(()=>{${source.slice(start,end)}})()`,context);
 assert.equal(original.isConnected,false);assert.equal(current.isConnected,true);assert.notEqual(current,original);
 f.restore();assert.equal(f.document.activeElement,current);
});

// Execute the actual registration boundary with the real intent owner. Calling
// manager.notePointer directly would miss a legacy mouse-only registration gap.
async function registeredPendingFocusFixture(sourceUrl=new URL('../shell/app.js',import.meta.url)) {
 const {readFile}=await import('node:fs/promises');const vm=await import('node:vm');
 const source=await readFile(sourceUrl,'utf8');
 const start=source.indexOf('const pendingInvitationFocus = createPendingInvitationFocus({');
 const end=source.indexOf("document.addEventListener('pointerdown',event=>joinFeedback.noteFocus",start);
 assert.ok(start>0&&end>start,'Actual invitation intent registration boundary is required');
 const f=fixture(),listeners=new Map();let factoryCalls=0,pending=true,nodes=[f.original];
 f.document.addEventListener=(type,handler)=>listeners.set(type,[...(listeners.get(type)??[]),handler]);
 const window={location:{hash:f.scope.route},addEventListener(){}};
 const context={document:f.document,window,transport:f.scope.owner,account:{snapshot:()=>({generation:f.scope.generation})},inviteVisit:f.scope.visit,getGamePanel:()=>f.scope.panel,
  createPendingInvitationFocus:options=>{factoryCalls++;return createPendingInvitationFocus(options);}};
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.actualPendingFocus=pendingInvitationFocus;',context);
 assert.equal(factoryCalls,1);assert.equal(listeners.get('pointerdown')?.length,1);
 const manager=context.actualPendingFocus;manager.begin(f.original,'copy:a');
 return {...f,manager,listeners,dispatch:(type,target)=>{for(const handler of listeners.get(type)??[])handler({target});},
  replace:()=>{f.original.disabled=true;f.original.isConnected=false;f.document.activeElement=f.document.body;const next=f.control();nodes=[next];return next;},
  complete:()=>{pending=false;return manager.restore({root:{querySelectorAll:()=>nodes},pending:()=>pending});}};
}
test('registered legacy mouse-only foreign press retires pending copy intent',async()=>{
 const f=await registeredPendingFocusFixture(),next=f.replace();
 assert.equal(f.document.activeElement,f.document.body);assert.equal(next.isConnected,true);
 f.dispatch('mousedown',{closest:()=>null});
 assert.equal(f.complete(),false);assert.equal(f.document.activeElement,f.document.body);
});
test('registered legacy mouse-only matching invitation preserves pending copy intent',async()=>{
 const f=await registeredPendingFocusFixture();f.dispatch('mousedown',f.original);const next=f.replace();
 assert.equal(f.complete(),true);assert.equal(f.document.activeElement,next);
});
test('registered pointer and compatibility mouse foreign events retire the same intent idempotently',async()=>{
 const f=await registeredPendingFocusFixture(),next=f.replace(),foreign={closest:()=>null};
 f.dispatch('pointerdown',foreign);f.dispatch('mousedown',foreign);
 assert.equal(f.complete(),false);assert.equal(f.document.activeElement,f.document.body);
 assert.equal(next.isConnected,true);
});

test('actual render wrapper preserves completed copy focus through a later same-view shell replacement',async()=>{
 const {readFile}=await import('node:fs/promises');const vm=await import('node:vm');
 const source=await readFile(new URL('../shell/app.js',import.meta.url),'utf8');
 const start=source.indexOf('const render = ({ animatePanels = true, includeBoard = true } = {}) => {');
 const end=source.indexOf('const renderContent =',start);assert.ok(start>0&&end>start);
 const f=fixture();f.manager.begin(f.original,'copy:a');f.finish();let current=f.original,replacements=0;
 const context={document:f.document,pendingInvitationFocus:f.manager,isButtonPending:()=>false,
  renderGesture:{defer:()=>false},utilityMemory:{capture(){},restore(){}},inlineProfiles:{sync(){}},syncMountedGameShellPanelUi(){},
  currentRoute:{gameId:'a'},pendingResultReviewFocus:null,getGamePanel:()=>f.scope.panel,getCurrentViewedGameId:()=> 'a',
  preserveBoardFocus:(_options,render)=>render(),joinFeedback:{restoreFocus(){}},
  appEl:{querySelectorAll:()=>[current]},renderContent:()=>{
   current.isConnected=false;current=f.control();f.document.activeElement=f.document.body;replacements++;
  },
 };
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.renderActual=render;',context);
 context.renderActual();const first=current;assert.equal(f.document.activeElement,first);
 context.renderActual();assert.equal(replacements,2);assert.notEqual(current,first);
 assert.equal(first.isConnected,false);assert.equal(f.document.activeElement,current);
});

test('completed focus follows repeated replacements but yields a blur of the still-mounted control',()=>{
 const f=fixture();f.manager.begin(f.original,'copy:a');f.finish();assert.equal(f.restore(),true);
 for(let i=0;i<3;i++){
  f.document.activeElement.isConnected=false;f.document.activeElement=f.document.body;
  const next=f.control();f.setNodes([next]);assert.equal(f.restore(),true);assert.equal(f.document.activeElement,next);
 }
 const mounted=f.document.activeElement;f.document.activeElement=f.document.body;
 assert.equal(mounted.isConnected,true);assert.equal(f.restore(),false);
 mounted.isConnected=false;f.setNodes([f.control()]);assert.equal(f.restore(),false);
 assert.equal(f.document.activeElement,f.document.body);
});

for(const movement of ['focus','pointer','clear','owner','generation','visit','route','panel','hidden','document-blur'])test(`completed invitation focus yields ${movement} before a later replacement`,()=>{
 const f=fixture();f.manager.begin(f.original,'copy:a');f.finish();assert.equal(f.restore(),true);
 if(movement==='focus'){const other={};f.document.activeElement=other;f.manager.noteFocus(other);}
 if(movement==='pointer')f.manager.notePointer({closest:()=>null});
 if(movement==='clear')f.manager.clear();
 if(['owner','generation','visit','route','panel'].includes(movement))f.scope[movement]=movement==='owner'?{}:'changed';
 if(movement==='hidden')f.document.hidden=true;
 if(movement==='document-blur')f.document.hasFocus=()=>false;
 f.original.isConnected=false;f.document.activeElement=f.document.body;f.setNodes([f.control()]);
 assert.equal(f.restore(),false);assert.equal(f.document.activeElement,f.document.body);
 f.document.hidden=false;f.document.hasFocus=()=>true;assert.equal(f.restore(),false);
});

test('a new copy supersedes completed focus intent and refuses an absent selected role',()=>{
 const f=fixture();f.manager.begin(f.original,'copy:a');f.finish();assert.equal(f.restore(),true);
 const player=f.control('player');f.document.activeElement=player;f.manager.begin(player,'copy:a');
 f.original.isConnected=false;player.isConnected=false;f.document.activeElement=f.document.body;
 const nextPlayer=f.control('player'),nextViewer=f.control();f.setNodes([nextViewer,nextPlayer]);
 assert.equal(f.restore(),true);assert.equal(f.document.activeElement,nextPlayer);
 nextPlayer.isConnected=false;f.document.activeElement=f.document.body;f.setNodes([nextViewer]);
 assert.equal(f.restore(),false);assert.equal(f.document.activeElement,f.document.body);
 f.setNodes([nextViewer,f.control('player')]);assert.equal(f.restore(),false);
});
