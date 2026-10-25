import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as slots from '../shell/panel-loading.js';
const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const extract=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
test('actual summary and history renderers use shared content flow without changing values',()=>{
 const context={...slots,escapeHtml:String,formatDisplayGameId:String,formatClientDateTime:()=> 'Oct 25, 2026, 4:17 AM',renderRoleLabel:()=> 'both players',renderSeatLabel:String,colorizePlayerReferences:String,renderTurnHistory:()=>'<li>Actual move</li>',renderAdditionalHistory:()=>'<div>Additional</div>',getGameResult:()=>null,transport:{getAuthoritativeGame:()=>({}),getIdentityId:()=> 'owner'}};
 vm.runInNewContext(`${extract('const renderGameSummaryPanel =','const renderJoinInvitePanel =')}${extract('const renderHistoryPanel =','const renderBoardPanel =')};globalThis.summary=renderGameSummaryPanel;globalThis.history=renderHistoryPanel;`,context);
 const summary=context.summary({id:'known',createdAt:'date',myRole:'Both Players',notifications:['Ready'],currentTurn:{index:0,playerSeat:'Player 1',moveIndexes:[]}});
 assert.match(summary,/Game <span class="mono">known/);assert.match(summary,/Started Oct 25/);assert.match(summary,/Latest: Ready/);
 for(const html of [summary,slots.renderSummaryLoading('Game known')]){
  assert.equal((html.match(/<p class="small"/g)||[]).length,4);assert.match(html,/section-stack/);assert.match(html,/section-followup/);
 }
 assert.match(context.history({id:'known'}),/Actual move<\/li><\/ol><div>Additional/);
});
test('unknown loading placeholders have no identities, enabled controls or authority',()=>{
 for(const html of [slots.renderSummaryLoading(),slots.renderPlayersLoading(),slots.renderHistoryLoading(),slots.renderInvitationLoading()]){
  assert.match(html,/aria-hidden="true"/);assert.doesNotMatch(html,/<(?:button|a|input)\b|data-action=|data-username=|data-profile-key=|tabindex=/);
 }
 const players=slots.renderPlayersLoading();assert.equal((players.match(/<li/g)||[]).length,3);assert.equal((players.match(/panel-loading-emblem/g)||[]).length,2);
 assert.equal((slots.renderHistoryLoading().match(/<li /g)||[]).length,1);
 for(const actions of [2,3])assert.equal((slots.renderInvitationLoading({actions}).match(/invite-choice-row/g)||[]).length,actions);
});
test('loading preserves the real empty feedback and additional-history footer flow',()=>{
 const context={...slots,escapeHtml:String,icon:()=>'',getJoinButtonKey:()=>'',getPlayAsBothButtonKey:()=>'',getCopyInviteButtonKey:()=>'',renderSectionActions:items=>`<div class="row section-actions">${items.join('')}</div>`,invitationOptions:()=>[{role:'viewer',label:'Invite someone to view'}],renderButtonStateAttributes:()=>'',renderParticipantsPanel:()=>'<ul class="participant-list"></ul>',joinFeedback:{message:()=>''},issueDiagnostics:{list:()=>[]},currentRoute:{gameId:'g'},inviteFeedback:'',inviteFallback:null,additionalHistory:{snapshot:()=>({metadata:true,available:false,loaded:false,items:[]})}};
 vm.runInNewContext(`${extract('const renderInviteFeedback =','const setInviteFeedback =')}${extract('const renderJoinInvitePanel =','const expandedViewerGames =')}${extract('const renderAdditionalHistory =','const renderHistoryPanel =')};globalThis.players=renderJoinInvitePanel;globalThis.extra=renderAdditionalHistory;`,context);
 const live=context.players({id:'g',pendingJoinRequests:[]});
 assert.match(live,/section-actions[\s\S]*<div class="invite-feedback" role="status" aria-live="polite"[^>]*><\/div>/);
 assert.match(slots.renderPlayersLoading(),/panel-loading-actions[\s\S]*<div class="invite-feedback"><\/div>/);
 assert.match(context.extra({id:'g'}),/<div[^>]*><ol class="history-list"[^>]*><\/ol><\/div>/);
 assert.match(slots.renderHistoryLoading(),/<div><ol class="history-list"><\/ol><\/div>/);
});
