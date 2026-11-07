import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {boardActionTraversalKey,readBoardTraversalStart} from '../../../e2e/support/native-board-keyboard.mjs';
test('Firefox reaches the Board action by native forward traversal on each supported platform',()=>{for(const platform of ['darwin','linux','win32'])assert.equal(boardActionTraversalKey({platform,browserName:'firefox'}),'Tab');});
test('macOS WebKit retains its existing all-control native key',()=>assert.equal(boardActionTraversalKey({platform:'darwin',browserName:'webkit'}),'Alt+Tab'));
test('Linux and Windows WebKit retain native forward Tab',()=>{for(const platform of ['linux','win32'])assert.equal(boardActionTraversalKey({platform,browserName:'webkit'}),'Tab');});
test('Chromium retains native forward Tab on each supported platform',()=>{for(const platform of ['darwin','linux','win32'])assert.equal(boardActionTraversalKey({platform,browserName:'chromium'}),'Tab');});
test('an unknown browser cannot silently receive a qualified profile',()=>assert.throws(()=>boardActionTraversalKey({platform:'darwin',browserName:'unknown'}),/Unsupported native keyboard browser/));
test('an unknown platform cannot silently receive a qualified profile',()=>assert.throws(()=>boardActionTraversalKey({platform:'unknown',browserName:'firefox'}),/Unsupported native keyboard platform/));

function startFixture(){
 const doc={defaultView:{Node:{DOCUMENT_POSITION_FOLLOWING:4,DOCUMENT_POSITION_DISCONNECTED:1}}};
 const nav={ownerDocument:doc,isConnected:true,disabled:false,closest:()=>null,compareDocumentPosition:()=>4},button={ownerDocument:doc,isConnected:true,disabled:false,closest:()=>null};
 let handles=[nav];doc.activeElement=nav;doc.querySelectorAll=()=>handles;
 return {doc,nav,button,handles:value=>{handles=value;},sample:()=>readBoardTraversalStart(button)};
}
test('the start reader admits exactly the existing unique connected owned replay control before Board',()=>{const f=startFixture(),r=f.sample();assert.equal(r.ready,true);assert.equal(r.startControlCount,1);assert.equal(r.startControlFocused,true);assert.equal(r.startBeforePrimary,true);});
test('missing and duplicate replay controls fail the start contract',()=>{for(const count of [0,2]){const f=startFixture();f.handles(count?[f.nav,{...f.nav}]:[]);assert.equal(f.sample().ready,false);assert.equal(f.sample().startControlCount,count);}});
test('a detached replay control cannot retain qualified starting focus',()=>{const f=startFixture();f.nav.isConnected=false;assert.equal(f.sample().ready,false);assert.equal(f.sample().startControlConnected,false);});
test('inert replay or Board ancestors reject the start without changing focus',()=>{for(const target of ['nav','button']){const f=startFixture();f[target].closest=()=>({inert:true});assert.equal(f.sample().ready,false);assert.equal(f.doc.activeElement,f.nav);}});
test('foreign active focus is reported without moving it to replay',()=>{const f=startFixture(),foreign={};f.doc.activeElement=foreign;assert.equal(f.sample().ready,false);assert.equal(f.sample().startControlFocused,false);assert.equal(f.doc.activeElement,foreign);});
test('detached primary or a replay control in another document fails closed',()=>{for(const mutate of [f=>f.button.isConnected=false,f=>f.nav.ownerDocument={}]){const f=startFixture();mutate(f);assert.equal(f.sample().ready,false);}});
test('reversed and disconnected document positions cannot qualify an earlier Board action',()=>{for(const position of [0,2,5]){const f=startFixture();f.nav.compareDocumentPosition=()=>position;assert.equal(f.sample().ready,false);assert.equal(f.sample().startBeforePrimary,false);}});

test('disabled replay or primary fails without changing the existing focused node',()=>{for(const target of ['nav','button']){const f=startFixture();f[target].disabled=true;assert.equal(f.sample().ready,false);assert.equal(f.sample()[target==='nav'?'startControlEnabled':'primaryEnabled'],false);assert.equal(f.doc.activeElement,f.nav);}});

const workflow=readFileSync(new URL('../../../e2e/workflows/human-opponent-replay.spec.mjs',import.meta.url),'utf8');
const first=workflow.slice(workflow.indexOf('for(const width of [390,1440])'),workflow.indexOf('for(const width of [390,1440])',workflow.indexOf('for(const width of [390,1440])')+1));
test('short enlarged-text native proof follows existing manual Stop and precedes automatic replay',()=>{const stop=first.indexOf("name:'Stop replay',exact:true}).click()"),short=first.indexOf('await opponent.setViewportSize({width,height:600})'),auto=first.indexOf("await opponent.emulateMedia({reducedMotion:'no-preference'})");assert(stop>=0&&stop<short&&short<auto);assert(first.indexOf("document.documentElement.style.fontSize=''")>short);});
test('existing normal740 cell access and900manual replay remain ordered before short proof',()=>{const cells=first.indexOf('await assertMobileBoardCellAccess('),restore=first.indexOf('await opponent.setViewportSize({width,height:900})',cells),manual=first.indexOf("await opponent.emulateMedia({reducedMotion:'reduce'})"),short=first.indexOf('await opponent.setViewportSize({width,height:600})');assert(cells>=0&&cells<restore&&restore<manual&&manual<short);});
test('workflow preserves original native activation inventory and40gesture loop without focus injection',()=>{assert.equal((first.match(/\.click\(/g)||[]).length,11);assert.equal((first.match(/\.keyboard\.press\(/g)||[]).length,1);assert.equal((first.match(/await assertMobileBoardCellAccess\(/g)||[]).length,1);assert.match(first,/index<40&&!await primary\.evaluate/);assert.doesNotMatch(first,/\.focus\(/);assert.match(first,/await expect\(primary\)\.toBeFocused\(\)/);});
