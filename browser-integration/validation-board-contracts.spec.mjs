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

for(const shared of [false,true])test(`ordinary undo uses the immutable human row and ${shared?'accepted command receipt':'legacy approval'}`,async({page})=>{
 const state={turnIndex:1,pieces:[{id:'human'}]},requests=[];
 const envelope=shared?{protocolVersion:2,gameId:'game-1',identityId:'human-account',kind:'shared',clientCommandId:'v2:undo-1',expectedState:{turnIndex:3},expectedGameplayRevision:2,payload:{operation:'revert-request',values:{targetMoveId:'human-1'}}}:{identityId:'human-account',targetMoveId:'human-1'};
 if(shared)envelope.fingerprint=await commandFingerprint(envelope);
 const body={ok:true,autoApproved:true,accepted:true,protocolVersion:2,gameId:'game-1',eventSeq:10,gameplayRevision:2,clientCommandId:envelope.clientCommandId,commandOutcomes:[{gameId:'game-1',identityId:'human-account',clientCommandId:'v2:undo-1',fingerprint:envelope.fingerprint,outcome:'accepted',reason:null,eventSeq:10,gameplayRevision:2}],game:{id:'game-1',lastRestoration:{decisionId:'human-1'},board:{state},moves:[{moveId:'human-1',undone:true},{moveId:'computer-1',undone:true}]}};
 await page.route('**/undo-fixture',route=>route.fulfill({contentType:'text/html',body:`<div id="app" data-shell-layout-mode="wide">${['computer-1','human-1'].map(id=>`<div data-testid="history-move-item" data-move-id="${id}"><button class="history-item-info">${id}</button><button hidden data-action="revert-to-move" data-game-id="game-1" data-move-id="${id}">Undo before this move</button></div>`).join('')}</div>`}));
 await page.route('**/api/shell/games/game-1/*',async route=>{requests.push(route.request().postDataJSON());await route.fulfill({json:body});});
 await page.goto('/undo-fixture');
 await page.evaluate(({shared,envelope})=>{
  window.selectedRows=[];
  for(const row of document.querySelectorAll('[data-testid="history-move-item"]')){
   row.querySelector('.history-item-info').onclick=()=>{window.selectedRows.push(row.dataset.moveId);row.querySelector('[data-action]').hidden=false;};
   row.querySelector('[data-action]').onclick=()=>fetch(`/api/shell/games/game-1/${shared?'shared':'revert-request'}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(envelope)});
  }
 },{shared,envelope});
 await undoBeforeHumanMove(page,{gameId:'game-1',moveId:'human-1',identityId:'human-account',initialState:state});
 expect(requests).toEqual([envelope]);expect(await page.evaluate(()=>window.selectedRows)).toEqual(['human-1']);
 await expect(page.locator('[data-move-id="computer-1"] [data-action]')).toBeHidden();
});
