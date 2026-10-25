import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {getGameResult,createRematchDialog,REMATCH_CHOICES_CONTRACT} from '../shell/game-result.js';
import {playerDisplayName} from '../shell/perspective-labels.js';

const finished=(winner='p1',names=['Ada','Bo'])=>({id:'result',player1:{identityId:'red',profile:{displayName:names[0]}},player2:{identityId:'blue',profile:{displayName:names[1]}},board:{state:{outcome:{status:`${winner}_win`,reason:`${winner==='p1'?'p2':'p1'}_commander_destroyed`}}}});

test('named observer results preserve captured names, commander cause and immutable state',()=>{
 for(const names of [['Ada','Bo'],['',''],['名字 <&> שלום','Guest'],['Same','Same']])for(const winner of ['p1','p2']) {
  const game=finished(winner,names),before=structuredClone(game),result=getGameResult(game,'observer');
  assert.equal(result.title,`${playerDisplayName(game,winner)} won`);
  assert.equal(result.reason,`${playerDisplayName(game,winner==='p1'?'p2':'p1')}’s commander was destroyed.`);
  assert.equal(result.winner,winner);assert.equal(result.tone,'neutral');assert.deepEqual(game,before);
 }
 const game=finished();game.player1={identityId:'owner',computerProfile:'horus'};game.player2={identityId:'owner',computerProfile:'tau'};game.computer={seats:{p1:'horus',p2:'tau'},manual:true};
 assert.equal(getGameResult(game,'owner').title,'Horus won');assert.equal(getGameResult(game,'owner').side,null);assert.equal(getGameResult(game,'owner').opponent,'horus');assert.equal(getGameResult(game,'owner').controlsBothSides,false);
});

test('manual computer control never changes human seat ownership and absent identity never matches absent seats',()=>{
 const game=finished();game.player1={identityId:'blue',computerProfile:'horus'};game.computer={seats:{p1:'horus',p2:null},manual:true};
 assert.equal(getGameResult(game,'blue').title,'Your opponent won');assert.equal(getGameResult(game,'blue').side,'p2');assert.equal(getGameResult(game,'blue').opponent,'horus');assert.equal(getGameResult(game,'blue').controlsBothSides,false);
 game.board.state.outcome.status='p2_win';assert.equal(getGameResult(game,'blue').title,'You won');
 const anonymous=finished();delete anonymous.player1.identityId;delete anonymous.player2.identityId;
 for(const identity of [undefined,null,'']){assert.equal(getGameResult(anonymous,identity).side,null);assert.equal(getGameResult(anonymous,identity).title,'Ada won');}
});

test('true human both-side results celebrate either actual winner and swap only selected starting side',()=>{
 for(const start of ['p1','p2'])for(const winner of ['p1','p2']) {
  const game={...finished(winner),selfPlayMode:true,selfPlayStartSide:start};game.player2.identityId='red';
  const result=getGameResult(game,'red');assert.equal(result.title,'You won');assert.equal(result.tone,'victory');assert.equal(result.winner,winner);assert.equal(result.controlsBothSides,true);assert.equal(result.side,start);assert.equal(result.rematchSide,start==='p1'?'p2':'p1');
  assert.match(result.reason,/Your (Red|Blue) commander was destroyed/);
 }
});

test('actual result HTML isolates and escapes observer names without changing plain result payload',()=>{
 const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('const renderResult ='),source.indexOf('const renderGame ='));
 const game=finished('p1',['<img src=x> שלום','Bo & Co']);
 const escapeHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
 const context={game,getGameResult,playerDisplayName,transport:{getIdentityId:()=> 'observer',getAuthoritativeGame:()=>game},escapeHtml,renderResultMark:()=>'',formatDisplayGameId:String,icon:()=>''};
 runInNewContext(`${body};globalThis.html=renderResult(game);`,context);
 assert.match(context.html,/<bdi dir="auto">&lt;img src=x&gt; שלום<\/bdi> won/);
 assert.match(context.html,/<bdi dir="auto">Bo &amp; Co<\/bdi>’s commander was destroyed/);
 assert.doesNotMatch(context.html,/<img src=x>/);assert.doesNotMatch(context.html,/Self-play|Player [12]/);
 assert.equal(getGameResult(game,'observer').title,'<img src=x> שלום won');
});

test('rematch keeps semantic selected side and opponent values with concise color labels',()=>{
 assert.equal(REMATCH_CHOICES_CONTRACT,'colors-v1');
 for(const side of ['p1','p2']) {
  let html;const element={open:false,dataset:{},addEventListener(){},querySelector:selector=>selector==='[name=rematch-opponent]:checked'?{value:'self'}:selector==='[data-rematch-start]'?{dataset:{},setAttribute(){}}:selector==='[role=status]'?{dataset:{}}:{},querySelectorAll:()=>[]};
  const dialog=createRematchDialog({createModal:()=>({element,open(markup){html=markup;element.open=true;},close(){}}),onStart(){}});
  dialog.open({opponent:'self',rematchSide:side});
  assert.match(html,/name="rematch-opponent" value="self" checked autofocus/);
  assert.match(html,new RegExp(`name="rematch-side" value="${side}" checked`));
  assert.match(html,/>Red<\/label>/);assert.match(html,/>Blue<\/label>/);assert.match(html,/Play both sides/);
  assert.doesNotMatch(html,/Player [12]|Self-play|data-rematch-friend-help|Your friend chooses/);
  assert.equal(element.dataset.actionAffiliation,side==='p1'?'red':'blue');
 }
});


test('actual result summary identifies true human both-side ownership without relabeling manual computers',()=>{
 const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
 const body=source.slice(source.indexOf('const renderResult ='),source.indexOf('const renderGame ='));
 for(const winner of ['p1','p2'])for(const names of [['',''],['Ada','Ada']]) {
  const game={...finished(winner,names),selfPlayMode:true,selfPlayStartSide:'p2'};game.player2.identityId='red';
  const context={game,getGameResult,playerDisplayName,transport:{getIdentityId:()=> 'red',getAuthoritativeGame:()=>game},escapeHtml:String,renderResultMark:()=>'',formatDisplayGameId:String,icon:()=>''};
  runInNewContext(`${body};globalThis.html=renderResult(game);`,context);
  assert.match(context.html,/<p>You play both sides<\/p>/);assert.doesNotMatch(context.html,/Guest 1.* vs |Ada.* vs /);
  assert.match(context.html,new RegExp(`data-result-tone="victory" data-winner="${winner}"`));
  const manual={...game,computer:{seats:{p1:'horus',p2:null},manual:true},player1:{identityId:'red',computerProfile:'horus'}};
  const manualContext={...context,game:manual,transport:{getIdentityId:()=> 'red',getAuthoritativeGame:()=>manual}};
  runInNewContext(`${body};globalThis.html=renderResult(game);`,manualContext);
  assert.doesNotMatch(manualContext.html,/You play both sides/);assert.match(manualContext.html,/Horus/);
 }
});
