import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createJoinFeedback} from '../shell/join-feedback.js';
import {createPendingInvitationFocus} from '../shell/pending-invitation-focus.js';
import {createRenderGestureGate,preserveBoardFocus} from '../shell/render-gesture.js';

// Exercise the production render wrapper with the real gesture and feedback
// stores. Markup replacement is the DOM boundary; no request timing is mocked.
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const start=source.indexOf('const render = ({ animatePanels');
const end=source.indexOf('\nconst renderContent =',start);
assert.ok(start>=0&&end>start,'Expected the production render wrapper');
const fixture=()=>{
 let scope={owner:{},generation:1,visit:1,route:'#/invite/a'},busy=false,renderCount=0;
 const body={},document={body,activeElement:body,hidden:false,hasFocus:()=>true};
 const feedback=createJoinFeedback({getScope:gameId=>({gameId,...scope})});
 const pendingInvitationFocus=createPendingInvitationFocus({document,getScope:()=>({...scope,panel:'players'})});
 const control=()=>({disabled:busy,isConnected:true,matches:()=>false,closest(){return this;},
  getAttribute:name=>name==='data-action'?'accept-invite-player':name==='data-game-id'?'g':null,
  focus(){document.activeElement=this;feedback.noteFocus(this);}});
 const admissions=[];let panelOwner=null;
 let mounted=control();document.activeElement=mounted;
 const root={querySelectorAll:()=>[mounted],querySelector:()=>null};
 const scheduled=new Map();let sequence=0,context;
 const gate=createRenderGestureGate({render:options=>context.render(options),schedule:fn=>{scheduled.set(++sequence,fn);return sequence;},cancel:id=>scheduled.delete(id)});
 context={historyHeadingFocus:{capture:()=>null,restore:()=>false},syncRenderedMarkupSnapshot(){admissions.push({mounted,panelSynced:panelOwner===mounted});},resumeBoardContextReplay(){},document,appEl:root,joinFeedback:feedback,pendingInvitationFocus,isButtonPending:()=>busy,renderGesture:gate,preserveBoardFocus,getCurrentViewedGameId:()=> 'g',
  utilityMemory:{capture(){},restore(){}},inlineProfiles:{sync(){}},syncMountedGameShellPanelUi(){panelOwner=mounted;},
  currentRoute:{gameId:'g'},recoveryPresentationOptions(){},pendingResultReviewFocus:null,getGamePanel:()=> 'board',
  renderContent(){renderCount++;mounted.isConnected=false;mounted=control();document.activeElement=body;}};
 runInNewContext(`${source.slice(start,end)}\nglobalThis.render=render;`,context);
 const flush=()=>{const jobs=[...scheduled.values()];scheduled.clear();for(const fn of jobs)fn();};
 return {admissions,feedback,document,body,gate,context,flush,button:()=>mounted,renders:()=>renderCount,
  change:values=>Object.assign(scope,values),busy:value=>busy=value};
};

test('a join failing before keyup restores focus only at the committed render',()=>{
 const f=fixture(),original=f.button(),token=f.feedback.begin('g',{focusAction:'accept-invite-player'});
 f.gate.begin();f.busy(true);f.context.render({animatePanels:false,includeBoard:false});
 f.feedback.fail(token);f.busy(false);f.context.render({animatePanels:false,includeBoard:false});
 assert.equal(f.document.activeElement,original);assert.equal(f.renders(),0);
 f.gate.end();assert.equal(f.renders(),0);f.flush();
 assert.equal(f.renders(),1);assert.notEqual(f.button(),original);
 assert.equal(f.document.activeElement,f.button());assert.equal(f.button().disabled,false);
 assert.equal(f.feedback.message('g'),'Could not join. Try again');
 const afterFailure=f.button();f.context.render({animatePanels:false,includeBoard:false});
 assert.notEqual(f.button(),afterFailure);assert.equal(f.document.activeElement,f.button());
});

test('a slower failed join restores focus after the pending control was disabled',()=>{
 const f=fixture(),token=f.feedback.begin('g',{focusAction:'accept-invite-player'});
 f.busy(true);f.context.render({animatePanels:false,includeBoard:false});
 assert.equal(f.button().disabled,true);assert.equal(f.document.activeElement,f.body);
 f.feedback.fail(token);f.busy(false);f.context.render({animatePanels:false,includeBoard:false});
 assert.equal(f.document.activeElement,f.button());assert.equal(f.button().disabled,false);
});

for(const mode of ['other-focus','pointer-body','account','owner','visit','route','success'])
 test(`deferred join failure cannot reclaim focus after ${mode}`,()=>{
  const f=fixture(),token=f.feedback.begin('g',{focusAction:'accept-invite-player'});
  f.gate.begin();f.context.render({animatePanels:false,includeBoard:false});f.feedback.fail(token);
  f.context.render({animatePanels:false,includeBoard:false});
  if(mode==='other-focus')f.document.activeElement={};
  if(mode==='pointer-body'){f.feedback.noteFocus(f.body);f.document.activeElement=f.body;}
  if(mode==='account')f.change({generation:2});
  if(mode==='owner')f.change({owner:{}});
  if(mode==='visit')f.change({visit:2});
  if(mode==='route')f.change({route:'#/'});
  if(mode==='success')f.feedback.complete(token);
  f.gate.end();f.flush();
  assert.equal(f.document.activeElement,f.body);assert.equal(f.button().disabled,false);
 });

// The production wrapper must admit a replacement shell before returning. A
// deferred render cannot admit the old DOM instead of the newly committed one.
test('committed render admits the current shell after deferred replacement',()=>{
 const f=fixture(),original=f.button();f.gate.begin();
 f.context.render({animatePanels:false,includeBoard:false});
 assert.equal(f.admissions.length,0);assert.equal(f.button(),original);
 f.gate.end();f.flush();assert.equal(f.admissions.length,1);
 assert.equal(f.admissions[0].panelSynced,true);assert.equal(f.admissions[0].mounted,f.button());assert.notEqual(f.button(),original);
});

test('shell admission occurs before Board, utility and join focus restoration',()=>{
 const f=fixture(),order=[];
 f.context.preserveBoardFocus=(_options,commit)=>{const result=commit();order.push('Board focus');return result;};
 const admit=f.context.syncRenderedMarkupSnapshot;
 f.context.syncRenderedMarkupSnapshot=()=>{admit();order.push('admission');};
 f.context.utilityMemory.restore=()=>order.push('utility focus');
 f.context.joinFeedback.restoreFocus=()=>order.push('join focus');
 f.context.render({animatePanels:false,includeBoard:false});
 assert.deepEqual(order,['admission','Board focus','utility focus','join focus']);
 assert.equal(f.admissions[0].panelSynced,true);
});
