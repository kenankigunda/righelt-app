import test from 'node:test';
import assert from 'node:assert/strict';
import {renderHomeCardIdentity,renderHomeCardTurn} from '../shell/home-card-identity.js';
import {renderPlayersPanel} from '../shell/players-panel.js';
import {participantButton,createInlineProfiles} from '../shell/public-profile.js';
import {selectedHistoryPresentation} from '../shell/history-narration.js';
import {recordedReplayLabel,historyActorLabel,playerDisplayName,viewerAliasQualifiers} from '../shell/perspective-labels.js';
import {analysisPerspectiveCopy,renderDecisionDebug} from '../shell/computer-view.js';
import {confirmedPlaybackMessage} from '../shell/playback-presentation.js';
import {renderResultPanel} from '../shell/result-panel.js';

const game=(role='Player 1')=>({id:'g',myRole:role,myRoles:[role],player1:{identityId:'red',profile:{displayName:'Maya',username:'maya'}},player2:{identityId:'blue',profile:{displayName:'Ada',username:'ada'}}});
const move=(side='P1')=>({moveId:'saved',index:7,displayMoveNumber:8,turnIndex:2,actorSide:side,action:{type:'move',from:{row:3,col:6},to:{row:4,col:6}},selectionSnapshot:{sideToMove:side,pieces:[]},snapshot:{pieces:[]}});
const escape=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

test('Home uses owning viewer wording with canonical opponents and immutable saved human ownership',()=>{
 for(const [role,id,side,opponent] of [['Player 1','red','P1','Ada'],['Player 2','blue','P2','Maya']]){
  const value=game(role),before=structuredClone(value),html=renderHomeCardIdentity(value,{identityId:id});
  assert.match(html,/<bdi>You<\/bdi>/);assert.ok(html.includes(`<bdi>${opponent}</bdi>`));
  assert.equal(renderHomeCardTurn(value,{sideToMove:side},{identityId:id}),'Your turn to play');
  assert.doesNotMatch(renderHomeCardTurn(value,{sideToMove:side==='P1'?'P2':'P1'},{identityId:id}),/Your/);
  for(const options of [{identityId:'changed-account'},{}])assert.doesNotMatch(renderHomeCardIdentity(value,options),/<bdi>You<\/bdi>/);
  assert.deepEqual(value,before);
 }
 const controlled={...game('Both Players'),computer:{manual:true,seats:{p2:'horus'}},canControlComputer:true,player2:{identityId:'red'}};
 assert.match(renderHomeCardIdentity(controlled,{identityId:'red'}),/<bdi>You<\/bdi>/);
 assert.match(renderHomeCardTurn(controlled,{sideToMove:'P2'},{identityId:'red'}),/<bdi>Horus<\/bdi>/);
 const self={...game('Both Players'),selfPlayMode:true,player2:{identityId:'red'}};
 assert.match(renderHomeCardIdentity(self,{identityId:'red'}),/You play both sides/);
 assert.doesNotMatch(renderHomeCardIdentity(self,{}),/You play both sides/);
 for(const side of ['P1','P2'])assert.equal(renderHomeCardTurn(self,{sideToMove:side},{identityId:'red'}),'Your turn to play');
 const anonymous={...game(),player1:{identityId:'red'},player2:{identityId:'blue'}};
 assert.match(renderHomeCardIdentity(anonymous,{identityId:'red'}),/<bdi>Guest 2<\/bdi>/);
 assert.equal(playerDisplayName(anonymous,'P1'),'Guest 1');
 assert.doesNotMatch(renderHomeCardIdentity({...anonymous,myRole:'Viewer',myRoles:['Viewer']},{identityId:'red'}),/<bdi>You<\/bdi>/);
 for(const displayName of ['Red','Blue','Guest','You']){
  const named={...game('Viewer'),player1:{identityId:'red',profile:{displayName}}};
  assert.equal(playerDisplayName(named,'P1'),displayName);
  assert.notEqual(renderHomeCardTurn(named,{sideToMove:'P1'},{identityId:'red'}),'Your turn to play');
 }
});

test('Players keeps canonical accessible identity and real profile actions beneath the You label',async()=>{
 const value=game(),before=structuredClone(value),html=renderPlayersPanel(value,{identityId:'red'});
 assert.match(html,/<bdi>You<\/bdi>/);assert.match(html,/aria-label="Maya, you, Red, Disconnected"/);
 assert.match(html,/data-profile-name="Maya"/);assert.match(html,/data-action="public-profile" data-username="maya"/);
 const slot={innerHTML:'',getBoundingClientRect:()=>({height:0})};
 const button={dataset:{profileKey:'seat:P1',profileName:'Maya <&>',action:'public-profile',username:'maya'},parentElement:{querySelector:()=>slot},setAttribute(name,value){this[name]=value;}};
 const requests=[];
 const profiles=createInlineProfiles({document:{querySelectorAll:()=>[button]},fetcher:async url=>{requests.push(url);return{ok:true,json:async()=>({joinedMonth:'2026-01'})};}});
 await profiles.open('maya',button);
 assert.equal(button['aria-expanded'],'true');assert.match(slot.innerHTML,/<bdi>Maya &lt;&amp;&gt;<\/bdi> · Joined January 2026/);
 assert.deepEqual(requests,['/api/profiles/maya']);profiles.close();assert.equal(slot.innerHTML,'');
 assert.match(participantButton(value.player1,{displayName:'You',profileName:'Maya'}),/data-username="maya"/);
 const self={...game('Both Players'),selfPlayMode:true,player2:{identityId:'red'}};
 const selfHtml=renderPlayersPanel(self,{identityId:'red'});assert.match(selfHtml,/<bdi>You · Red<\/bdi>/);assert.match(selfHtml,/<bdi>You · Blue<\/bdi>/);
 assert.deepEqual(value,before);
});

test('recorded History and replay use pinned actors with second person only for saved human seats',()=>{
 const value={...game(),inHistoryMode:true,inspectedDecision:move(),currentSnapshot:{sideToMove:'P2'}};
 const before=structuredClone(value),own={identityId:'red'};
 assert.equal(selectedHistoryPresentation(value,own).message.text,'You moved your commander from (3, 6) to (4, 6)');
 assert.equal(recordedReplayLabel(value,move(),own),'Playing your recorded move');
 const playback=confirmedPlaybackMessage({...value,confirmedPlayback:{playing:true}}, {},{identityId:'red',step:{frame:{recordedMove:move()}}});
 assert.equal(playback.text,'Watch replay');assert.equal(playback.context.message.rows[1].text,'Playing your recorded move');
 assert.equal(playback.context.message.rows[0].text,'You moved your commander from (3, 6) to (4, 6)');
 assert.equal(selectedHistoryPresentation(value,{identityId:'spectator'}).message.text,'Maya moved commander from (3, 6) to (4, 6)');
 assert.equal(selectedHistoryPresentation(value,{identityId:'changed-account'}).message.actorName,'Maya');
 const self={...value,myRole:'Both Players',myRoles:['Both Players'],selfPlayMode:true,player2:{identityId:'red'},inspectedDecision:move('P2')};
 assert.equal(selectedHistoryPresentation(self,own).message.text,'You (Blue) moved your commander from (3, 6) to (4, 6)');
 assert.equal(recordedReplayLabel(self,move('P1'),own),'Playing your recorded Red move');
 const computer={...value,computer:{manual:true,seats:{p2:'horus'}},canControlComputer:true,player2:{identityId:'red',computerProfile:'horus'}};
 assert.equal(historyActorLabel(computer,{...move('P2'),computerProof:{profile:'babs'}},own),'Babs');
 assert.equal(recordedReplayLabel(computer,{...move('P2'),computerProof:{profile:'babs'}},own),'Playing Babs’s recorded move');
 assert.equal(historyActorLabel(computer,move('P2'),own),'Horus');
 assert.equal(historyActorLabel(value,{...move(),computerProof:{profile:'unknown'}},own),'Maya');
 assert.deepEqual(value,before);
});

test('analysis colors only its fixed Red perspective phrase and keeps your move neutral',()=>{
 const cases=[
  [game(),'red','your perspective','your move'],
  [game('Player 2'),'blue','your opponent’s perspective (Maya)','your move'],
  [{...game('Both Players'),selfPlayMode:true,player2:{identityId:'red'}},'red','your Red side’s perspective','your move'],
  [game('Viewer'),'red','Maya’s perspective','a human’s move'],
  [game(),'new-account','Maya’s perspective','a human’s move'],
 ];
 for(const [value,identityId,phrase,moveCopy] of cases){
  const before=structuredClone(value),html=analysisPerspectiveCopy(value,{identityId});
  assert.equal(html,`Values are from <span class="player-tone-p1"><span class="sr-only">Red: </span><bdi>${phrase}</bdi></span>. This does not grade ${moveCopy}.`);
  assert.doesNotMatch(html,/<bdi>[^<]*your move/);
  const state={drafts:new Map(),notes:[],attempts:new Map(),items:[],open:new Set()};
  assert.ok(renderDecisionDebug({game:value,status:{},state,signedIn:true,identityId}).includes(html));
  assert.deepEqual(value,before);
 }
 const hostile={...game('Player 2'),player1:{identityId:'red',profile:{displayName:'<script>Red</script>'}}};
 assert.match(analysisPerspectiveCopy(hostile,{identityId:'blue'}),/&lt;script&gt;Red&lt;\/script&gt;/);
});

test('finished matchup uses confirmed saved ownership without changing winner or commander headings',()=>{
 for(const [id,expected] of [['red','You'],['viewer','Maya']]){
  const value={...game(),board:{state:{outcome:{status:'p2_win',reason:'p1_commander_destroyed'}}}};
  const html=renderResultPanel({id:'g'},{transport:{getAuthoritativeGame:()=>value,getIdentityId:()=>id},escapeHtml:escape,formatDisplayGameId:String});
  assert.ok(html.includes(`<bdi dir="auto">${expected}</bdi></span> vs <span class="player-tone-p2">`));
  assert.match(html,/>Ada<\/span> won|>Ada<\/bdi>/);assert.doesNotMatch(html,/You won/);
 }
});


test('owning You alias and a different canonical You remain visibly distinct without text-based ownership',()=>{
 for(const side of ['P1','P2'])for(const username of ['real-you',undefined]){
  const role=side==='P1'?'Player 1':'Player 2',identityId=side==='P1'?'red':'blue',otherSide=side==='P1'?'P2':'P1';
  const otherKey=otherSide==='P1'?'player1':'player2';
  const value={...game(role),[otherKey]:{identityId:otherSide==='P1'?'red':'blue',profile:{displayName:'You',...(username?{username}: {})}}};
  const before=structuredClone(value),options={identityId};
  const home=renderHomeCardIdentity(value,options),players=renderPlayersPanel(value,options);
  assert.equal(playerDisplayName(value,otherSide),'You');
  const expected=username ? '@real-you' : side==='P1'?'Blue':'Red';
  assert.ok(home.includes(`<bdi>${expected}</bdi>`));assert.ok(players.includes(`<bdi>${expected}</bdi>`));
  if(username)assert.ok(players.includes(`aria-label="You, ${otherSide==='P1'?'Red':'Blue'}, @real-you, Disconnected"`));
  if(!username){const ownColor=side==='P1'?'Red':'Blue';assert.ok(home.includes(`<bdi>${ownColor}</bdi>`));assert.ok(players.includes(`<bdi>${ownColor}</bdi>`));}
  const canonical=side==='P1'?'Maya':'Ada',color=side==='P1'?'Red':'Blue';
  assert.ok(home.includes(`aria-label="${canonical}, you, ${color}"`));
  assert.ok(players.includes(`aria-label="${canonical}, you, ${color}, Disconnected"`));
  assert.doesNotMatch(home,/aria-label="You, you,/);assert.doesNotMatch(players,/aria-label="You, you,/);
  assert.match(home,/<bdi>You<\/bdi>/);assert.match(players,/<bdi>You<\/bdi>/);
  assert.deepEqual(value,before);
 }
 assert.deepEqual(viewerAliasQualifiers([{side:'P1',name:'Maya',owned:false},{side:'P2',name:'You',username:'real-you',owned:false}]),{});
 assert.deepEqual(viewerAliasQualifiers([{side:'P1',name:'You',owned:true},{side:'P2',name:'You',owned:true}]),{});
 const literal={...game('Viewer'),player2:{identityId:'blue',profile:{displayName:'You',username:'real-you'}}};
 const viewer=renderHomeCardIdentity(literal,{identityId:'red'});assert.doesNotMatch(viewer,/@real-you|You, you,/);
});
