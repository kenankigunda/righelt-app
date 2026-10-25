import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../shell/app.js',import.meta.url),'utf8');
const declaration=source.slice(source.indexOf('const renderHistoryPanel ='),source.indexOf('const renderBoardPanel ='));
test('history shows actor names only with their moves and puts result access after history',()=>{
 const context={renderTurnHistory:()=>'<li>Horus · Move 1: Rush</li>',renderAdditionalHistory:()=>'<div>Earlier moves</div>',getGameResult:()=>({winner:'p2'}),transport:{getAuthoritativeGame:()=>({}),getIdentityId:()=> 'owner'},escapeHtml:value=>String(value),participantName:()=>{throw Error('Standalone participant identity must not render in History');}};
 vm.runInNewContext(`${declaration};globalThis.render=renderHistoryPanel;`,context);
 const html=context.render({id:'game',player1:{computerProfile:'babs'},player2:{computerProfile:'horus'}});
 assert.match(html,/Horus · Move 1/);
 assert.doesNotMatch(html,/history-player-names|history-player-name|Computer/);
 assert(html.indexOf('data-action="view-result"')>html.indexOf('</ol>'));
 assert(!html.slice(0,html.indexOf('<ol')).includes('<button'));
});
