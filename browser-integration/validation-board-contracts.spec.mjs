import {test,expect} from '@playwright/test';
import assert from 'node:assert/strict';
import {assertRematchControlTargets} from '../scripts/validation/browser-navigation.mjs';
import {undoBeforeHumanMove} from '../scripts/validation/history-undo.mjs';
import {commandFingerprint} from '../packages/shared-types/src/sync-protocol.ts';

const choices=[['babs','Babs'],['tau','Tau'],['horus','Horus'],['friend','Friend'],['self','Play both sides']];
const chooser=({legacy=false,sideSize=18,cardSize=50}={})=>`<style>
 input[type=radio]{width:${sideSize}px;height:${sideSize}px;min-width:0;min-height:0}
 .opponents label{position:relative;display:inline-block;width:${cardSize}px;height:${cardSize}px}
 .opponents input{position:absolute;top:0;right:0;width:14px;height:14px}
 </style><dialog open aria-label="Play again"><fieldset><legend>Your side</legend>
 <label><input type="radio" name="rematch-side" value="p1" checked>${legacy?'Player 1 · Red':'Red'}</label>
 <label><input type="radio" name="rematch-side" value="p2">${legacy?'Player 2 · Blue':'Blue'}</label></fieldset>
 ${legacy?'<label>Opponent<select><option value="friend">Friend</option></select></label>':`<fieldset class="opponents"><legend>Opponent</legend>${choices.map(([value,label])=>`<label><input type="radio" name="rematch-opponent" value="${value}" ${value==='friend'?'checked':''}>${label}</label>`).join('')}</fieldset>`}</dialog>`;

for(const legacy of [true,false])test(`rematch targets keep side geometry and ${legacy?'legacy dropdown':'five native card selections'}`,async({page})=>{
 await page.setContent(chooser({legacy}));
 await assertRematchControlTargets(page.getByRole('dialog'),{contract:legacy?'legacy':'colors-v1',opponent:'friend'});
 if(!legacy){
  await expect(page.getByRole('radio',{name:'Friend',exact:true})).toBeChecked();
  expect((await page.getByRole('radio',{name:'Babs',exact:true}).boundingBox()).width).toBe(14);
 }
});
for(const mutation of ['small-side','small-card','blocked-native-choice'])test(`rematch target proof rejects ${mutation} without changing its contract`,async({page})=>{
 await page.setContent(chooser({sideSize:mutation==='small-side'?14:18,cardSize:mutation==='small-card'?40:50}));
 if(mutation==='blocked-native-choice')await page.locator('.opponents label').first().evaluate(label=>label.addEventListener('click',event=>event.preventDefault()));
 await assert.rejects(()=>assertRematchControlTargets(page.getByRole('dialog'),{contract:'colors-v1',opponent:'friend',assertionOptions:{timeout:100}}));
});

async function mountUndoFixture(page,{transport='shared-http',mutate,undoLabel='Undo before this move',actionContractVersion=transport==='legacy'?null:2}={}){
 const shared=transport!=='legacy';
 const undoIcon=undoLabel==='Undo before this move'?'<svg aria-hidden="true" width="16" height="16"><path d="M12 4L4 8l8 4"/></svg>':'';
 const state={turnIndex:1,pieces:[{id:'human'}]},requests=[],reads=[];
 const envelope=shared?{protocolVersion:2,...(actionContractVersion===null?{}:{actionContractVersion}),gameId:'game-1',identityId:'human-account',kind:'shared',clientCommandId:'v2:undo-1',expectedState:{turnIndex:3},expectedGameplayRevision:2,payload:{operation:'revert-request',values:{targetMoveId:'human-1'}}}:{identityId:'human-account',targetMoveId:'human-1'};
 if(mutate)mutate(envelope);
 if(shared)envelope.fingerprint=await commandFingerprint(envelope);
 const acceptedRevision=Math.max(2,envelope.expectedGameplayRevision??2);
 const body={ok:true,autoApproved:true,accepted:true,protocolVersion:2,gameId:'game-1',eventSeq:10,gameplayRevision:acceptedRevision,clientCommandId:envelope.clientCommandId,commandOutcomes:[{gameId:'game-1',identityId:'human-account',clientCommandId:'v2:undo-1',fingerprint:envelope.fingerprint,outcome:'accepted',reason:null,eventSeq:10,gameplayRevision:acceptedRevision}],game:{id:'game-1',gameplayRevision:acceptedRevision,lastRestoration:{decisionId:'human-1'},board:{state},moves:[{moveId:'human-1',undone:true},{moveId:'computer-1',undone:true}]}};
 const reconcileBody={...body};delete reconcileBody.accepted;delete reconcileBody.clientCommandId;
 await page.unroute('**/undo-fixture');await page.unroute('**/api/shell/games/game-1/*');
 await page.route('**/undo-fixture',route=>route.fulfill({contentType:'text/html',body:`<div id="app" data-shell-layout-mode="wide">${['computer-1','human-1'].map(id=>`<div data-testid="history-move-item" data-move-id="${id}"><button class="history-item-info">${id}</button><button hidden data-action="revert-to-move" data-game-id="game-1" data-move-id="${id}">${undoIcon}${undoLabel}</button></div>`).join('')}</div>`}));
 await page.route('**/api/shell/games/game-1/*',async route=>{
  const receiptRead=new URL(route.request().url()).pathname.endsWith('/reconcile');
  if(receiptRead)reads.push(route.request().postDataJSON());else requests.push(route.request().postDataJSON());
  // This fixture simulates HTTP cancellation and a stored receipt. It does not
  // simulate a real WebSocket or replace the separately required real-stack proof.
  // Unsafe-intent cases offer a matching hypothetical accepted reply on purpose:
  // their admission guard must reject before inspecting it, not reject its shape.
  const capturedOne=requests.length===1&&JSON.stringify(requests[0])===JSON.stringify(envelope);
  if(!capturedOne){await route.fulfill({status:409,json:{ok:false,error:'fixture_original_mutation_not_observed'}});return;}
  if(receiptRead){await route.fulfill({json:reconcileBody});return;}
  if(transport==='shared-aborted-http')await route.abort();else await route.fulfill({json:body});
 });
 await page.goto('/undo-fixture');
 await page.evaluate(({shared,envelope})=>{
  window.selectedRows=[];
  for(const row of document.querySelectorAll('[data-testid="history-move-item"]')){
   row.querySelector('.history-item-info').onclick=()=>{window.selectedRows.push(row.dataset.moveId);row.querySelector('[data-action]').hidden=false;};
   row.querySelector('[data-action]').onclick=()=>fetch(`/api/shell/games/game-1/${shared?'shared':'revert-request'}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)}).catch(()=>{});
  }
 },{shared,envelope});
 return {shared,state,requests,reads,envelope,options:{undoLabel,actionContractVersion,gameId:'game-1',moveId:'human-1',identityId:'human-account',initialState:state,beforeState:{turnIndex:3},beforeRevision:2}};
}

for(const undoLabel of ['Undo back to this move','Undo before this move'])for(const transport of ['legacy','shared-http','shared-aborted-http'])for(const actionContractVersion of transport==='legacy'?[null]:[null,2,3])test(`ordinary undo uses the immutable human row and ${transport} version ${actionContractVersion} with ${undoLabel}`,async({page})=>{
 const fixture=await mountUndoFixture(page,{transport,undoLabel,actionContractVersion});
 await undoBeforeHumanMove(page,fixture.options);
 expect(fixture.requests).toEqual([fixture.envelope]);expect(await page.evaluate(()=>window.selectedRows)).toEqual(['human-1']);
 expect(fixture.reads).toEqual(fixture.shared?[{protocolVersion:2,identityId:fixture.envelope.identityId,knownSnapshotEventSeq:0,commands:[fixture.envelope]}]:[]);
 await expect(page.locator('[data-move-id="computer-1"] [data-action]')).toBeHidden();
});

test('unsafe undo intents with genuine fingerprints fail before any receipt lookup',async({page})=>{
 const mutations=[
  [envelope=>{envelope.actionContractVersion=999;},/action contract/],
  [envelope=>{envelope.actionContractVersion=3;},/action contract/],
  [envelope=>{delete envelope.actionContractVersion;},/action contract/],
  [envelope=>{envelope.predecessor={clientCommandId:'v2:unverified',fingerprint:'a'.repeat(64)};},/unverified dependency/],
  [envelope=>{envelope.expectedGameplayRevision=3;},/observed authoritative revision/],
  [envelope=>{envelope.payload.action={type:'pass'};},/gameplay action/],
 ];
 for(const [mutate,message]of mutations){
  const fixture=await mountUndoFixture(page,{mutate});
  expect(fixture.envelope.fingerprint).toBe(await commandFingerprint(fixture.envelope));
  await assert.rejects(()=>undoBeforeHumanMove(page,fixture.options),message);
  await expect.poll(()=>fixture.requests.length).toBe(1);
  expect(fixture.reads).toEqual([]);
 }
});
