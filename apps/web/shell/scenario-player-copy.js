import {playerIdentityLabel,sideColorName} from './perspective-labels.js';

// Exact shipped copy only. Edited/imported descriptions remain authored text.
const curated = new Map([
 ['6d7e4600-ab44-4fc8-a88f-54d3149e1c5e',{
  original:'The red piece at (5,3) will lose supply if blue projects to (4,2) because that will introduce new diagonal lines in addition to the long horizontal line that cuts off supply from below due to the uncommanded blue pieces at (6,0) and (6,5). This shows how uncommanded pieces can still affect opponent supply lines.',
  parts:[{side:'P1'},'’s piece at (5,3) will lose supply if ',{side:'P2'},' projects to (4,2) because that will introduce new diagonal lines in addition to the long horizontal line that cuts off supply from below due to ',{side:'P2'},'’s uncommanded pieces at (6,0) and (6,5). This shows how uncommanded pieces can still affect opponent supply lines.'],
 }],
 ['5bbc0ebf-ed20-4e12-8143-67eaa5cc8676',{
  original:'This is an endgame where red has pursued a push strategy and blue, a project strategy. Both are a no more than a couple of moves away from threatening loss of supply against the opponents commander.',
  parts:['This is an endgame where ',{side:'P1'},' has pursued a push strategy and ',{side:'P2'},', a project strategy. Both are no more than a couple of moves away from threatening loss of supply against their opponent’s commander.'],
 }],
 ['7f0cf8bd-8af9-4f6d-9caf-7e6617d6c32d',{
  original:'This recorded game reaches a push where the blue commander has no legal retreat squares, so the commander is removed immediately and red wins the game.',
  parts:['This recorded game reaches a push where ',{side:'P2'},'’s commander has no legal retreat squares, so the commander is removed immediately and ',{side:'P1'},' wins the game.'],
 }],
]);

export function scenarioPlayerCopy(scenario,game) {
 const template=curated.get(scenario?.id);
 if(!game || !template || scenario.description!==template.original)return null;
 return template.parts.map(part=>{
  if(typeof part==='string')return part;
  const person=game[part.side==='P1'?'player1':'player2'];
  if(!person&&!game.computer?.seats?.[part.side==='P1'?'p1':'p2'])return {text:'Open seat',side:part.side,color:sideColorName(part.side),colorNamed:false};
  return {...playerIdentityLabel(game,part.side),colorNamed:false};
 });
}

const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const renderScenarioPlayerCopy = (scenario,game) => {
 const parts=scenarioPlayerCopy(scenario,game);
 return parts?.map(part=>typeof part==='string'?escape(part):`<span class="player-tone-${part.side.toLowerCase()}">${part.colorNamed?'':`<span class="sr-only">${part.color}: </span>`}<bdi>${escape(part.text)}</bdi></span>`).join('') ?? null;
};
