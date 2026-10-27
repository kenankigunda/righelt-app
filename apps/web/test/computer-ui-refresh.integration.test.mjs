import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {computerActivity} from '../shell/computer-activity.js';
import {recoveryMessage,needsRecoveryAction,isBoardRecoveryPending} from '../shell/recovery-view.js';
import {SYNC_TIMING} from '../generated/packages/shared-types/src/sync-protocol.js';

const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const slice=(start,end)=>{
 const first=source.indexOf(start),last=source.indexOf(end,first);
 assert.ok(first>=0&&last>first);return source.slice(first,last);
};
// Execute the actual mounted-update functions without starting the application.
const script=new vm.Script([
 slice('const quietComputerRenewal =','const applySharedMutationGates ='),
 slice('let reconnectPresentationTimer;','const mountBoardForGame ='),
 slice('const updateComputerUi =','computerSession = createComputerSession'),
 'updateComputerUi',
].join('\n'));

test('quiet renewal mounted UI refresh clears stale loading and announcement only for the current game',()=>{
 const now=Date.now(),game={id:'quiet-ui',canControlComputer:true,computer:{ownerId:'owner',generation:3,seats:{p1:null,p2:'babs'},
  paused:false,manual:false,takeoverTurn:null,lease:{deviceId:'here',expiresAt:now+15000}},
  board:{state:{sideToMove:'P1',turnIndex:2,outcome:{status:'ongoing'}}}};
 const view={...game,pendingCommandCount:1,pendingComputerControl:true,sharedMutationsBlocked:true,recovering:true,
  syncStatus:'applying-update',recoveryStartedAt:now-1000,
  pendingComputerControlRequest:{action:'renew',deviceId:'here',generation:3,submittedAt:now-1000}};
 const activity=()=>computerActivity({game,projection:view,identityId:'owner',deviceId:'here',authenticated:true,visible:true,
  controlAcknowledged:true,renewing:true,status:{phase:'idle'},now});
 assert.equal(activity().quietRenewal,true);
 const attrs=new Map([['aria-busy','true']]),wrap={dataset:{reconnecting:'true'},setAttribute:(key,value)=>attrs.set(key,value)};
 const announcement={textContent:'Updating computer play'};let viewedId=game.id,mountedId=game.id,wrapReads=0;
 const context=vm.createContext({
  getCurrentViewedGameId:()=>viewedId,computerSession:{snapshot:()=>({phase:'idle',activity:activity()})},
  transport:{getGameViewModel:()=>view,getFailedOperations:()=>[]},
  appEl:{querySelector:selector=>selector==='[data-testid="game-shell"]'?{getAttribute:()=>mountedId}:null},
  document:{querySelector:()=>{wrapReads++;return wrap;}},syncAnnouncement:announcement,
  boardRuntime:{refreshStatus(){}},updateParticipantCards(){},setActivityActor(){},activityActorSide(){return 'P1';},
  recoveryMessage,needsRecoveryAction,isBoardRecoveryPending,Date,SYNC_TIMING,LOADING_CUE_DELAY_MS:500,
  clearTimeout(){},setTimeout(){return 1;},updateMountedHeader(){},
 });
 const update=script.runInContext(context);update();
 assert.equal(wrap.dataset.reconnecting,'false');assert.equal(attrs.get('aria-busy'),'false');assert.equal(announcement.textContent,'');
 assert.equal(view.sharedMutationsBlocked,true);assert.equal(view.pendingCommandCount,1);
 const reads=wrapReads;viewedId=null;update();assert.equal(wrapReads,reads,'Home must not refresh a stale game wrap');
 viewedId=game.id;mountedId='other-mounted-game';update();assert.equal(wrapReads,reads,'route replacement must not touch another mounted game');
});
