import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createBoardLoadingMessageOwner} from '../shell/board-loading-message-owner.js';

const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const start=source.indexOf('const syncMountedGameShellPanelUi ='),end=source.indexOf('const getMountedShellPageEl =',start);
assert(start>=0&&end>start);
function fixture(){
 class Element{constructor(panel){this.dataset={mobilePanel:panel};this.attributes={};}toggleAttribute(name,on){if(on)this.attributes[name]='';else delete this.attributes[name];}setAttribute(name,value){this.attributes[name]=value;}}
 const panels=['players','board','history'].map(name=>new Element(name)),calls=[];
 let label={isConnected:true},currentPanel='board';
 const root=new Element();root.querySelectorAll=selector=>selector==='[data-mobile-panel]'?panels:[];root.querySelector=()=>null;
 const app={querySelector:()=>label};
 const owner=createBoardLoadingMessageOwner(app,{createController:next=>{assert.equal(panels[1].dataset.active,String(currentPanel==='board'));calls.push(['admit',next]);next.height='finite';return {destroy(){calls.push(['release',next]);delete next.height;}};}});
 const context={HTMLElement:Element,boardLoadingMessageOwner:owner,getMountedGameShellRoot:()=>root,getGamePanel:()=>currentPanel,getGamePanelIndex:()=>1,getShellLayoutMode:()=>'narrow',mobileNavigation:{sync(){calls.push(['navigation']);}}};
 vm.runInNewContext(source.slice(start,end)+'\nglobalThis.sync=syncMountedGameShellPanelUi;',context);
 return {owner,calls,root,context,panels,current:()=>label,replace(){label={isConnected:true};},panel:next=>{currentPanel=next;}};
}
test('actual panel commit admits loading after inert membership and before native navigation/layout consumers',()=>{
 const f=fixture();f.context.sync();assert.equal(f.current().height,'finite');assert.equal(f.calls[0][0],'admit');assert.equal(f.calls[1][0],'navigation');assert.equal(f.panels[0].attributes.inert,'');assert.equal(f.panels[1].attributes.inert,undefined);f.owner.destroy();
});
test('actual repeated and replacement commits keep one loading owner and publish the replacement synchronously',()=>{
 const f=fixture();f.context.sync();const old=f.current();f.context.sync();assert.equal(f.calls.filter(([kind])=>kind==='admit').length,1);f.replace();f.context.sync();assert.equal(old.height,undefined);assert.equal(f.current().height,'finite');assert.equal(f.calls.filter(([kind])=>kind==='admit').length,2);f.owner.destroy();
});
test('actual inactive panel membership still admits its loading slot before a later Board reveal',()=>{
 const f=fixture();f.panel('history');f.context.sync();assert.equal(f.panels[1].attributes.inert,'');assert.equal(f.current().height,'finite');f.panel('board');f.context.sync();assert.equal(f.panels[1].attributes.inert,undefined);assert.equal(f.calls.filter(([kind])=>kind==='admit').length,1);f.owner.destroy();
});
test('actual non-game commit releases the loading owner before returning without a shell',()=>{
 const f=fixture();f.context.sync();const previous=f.current();f.context.sync(null);assert.equal(previous.height,undefined);assert.equal(f.calls.filter(([kind])=>kind==='release').length,1);f.owner.destroy();
});
