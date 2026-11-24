import test from 'node:test';import assert from 'node:assert/strict';
import {CURRENT_COMPUTER_MODEL,CANDIDATE_A_COMPUTER_MODEL} from '../generated/packages/shared-types/src/computer-play.js';
import {createOpponentStoryDialog} from '../shell/opponent-stories.js';
import {createRematchDialog} from '../shell/game-result.js';
import {renderComputerPlayerCard} from '../shell/computer-player-card.js';
import {computerModelChoiceLabel,renderComputerModelChoice,selectableComputerModel} from '../shell/computer-model-choice.js';
const incumbent=CURRENT_COMPUTER_MODEL.id,candidate=CANDIDATE_A_COMPUTER_MODEL.id;
test('model choices label only selectable candidates and keep the incumbent checked by default',()=>{
 assert.equal(computerModelChoiceLabel(candidate),'Candidate A · Experimental');
 for(const id of [incumbent,'initial-1554','unknown',undefined]) assert.equal(computerModelChoiceLabel(id),null);
 assert.equal(selectableComputerModel('unknown'),false);
 const html=renderComputerModelChoice();
 assert.match(html,new RegExp(`value="${incumbent}" checked`));
 assert.doesNotMatch(html,new RegExp(`value="${candidate}" checked`));
 assert.match(html,/Candidate versions are experimental\./);
});
function fixture(){
 const handlers={},nodes={'[data-story-play]':{dataset:{},setAttribute(){}},'[data-story-readiness]':{dataset:{}},'[data-story-retry]':{},'[data-rematch-start]':{dataset:{},setAttribute(){}},'[role=status]':{dataset:{}},'[data-rematch-retry]':{},'[data-computer-model-choice]':{},'[name=rematch-opponent]:checked':{value:'babs'},'[name=rematch-side]:checked':{value:'p2'}};
 const element={open:false,dataset:{},querySelector:selector=>nodes[selector]??null,querySelectorAll:()=>[],addEventListener:(event,fn)=>handlers[event]=fn};
 const document=new EventTarget();document.querySelector=()=>null;
 const createModal=({onClose})=>({element,open(){element.open=true;},close(){element.open=false;onClose('dismiss');},destroy(){element.open=false;onClose('dismiss');}});
 return{handlers,nodes,element,document,createModal,change(){handlers.change({target:{value:candidate,matches:()=>true}});},click(selector){return handlers.click({target:{closest:match=>match===selector?{}:null}});}};
}
test('entry selection retires readiness for the old model and starts only the selected ready candidate',async()=>{
 const f=fixture(),changes=[],starts=[];let ready=incumbent;
 const dialog=createOpponentStoryDialog({...f,getReadiness:(_opponent,id)=>({state:id===ready?'ready':'preparing'}),onModelChange:(opponent,id)=>changes.push({opponent,id}),onPlay:intent=>{starts.push(intent);return{state:'started'};}});
 try{
  dialog.open('babs');assert.equal(dialog.modelId(),incumbent);
  f.change();assert.deepEqual(changes,[{opponent:'babs',id:candidate}]);assert.equal(f.nodes['[data-story-play]'].disabled,true);
  ready=candidate;dialog.refresh();assert.equal(f.nodes['[data-story-play]'].disabled,false);
  await f.click('[data-story-play]');assert.deepEqual(starts,[{opponent:'babs',side:'p1',modelId:candidate}]);
  dialog.open('tau');assert.equal(dialog.modelId(),incumbent,'fresh entry keeps the incumbent default');
 }finally{dialog.destroy();}
});
for(const title of ['Play again','Create a new game here'])test(`${title} forwards the selected model and resets fresh choices to incumbent`,async()=>{
 const f=fixture(),changes=[],starts=[];
 const dialog=createRematchDialog({...f,title,getReadiness:()=>({state:'ready'}),onOpponentChange:(opponent,id)=>changes.push({opponent,id}),onStart:intent=>starts.push(intent)});
 dialog.open({opponent:'babs',rematchSide:'p2'});assert.equal(dialog.modelId(),incumbent);f.change();assert.equal(dialog.modelId(),candidate);
 await f.click('[data-rematch-start]');assert.deepEqual(starts,[{opponent:'babs',side:'p2',modelId:candidate}]);assert.deepEqual(changes.at(-1),{opponent:'babs',id:candidate});
 dialog.open({opponent:'babs',rematchSide:'p2'});assert.equal(dialog.modelId(),incumbent);
});
test('the pinned candidate is visible without renaming the computer player or labelling it stronger',()=>{
 const html=renderComputerPlayerCard({computerProfile:'tau'},{gameId:'candidate',side:'P2',modelId:candidate});
 assert.match(html,/Candidate A · Experimental/);assert.match(html,/>Tau</);assert.doesNotMatch(html,/stronger|improved|promoted/i);
 assert.doesNotMatch(renderComputerPlayerCard({computerProfile:'tau'},{gameId:'incumbent',side:'P2',modelId:incumbent}),/Candidate A/);
});
