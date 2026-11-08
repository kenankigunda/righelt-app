import test from 'node:test';
import assert from 'node:assert/strict';
import {humanMoveForUndo,assertUndoReceipt,undoBeforeHumanMove} from '../history-undo.mjs';
import {commandFingerprint} from '../../../packages/shared-types/src/sync-protocol.ts';

const state={turnIndex:1,pieces:[{id:'human'}]};
const action={type:'move',from:{row:1,col:1},to:{row:2,col:1}};
const human={moveId:'human-1',action,selectionSnapshot:state};
const computer={moveId:'computer-1',action:{type:'pass'},computerProof:{modelId:'baseline'}};
test('undo selects the unique new human decision, excluding prior, undone and computer entries',()=>{
 const initial={moves:[{moveId:'old'}],board:{state}};
 const accepted={moves:[{moveId:'old'},{moveId:'undone',undone:true},human,computer]};
 assert.equal(humanMoveForUndo(initial,accepted,action),human);
});
for(const mutation of ['missing','ambiguous','wrongAction','wrongSnapshot'])test(`human decision selection rejects ${mutation}`,()=>{
 const moves=mutation==='missing'?[computer]:mutation==='ambiguous'?[human,{...human,moveId:'human-2'},computer]:[{...human,...(mutation==='wrongAction'?{action:{type:'pass'}}:{selectionSnapshot:{turnIndex:2}})},computer];
 assert.throws(()=>humanMoveForUndo({moves:[],board:{state}},{moves},action));
});
async function receipt(shared=true){
 const envelope=shared?{protocolVersion:2,gameId:'game-1',identityId:'human-account',kind:'shared',clientCommandId:'v2:undo-1',expectedState:{turnIndex:3},expectedGameplayRevision:2,payload:{operation:'revert-request',values:{targetMoveId:'human-1'}}}:{identityId:'human-account',targetMoveId:'human-1'};
 if(shared)envelope.fingerprint=await commandFingerprint(envelope);
 const body={ok:true,autoApproved:true,accepted:true,protocolVersion:2,gameId:'game-1',eventSeq:10,gameplayRevision:2,clientCommandId:envelope.clientCommandId,commandOutcomes:[{gameId:'game-1',identityId:'human-account',clientCommandId:'v2:undo-1',fingerprint:envelope.fingerprint,outcome:'accepted',reason:null,eventSeq:10,gameplayRevision:2}],game:{id:'game-1',lastRestoration:{decisionId:'human-1'},board:{state},moves:[{...human,undone:true},{...computer,undone:true}]}};
 if(shared){delete body.accepted;delete body.clientCommandId;}
 return {envelope,body,expected:{gameId:'game-1',moveId:'human-1',identityId:'human-account',initialState:state,beforeState:{turnIndex:3},beforeRevision:2}};
}
for(const shared of [false,true])test(`accepted ${shared?'shared receipt':'legacy approval'} restores the exact human decision state`,async()=>{
 const {body,envelope,expected}=await receipt(shared);await assertUndoReceipt(body,envelope,expected);
});
for(const mutation of ['wrongTarget','rejected','missingOwnReceipt','wrongGame','wrongRestoration','wrongState','activeComputerMove','wrongFingerprint','missingFingerprint','wrongIdentity','missingIdentity','wrongRequestIdentity','missingRequestFingerprint','wrongRequestFingerprint','wrongRequestGame','malformedRequestId','wrongActionContract','unverifiedDependency','futureExpectedRevision','payloadAction'])test(`undo receipt rejects ${mutation}`,async()=>{
 const {body,envelope,expected}=await receipt();
 if(mutation==='wrongTarget')envelope.payload.values.targetMoveId='computer-1';
 if(mutation==='rejected')body.commandOutcomes[0].outcome='rejected';
 if(mutation==='missingOwnReceipt')body.commandOutcomes[0].clientCommandId='another-undo';
 if(mutation==='wrongGame')body.game.id='another-game';
 if(mutation==='wrongRestoration')body.game.lastRestoration.decisionId='computer-1';
 if(mutation==='wrongState')body.game.board.state={turnIndex:9};
 if(mutation==='activeComputerMove')body.game.moves[1].undone=false;
 if(mutation==='wrongFingerprint')body.commandOutcomes[0].fingerprint='f'.repeat(64);
 if(mutation==='missingFingerprint')delete body.commandOutcomes[0].fingerprint;
 if(mutation==='wrongIdentity')body.commandOutcomes[0].identityId='another-account';
 if(mutation==='missingIdentity')delete body.commandOutcomes[0].identityId;
 if(mutation==='wrongRequestIdentity')envelope.identityId='another-account';
 if(mutation==='missingRequestFingerprint')delete envelope.fingerprint;
 if(mutation==='wrongRequestFingerprint')envelope.fingerprint='f'.repeat(64);
 if(mutation==='wrongRequestGame')envelope.gameId='another-game';
 if(mutation==='malformedRequestId')envelope.clientCommandId='not-a-v2-command';
 if(mutation==='wrongActionContract')envelope.actionContractVersion=999;
 if(mutation==='unverifiedDependency')envelope.predecessor={clientCommandId:'v2:unverified',fingerprint:'a'.repeat(64)};
 if(mutation==='futureExpectedRevision')envelope.expectedGameplayRevision=expected.beforeRevision+1;
 if(mutation==='payloadAction')envelope.payload.action={type:'pass'};
 if(['wrongActionContract','unverifiedDependency','futureExpectedRevision','payloadAction'].includes(mutation)){
  envelope.fingerprint=await commandFingerprint(envelope);
  // Keep the hypothetical accepted reply internally consistent. The unsafe
  // intent must fail its admission guard, not an unrelated receipt mismatch.
  body.commandOutcomes[0].fingerprint=envelope.fingerprint;
  if(mutation==='futureExpectedRevision'){
   body.gameplayRevision=envelope.expectedGameplayRevision;
   body.commandOutcomes[0].gameplayRevision=envelope.expectedGameplayRevision;
   body.game.gameplayRevision=envelope.expectedGameplayRevision;
  }
 }
 await assert.rejects(()=>assertUndoReceipt(body,envelope,expected));
});


test('undo requires its explicit supported source label before any browser activity',async()=>{
 for(const undoLabel of [undefined,'','Undo anything'])await assert.rejects(()=>undoBeforeHumanMove(null,{undoLabel}),/explicit supported source-selected undo label/);
});

// Compile the actual helper through its selection boundary. Native locator
// leaves are controlled; operation/receipt assertions remain in the real suffix.
async function selectedHistoryPrefix(){
 const {readFile}=await import('node:fs/promises');
 const source=await readFile(process.env.RIGHELT_HISTORY_HIT_RED_SOURCE||new URL('../history-undo.mjs',import.meta.url),'utf8');
 const start=source.indexOf('export async function undoBeforeHumanMove('),end=source.indexOf('\n const control=row.locator(',start);
 assert(start>=0&&end>start,'Actual helper selection boundary required');
 const prefix=source.slice(start,end).replace(/^export /,'')+'\n return row;\n}';
 return ({expectedSelector,rowAvailable=true,targetAvailable=true,expectedMoveId='human-1'})=>{
  const clicks=[],panels=[],rows=[];const row={count:rowAvailable?1:0,locator(selector){return {async click(){clicks.push(selector);assert.equal(selector,expectedSelector,'Selected native History hit must be clicked');assert(targetAvailable,'Selected direct History hit must exist');}};}};
  const page={locator(selector){rows.push(selector);assert.equal(selector,`[data-testid="history-move-item"][data-move-id=${JSON.stringify(expectedMoveId)}]`,'The same exact human decision row must own selection');return row;}};
  const expect=locator=>({async toHaveCount(count){assert.equal(locator.count,count,'Exactly one selected human decision row required');}});
  const select=Function('assert','expect','selectGamePanel','return ('+prefix+');')(assert,expect,async(p,panel)=>{assert.equal(p,page);panels.push(panel);});
  return {page,select,clicks,panels,rows};
 };
}
const selection={gameId:'game-1',moveId:'human-1',identityId:'human-account',undoLabel:'Undo before this move'};
test('source-selected native History hit reaches only the exact human decision row',async()=>{
 const make=await selectedHistoryPrefix(),f=make({expectedSelector:':scope > .history-move-hit'});
 await f.select(f.page,{...selection,historyHitTargetContract:'move-button-v1'});
 assert.deepEqual(f.panels,['history']);assert.equal(f.rows.length,1);assert.deepEqual(f.clicks,[':scope > .history-move-hit']);
});
test('explicit legacy History contract preserves the original single visual-info click',async()=>{
 const make=await selectedHistoryPrefix(),f=make({expectedSelector:'.history-item-info'});
 await f.select(f.page,{...selection,historyHitTargetContract:'legacy-info-v1'});
 assert.deepEqual(f.clicks,['.history-item-info']);assert.equal(f.rows.length,1);
});
test('missing or unknown forwarded History contract fails before Page activity',async()=>{
 for(const historyHitTargetContract of [undefined,null,'legacy','future-v2'])await assert.rejects(()=>undoBeforeHumanMove(null,{...selection,historyHitTargetContract}),/explicit supported source-selected History hit target contract/);
});
test('new History target failure never falls back or selects another decision row',async()=>{
 const make=await selectedHistoryPrefix(),missing=make({expectedSelector:':scope > .history-move-hit',targetAvailable:false});
 await assert.rejects(()=>missing.select(missing.page,{...selection,historyHitTargetContract:'move-button-v1'}),/Selected direct History hit must exist/);assert.deepEqual(missing.clicks,[':scope > .history-move-hit']);
 const absent=make({expectedSelector:':scope > .history-move-hit',rowAvailable:false});
 await assert.rejects(()=>absent.select(absent.page,{...selection,historyHitTargetContract:'move-button-v1'}),/Exactly one selected human decision row/);assert.deepEqual(absent.clicks,[]);
 const wrong=make({expectedSelector:':scope > .history-move-hit',expectedMoveId:'another-decision'});
 await assert.rejects(()=>wrong.select(wrong.page,{...selection,historyHitTargetContract:'move-button-v1'}),/same exact human decision row/);assert.deepEqual(wrong.clicks,[]);
 const blocked=make({expectedSelector:'a different native target'});
 await assert.rejects(()=>blocked.select(blocked.page,{...selection,historyHitTargetContract:'move-button-v1'}),/Selected native History hit/);assert.deepEqual(blocked.clicks,[':scope > .history-move-hit']);
});
