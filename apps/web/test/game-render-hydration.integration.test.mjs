import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {icon} from '../shell/ui.js';
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const start=source.indexOf('const renderGame ='),end=source.indexOf('const renderInviteLanding =',start);
assert.ok(start>0&&end>start);
const script=new vm.Script(`${source.slice(start,end)};renderGame`);
const harness=()=>{
 const game={id:'g'},calls=[];
 const context=vm.createContext({routeHydrated:false,currentRoute:{name:'game'},activeResultGameId:null,hostInvite:null,
  transport:{getGameViewModel:()=>game,getAuthoritativeGame:()=>game,getIdentityId:()=> 'me'},
  getGameResult:()=>null,getActiveApprovalRequest:()=>null,
  renderGameContent:(...args)=>{calls.push(args);return 'legacy-or-loading';},renderGameShellFrame:()=> 'canonical-shell',
  renderResult:()=> 'result',renderHostInvite:()=> 'host',renderApprovalGate:()=> 'approval'});
 return {context,calls,render:script.runInContext(context)};
};
test('a socket snapshot before route hydration uses the same canonical shell as settled game',()=>{
 const h=harness();assert.equal(h.render('g'),'canonical-shell');assert.equal(h.calls.length,0);
 h.context.routeHydrated=true;assert.equal(h.render('g'),'canonical-shell');
});
test('missing snapshots retain the loading or upgrade path and invitation context',()=>{
 const h=harness();h.context.transport.getGameViewModel=()=>null;
 assert.equal(h.render('g','Player 2','token'),'legacy-or-loading');
 assert.deepEqual(h.calls,[['g','Player 2','token']]);
});
test('known snapshots preserve result, host and approval gates before hydration completes',()=>{
 const h=harness();h.context.activeResultGameId='g';h.context.getGameResult=()=>({title:'finished'});assert.equal(h.render('g'),'result');
 h.context.activeResultGameId=null;h.context.hostInvite={gameId:'g'};assert.equal(h.render('g'),'host');
 h.context.hostInvite=null;h.context.getActiveApprovalRequest=()=>({id:'r'});assert.equal(h.render('g'),'approval');
});

test('recovery action templates keep semantic navigation, visible labels and decorative brand icons',()=>{
 const start=source.indexOf('action: !recoveryNeedsAction',source.indexOf('const getGameAlertItems'))+'action: '.length;
 const end=source.indexOf(',\n      }),',start);
 assert.ok(start>20&&end>start);
 const render=new Function('game','dismissed','escapeHtml','icon',`const recoveryNeedsAction=true;return (${source.slice(start,end)});`);
 const html=render({id:'game<1'},false,value=>String(value).replaceAll('<','&lt;'),icon);
 assert.match(html,/data-action="reconnect-safely" data-game-id="game&lt;1"/);
 assert.match(html,/>Reload game<\/button>/);assert.doesNotMatch(html,/Reload now/);
 assert.match(html,/<a[^>]+href="#\/">[\s\S]*?Home<\/a>/);
 assert.equal((html.match(/aria-hidden="true"/g)||[]).length,2);
 assert.equal((html.match(/focusable="false"/g)||[]).length,2);
 for(const [game,label,action] of [[{storageBlocked:true},'Retry saving','retry-saving'],[{upgradeRequired:true},'Refresh','refresh-game'],[{recoveryIssue:'invalid_credentials'},'Sign in','account-open']]){
  const markup=render({id:'g',...game},false,String,icon);
  assert.match(markup,new RegExp(`data-action="${action}"`));
  assert.match(markup,new RegExp(`</svg>${label}</button>`));
 }
});
