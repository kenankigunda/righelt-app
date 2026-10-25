import test from 'node:test';
import assert from 'node:assert/strict';
import {boardMessagePresentation,renderBoardMessageHtml} from '../board/message-presentation.js';

test('verified actor prefixes retain full escaped names, coordinates and action labels',()=>{
 const actorName='משחק <星> "&',text=`${actorName} moved a piece from (9, 9) to (0, 0)`;
 const message={actorName,text,action:{id:'replay"next',label:'Show <again>'}},before=structuredClone(message);
 const html=renderBoardMessageHtml(message);
 assert.match(html,/<bdi class="board-message-name" dir="auto" title="משחק &lt;星&gt; &quot;&amp;">משחק &lt;星&gt; &quot;&amp;<\/bdi> moved a piece from \(9, 9\) to \(0, 0\)/);
 assert.match(html,/data-board-message-action="replay&quot;next"/);assert.match(html,/>Show &lt;again&gt;<\/button>/);
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
