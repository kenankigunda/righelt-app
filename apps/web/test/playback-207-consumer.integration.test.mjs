import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createBoardContextStore} from '../shell/board-context.js';
import {historyBoardMessage,selectedHistoryPresentation} from '../shell/history-narration.js';
import {recordedActorSide} from '../shell/recorded-narration.js';
import {playerDisplayName,humanControlledSides} from '../shell/perspective-labels.js';
import {withPushSequenceMessage} from '../shell/push-sequence-replay.js';
import {captureDisplayedReplay} from '../shell/displayed-replay.js';
import {COMPUTER_PROFILES} from '../generated/packages/shared-types/src/computer-play.js';
import {renderBoardMessageHtml} from '../board/message-presentation.js';
import {isMappedBoardPromptHtml} from '../board/prompt-models.js';
import {getGameResult,renderResultText,RESULT_HEADING_CONTRACT} from '../shell/game-result.js';
import {renderResultMark} from '../shell/result-presentation.js';
import {icon} from '../shell/ui.js';
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const extract=(begin,end)=>{const start=source.indexOf(begin),finish=source.indexOf(end,start);assert(start>=0&&finish>start);return source.slice(start,finish);};
const callback=(begin,end)=>extract(begin,end).trim().replace(/^\w+:\s*/,'').replace(/,\s*$/,'');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('actual automatic callbacks and recorded contexts keep canonical raw actors across ownership and manual control',()=>{
 for(const perspective of ['owner','manual-computer','observer']){
  const identityId=perspective==='observer'?'viewer':'human',manual=perspective==='manual-computer';
  const record={moveId:'accepted',index:16,displayMoveNumber:17,turnIndex:0,actorSide:'P2',computerProof:{profile:'babs'},action:{type:'rush',from:{row:1,col:2},to:{row:2,col:2}}};
  const game={id:'g',gameplayRevision:17,myRoles:perspective==='observer'?[]:manual?['Player 1','Player 2']:['Player 1'],myRole:manual?'Both Players':perspective==='observer'?'Viewer':'Player 1',
   player1:{identityId:'human',profile:{displayName:'Riley'}},player2:{identityId:manual?'human':'computer',computerProfile:'tau',profile:{displayName:'Relative label is not identity'}},
   computer:{manual,seats:{p1:null,p2:'tau'}},canControlComputer:manual,moves:[record],confirmedPlayback:{playing:true},board:{state:{sideToMove:'P1'}}};
  const before=JSON.stringify(game),store=createBoardContextStore();
  const context={game,selectedHistoryPresentation,historyBoardMessage,recordedActorSide,playerDisplayName,COMPUTER_PROFILES,withPushSequenceMessage,captureDisplayedReplay,boardContexts:store,
   notificationStack:{prefer(){}},queueBoardContextRefresh(){},boardContextScope:()=> 'scope',activeDisplayedReplay:null,getBoardGame:value=>value,
   transport:{getGameViewModel:()=>game,getIdentityId:()=>identityId},replayController:null,replayRequests:{snapshot:()=>null},computerSession:{snapshot:()=>({phase:'computing',profile:'tau'})},
   confirmedPlayback:{snapshot:()=>({current:{move:record,frame:{recordedMove:record,moveNumber:17}}})},forcedFollowWorking:()=>false,viewingScope:()=> 'scope',
   document:{hidden:false,getElementById:()=>({parentElement:{querySelector:()=>null}})},updateComputerBoardLoading(){},boardTurnCaption:()=>({text:'Live'})};
  context.acknowledgedBoardMessage=runInNewContext(extract('const acknowledgedBoardMessage=','const receiveBoardContext=')+'acknowledgedBoardMessage',context);
  const caption=runInNewContext('('+callback('        getTurnIndicator: state => {','        getBoardMessage:')+')',context)({});
  assert.deepEqual({...caption},{text:'Move 17',side:'P2'});
  const message=runInNewContext('('+callback('        getBoardMessage: selection => {','        onBoardMessageAction:')+')',context)({});
  assert.equal(message.text,'Babs is making their move');assert(isMappedBoardPromptHtml(renderBoardMessageHtml(message)));
  const recorded=store.channel('acknowledged');assert.equal(recorded.message.text,'Babs rushed from (1, 2) to (2, 2)');assert.equal(recorded.replay,null);
  assert.deepEqual(recorded.message.coordinates,[{row:1,col:2},{row:2,col:2}]);
  assert.deepEqual(humanControlledSides(game,{identityId}),perspective==='observer'?[]:['P1'],'manual computer control does not transfer human ownership');
  const human={...record,moveId:'human-record',actorSide:'P1',computerProof:undefined};
  context.acknowledgedBoardMessage(game,{phase:'idle'},{identityId,presentationMove:human});
  assert.equal(store.channel('acknowledged').message.text,'Riley rushed from (1, 2) to (2, 2)','recorded human references stay canonical for owners and observers');
  assert.equal(JSON.stringify(game),before,'recorded presentation cannot mutate acknowledged authority or History');
 }
});

test('actual result renderer consumes structured v3 ownership instead of rendered or optimistic names',()=>{
 assert.equal(RESULT_HEADING_CONTRACT,'named-perspective-v3');
 const base={id:'g',player1:{identityId:'human',profile:{displayName:'Riley'}},player2:{identityId:'other',profile:{displayName:'Riley'}},board:{state:{outcome:{status:'p1_win',reason:'p2_commander_destroyed'}}}};
 const computer={...base,player2:{identityId:'human',computerProfile:'babs'},computer:{manual:true,seats:{p1:null,p2:'babs'}},board:{state:{outcome:{status:'p2_win',reason:'p1_commander_destroyed'}}}};
 const self={...base,selfPlayMode:true,selfPlayStartSide:'p1',player2:{identityId:'human',profile:{displayName:'Riley'}},board:{state:{outcome:{status:'p2_win',reason:'p1_commander_destroyed'}}}};
 const cases=[{game:base,id:'human',title:'You won',winner:'p1',tone:'victory'},{game:base,id:'viewer',title:'Riley won',winner:'p1',tone:'neutral'},
  {game:computer,id:'human',title:'Babs won',winner:'p2',tone:'defeat'},{game:self,id:'human',title:'You won as Blue',winner:'p2',tone:'victory'},{game:self,id:'viewer',title:'Riley won as Blue',winner:'p2',tone:'neutral'}];
 for(const {game,id,title,winner,tone} of cases){
  const before=JSON.stringify(game),context={getGameResult,renderResultText,renderResultMark,playerDisplayName,escapeHtml,formatDisplayGameId:value=>value,icon,transport:{getAuthoritativeGame:()=>game,getIdentityId:()=>id}};
  const render=runInNewContext(extract('const renderResult =','const renderGame =')+'renderResult',context);
  const html=render({id:'g',player1:{profile:{displayName:'Unconfirmed name'}},board:{state:{outcome:{status:'draw'}}}}),result=getGameResult(game,id);
  assert.equal(result.title,title);assert.equal(result.tone,tone);assert.equal(result.titleParts.find(part=>part.side)?.side,winner);
  assert(html.includes(`<h1 tabindex="-1">${renderResultText(result,'title')}</h1>`),'actual result heading retains structured owner markup');
  assert(html.includes(`<p>${renderResultText(result,'reason')}</p>`),'actual reason retains its independently owned commander');
  assert(html.includes(`class="player-tone-${winner}"`));assert.doesNotMatch(html,/Unconfirmed name/);assert.equal(JSON.stringify(game),before);
 }
});
