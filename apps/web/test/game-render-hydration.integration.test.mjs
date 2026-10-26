import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {icon} from '../shell/ui.js';
import {needsRecoveryAction,recoveryMessage} from '../shell/recovery-view.js';
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
 const actualActions=new Function('game','dismissed','escapeHtml','icon','recoveryNeedsAction',`return (${source.slice(start,end)});`);
 const render=(game,dismissed,escapeHtml,icons,now=15000)=>actualActions(game,dismissed,escapeHtml,icons,needsRecoveryAction(game,now));
 const html=render({id:'game<1',recovering:true,recoveryStartedAt:0},false,value=>String(value).replaceAll('<','&lt;'),icon);
 assert.match(html,/data-action="reconnect-safely" data-game-id="game&lt;1"/);
 assert.match(html,/>Reload game<\/button>/);assert.doesNotMatch(html,/Reload now/);
 assert.match(html,/<a[^>]+href="#\/">[\s\S]*?Home<\/a>/);
 assert.equal((html.match(/aria-hidden="true"/g)||[]).length,2);
 assert.equal((html.match(/focusable="false"/g)||[]).length,2);
 for(const [game,label,action] of [[{storageBlocked:true},'Retry saving','retry-saving'],[{upgradeRequired:true},'Reload game','refresh-game'],[{recoveryIssue:'invalid_credentials'},'Sign in','account-open']]){
  const markup=render({id:'g',...game},false,String,icon);
  assert.match(markup,new RegExp(`data-action="${action}"`));
  assert.match(markup,new RegExp(`</svg>${label}</button>`));
 }
});

// Execute the actual app action expression against the same exported timing
// helper used by getGameAlertItems, rather than forcing a recovery button.
test('actual recovery actions stay absent while quiet/recording and appear at the original overdue deadline',()=>{
 const start=source.indexOf('action: !recoveryNeedsAction',source.indexOf('const getGameAlertItems'))+'action: '.length;
 const end=source.indexOf(',\n      }),',start);assert.ok(start>20&&end>start);
 const actions=new Function('game','dismissed','escapeHtml','icon','recoveryNeedsAction',`return (${source.slice(start,end)});`);
 const game={id:'g',recovering:true,pendingCommandCount:1,pendingComputerSaveStartedAt:0,recoveryStartedAt:5000};
 for(const [now,message,actionable] of [[9999,'',false],[10000,'Saving the computer’s move is taking longer than usual',false],[14999,'Saving the computer’s move is taking longer than usual',false],[15000,'Still checking your move. You can retry or view details.',true]]){
  assert.equal(recoveryMessage(game,now),message);
  const html=actions(game,false,String,icon,needsRecoveryAction(game,now));
  if(actionable){assert.match(html,/data-action="reconnect-safely"/);assert.match(html,/href="#\/"/);}else assert.equal(html,'');
 }
 const immediate=[{storageBlocked:true},{upgradeRequired:true},{recoveryIssue:'session_changed'},{recoveryIssue:'invalid_credentials'},{recoveryIssue:'invalid_response'}];
 for(const issue of immediate){const value={...game,...issue};assert.ok(recoveryMessage(value,1));assert.notEqual(actions(value,false,String,icon,needsRecoveryAction(value,1)),'');}
});

test('saved-game upgrade immediately offers Reload game and Home without replacing the refresh action',()=>{
 const start=source.indexOf('action: !recoveryNeedsAction',source.indexOf('const getGameAlertItems'))+'action: '.length;
 const end=source.indexOf(',\n      }),',start);assert.ok(start>20&&end>start);
 const actions=new Function('game','dismissed','escapeHtml','icon','recoveryNeedsAction',`return (${source.slice(start,end)});`);
 const game={id:'g',upgradeRequired:true,recovering:false};
 assert.equal(needsRecoveryAction(game,0),true);
 const markup=actions(game,false,String,icon,needsRecoveryAction(game,0));
 assert.match(markup,/data-action="refresh-game">[\s\S]*?<\/svg>Reload game<\/button>/);
 assert.match(markup,/<a[^>]+href="#\/">[\s\S]*?<\/svg>Home<\/a>/);
 assert.equal((markup.match(/aria-hidden="true" focusable="false"/g)||[]).length,2);
 assert.doesNotMatch(markup,/reconnect-safely/);
 assert.match(source,/if \(action === "refresh-game"\) \{ window\.location\.reload\(\); return; \}/);
});
test('cold upgrade offers the same branded recovery choices without fabricating a board or reading a journal',()=>{
 const start=source.indexOf('const renderGameContent ='),end=source.indexOf('const renderApprovalGate =',start);assert.ok(start>0&&end>start);
 const reads=[];
 const render=new Function('transport','icon','routeHydrated','renderGameViewSkeleton',`${source.slice(start,end)};return renderGameContent;`)(
  {getGameViewModel:id=>{reads.push(['view',id]);return null;},isUpgradeRequired:id=>{reads.push(['upgrade',id]);return true;}},icon,false,()=>assert.fail('Upgrade must not return a loading skeleton'));
 const markup=render('saved-game');
 assert.deepEqual(reads,[['view','saved-game'],['upgrade','saved-game']]);
 assert.match(markup,/data-testid="sync-recovery-banner" role="status"/);
 assert.match(markup,/data-action="refresh-game">[\s\S]*?<\/svg>Reload game<\/button>/);
 assert.match(markup,/<a[^>]+href="#\/">[\s\S]*?<\/svg>Home<\/a>/);
 assert.equal((markup.match(/aria-hidden="true" focusable="false"/g)||[]).length,2);
 assert.doesNotMatch(markup,/game-board|<progress|reconnect-safely/);
});
