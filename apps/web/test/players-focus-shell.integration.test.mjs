import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createInlineProfiles} from '../shell/public-profile.js';
import {renderPlayersPanel} from '../shell/players-panel.js';

// Exercise the actual mounted-shell boundary. The DOM patcher itself has its
// own tests; this regression ensures presence does not bypass it with innerHTML.
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const start=source.indexOf('const updateMountedGameShell ='),end=source.indexOf('const doesMountedFlyoutStateMatchRoute =',start);
assert.ok(start>=0&&end>start);

test('mounted Players presence refresh patches the join subtree and retains the focused human profile key',async()=>{
 class Element{matches(){return false;}}
 const game={id:'g',myRole:'Player 1',myRoles:['Player 1'],player1:{identityId:'me',connected:false,profile:{username:'Owner',displayName:'VeryLongUnbrokenDisplayName12345'}},player2:{identityId:'friend'},viewers:[]};
 const owner=new Element();owner.dataset={action:'public-profile',profileKey:'seat:P1'};owner.disabled=false;
 const document={activeElement:owner,body:{},getElementById:()=>null,querySelector:()=>({}),querySelectorAll:()=>[owner]};
 const attributes=new Map();owner.setAttribute=(name,value)=>attributes.set(name,value);owner.dataset.username='Owner';
 const slot={innerHTML:'',getBoundingClientRect:()=>({height:0}),getAnimations:()=>[]};
 owner.parentElement={querySelector:()=>slot};
 let releaseProfile;const response=new Promise(resolve=>releaseProfile=resolve);
 const profiles=createInlineProfiles({document,fetcher:()=>response});
 owner.focus=()=>{document.activeElement=owner;};
 const join=new Element();join.contains=node=>node===owner;join.getBoundingClientRect=()=>({height:200});
 join.querySelector=selector=>selector.includes('public-profile')&&selector.includes('seat:P1')?owner:null;
 Object.defineProperty(join,'innerHTML',{set(){assert.fail('Presence must not replace a focused Players subtree with innerHTML');}});
 const root=new Element();root.querySelector=selector=>selector==='[data-game-panel="join"]'?join:null;
 const rendered=[],patched=[];
 const context={HTMLElement:Element,HTMLInputElement:class{},CSS:{escape:value=>value},document,window:{location:{origin:'https://local',pathname:'/'}},
  getMountedGameShellRoot:()=>root,buildInviteHash:()=> '#/invite/g',getCurrentFlyoutState:()=>({}),
  renderJoinInvitePanel:()=>{const markup=`<h2>Players</h2>${renderPlayersPanel(game,{identityId:'me'})}`;rendered.push(markup);return markup;},
  patchToolHtml:(current,markup)=>{assert.equal(current,join);patched.push(markup);},
  joinMarkupByElement:new Map(),routeTransition:null,panelPendingFocus:new Map(),panelSizeAnimations:new Map(),
  isButtonPending:()=>false,getCopyInviteButtonKey:()=> 'copy',applySharedMutationGates(){},FLYOUT_KEYS:[],
  reconcileMiniBoardPreviews(){},syncMountedGameShellPanelUi(){},scheduleGameShellStickyLayout(){},mountedBoardGameId:null,
 };
 runInNewContext(`${source.slice(start,end)};globalThis.refresh=game=>updateMountedGameShell({game,includeBoard:false});`,context);
 assert.equal(context.refresh(game),true);
 const loadingProfile=profiles.open('Owner',owner);
 assert.equal(attributes.get('aria-expanded'),'true');
 assert.equal(document.activeElement,owner);assert.equal(owner.dataset.profileKey,'seat:P1');
 game.player1.connected=true;
 assert.equal(context.refresh(game),true);profiles.sync();
 assert.equal(patched.length,2);assert.equal(patched[0],rendered[0]);assert.equal(patched[1],rendered[1]);
 assert.match(patched[0],/aria-label="VeryLongUnbrokenDisplayName12345, you, Red, Disconnected"/);assert.match(patched[1],/aria-label="VeryLongUnbrokenDisplayName12345, you, Red, Connected"/);
 assert.equal(document.activeElement,owner);assert.equal(owner.dataset.profileKey,'seat:P1');assert.equal(context.panelPendingFocus.size,0);
 releaseProfile({ok:true,json:async()=>({joinedMonth:'2025-01'})});await loadingProfile;
 assert.match(slot.innerHTML,/Joined January 2025/);assert.equal(attributes.get('aria-expanded'),'true');assert.equal(document.activeElement,owner);
});
