import test from 'node:test';
import assert from 'node:assert/strict';
import {icon} from '../icons.js';
import {icon as shellIcon} from '../shell/ui.js';
import {boardMessagePresentation,renderBoardMessageHtml,renderBoardInlineAction,updateBoardInlineActionLabel} from '../board/message-presentation.js';

test('verified actor prefixes retain full escaped names, coordinates and action labels',()=>{
 const actorName='משחק <星> "&',text=`${actorName} moved a piece from (9, 9) to (0, 0)`;
 const message={actorName,text,action:{id:'replay"next',label:'Show <again>'}},before=structuredClone(message);
 const html=renderBoardMessageHtml(message);
 assert.match(html,/<bdi class="board-message-name" dir="auto" title="משחק &lt;星&gt; &quot;&amp;">משחק &lt;星&gt; &quot;&amp;<\/bdi> moved a piece from \(9, 9\) to \(0, 0\)/);
 assert.match(html,/data-board-message-action="replay&quot;next"/);assert.match(html,/>Show &lt;again&gt;<\/span><\/button>/);
 assert.doesNotMatch(html,/<星>|<again>|aria-hidden|aria-label/);assert.deepEqual(message,before);
 assert.equal(boardMessagePresentation(message).text,text);
});
test('mismatched or incomplete actor metadata never hides or rewrites ordinary text',()=>{
 for(const actorName of ['Wrong','Name',null,4,'']){
  const message={actorName,text:'Namesake <moved>'};
  assert.equal(boardMessagePresentation(message).actorName,null);
  assert.equal(renderBoardMessageHtml(message),'Namesake &lt;moved&gt;');
 }
 assert.equal(renderBoardMessageHtml({text:'Replay · 2 of 3'}),'Replay · 2 of 3');
});

test('inline controls use fixed brand glyphs and identical inert sizing content',()=>{
 assert.equal(icon,shellIcon);
 for(const [id,label,glyph] of [['replay-computer','Show me again','rematch'],['replay-next','Next','right'],['replay-stop','Stop replay','close'],['replay-dismiss','Dismiss','close'],['pass','Pass','right'],['end-turn','End Turn','check']]){
  const live=renderBoardInlineAction({id,label}),sizing=renderBoardInlineAction({id,label},{sizing:true});
  assert.match(live,/<svg class="righelt-icon"[^>]*aria-hidden="true" focusable="false"/);
  assert(live.includes(icon(glyph)));
  assert.match(live,/<span class="board-inline-action-label">/);
  assert.equal(live.slice(live.indexOf('><svg')),sizing.slice(sizing.indexOf('><svg')));
  assert.match(sizing,/disabled tabindex="-1"/);assert.doesNotMatch(sizing,/data-board/);
 }
 const unknown=renderBoardInlineAction({id:'<unknown>',label:'<Next> & "'});
 assert.doesNotMatch(unknown,/<svg|<unknown>|<Next>/);assert.match(unknown,/&lt;Next&gt; &amp; &quot;/);
});
test('label changes preserve decorative SVG and focused control children',()=>{
 const svg={},label={textContent:'Next'},button={children:[svg,label],querySelector:selector=>selector===':scope > .board-inline-action-label'?label:null};
 assert.equal(updateBoardInlineActionLabel(button,'<Continue>'),true);
 assert.equal(label.textContent,'<Continue>');assert.equal(button.children[0],svg);assert.equal(button.children[1],label);
 assert.equal(updateBoardInlineActionLabel({querySelector:()=>null},'Next'),false);
});


test('structured narration uses coordinate chips and separate natural-wrapping instruction rows',()=>{
 const html=renderBoardMessageHtml({rows:[{actorName:'Name (9, 9)',text:'Name (9, 9) moved from (9, 9) to (0, 0)',coordinates:[{row:9,col:9},{row:0,col:0}],action:{id:'replay-computer',label:'Show me again'}},{text:'Select a piece or',action:{id:'pass',label:'Pass'}}]});
 assert.equal((html.match(/class="board-message-row"/g)??[]).length,2);
 assert.equal((html.match(/board-preview-coordinate-chip-neutral/g)??[]).length,2);
 assert.match(html,/>Name \(9, 9\)<\/bdi>/);
 assert.match(html,/>9, 9<\/span>/);
 assert(html.indexOf('Show me again')<html.indexOf('Select a piece or'));
 assert(html.indexOf('Select a piece or')<html.indexOf('>Pass<'));
 const inert=renderBoardMessageHtml({rows:[{text:'Select a piece or',action:{id:'pass',label:'Pass'}}]},{sizing:true});
 assert.doesNotMatch(inert,/data-board-message-action/);assert.match(inert,/disabled tabindex="-1"/);
});
