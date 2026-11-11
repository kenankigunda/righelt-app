import {renderCoordinateChip} from '../board/coordinate-chip.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {getSelectedPieceExplanation, getSelectedPieceCondition, SELECTED_PIECE_EXPLANATIONS, SELECTED_CONTINUATION_LABELS} from '../board/piece-explanations.js';
import {getBlockedMoveExplanation, BLOCKED_PREVIEW_REASON} from '../interaction.js';

test('selected-piece explanations separate display connectivity from frozen sequence eligibility', () => {
  const piece = {id:'A', supplied:true, commanded:true};
  assert.equal(getSelectedPieceExplanation(piece, {}), null);
  assert.equal(getSelectedPieceExplanation(null, {}), null);
  assert.equal(getSelectedPieceExplanation({...piece, displayCommanded:false}, {}), 'No command connection');
  assert.equal(getSelectedPieceExplanation({...piece, displaySupplied:false}, {continuation:{type:'rush'}}), 'No supply connection');
  for (const type of ['rush','push']) {
    const state = {continuation:{type, frozenPieceStatesById:{A:{supplied:false,commanded:false}}}};
    assert.equal(getSelectedPieceExplanation(piece, state), `Cannot move: no command or supply at start of ${type}`);
    assert.equal(getSelectedPieceCondition({...piece,displaySupplied:false}, state).type, 'frozen');
    assert.equal(getSelectedPieceCondition({...piece,displaySupplied:false}, {continuation:{type,frozenPieceStatesById:{A:piece}}}).type, 'at-risk');
  }
  assert.equal(getSelectedPieceExplanation(piece, {continuation:{type:'move',frozenPieceStatesById:{A:{supplied:false}}}}), null);
  assert(SELECTED_PIECE_EXPLANATIONS.every(text => text && !/[.:;]$/.test(text)));
});

test('blocked target explanations use player-facing causes without leaking unknown rule codes', () => {
  assert.equal(getBlockedMoveExplanation(BLOCKED_PREVIEW_REASON.SUPPLY_DESTINATION_UNSUPPLIED), 'Destination would have no supply');
  assert.equal(getBlockedMoveExplanation(BLOCKED_PREVIEW_REASON.PUSH_STRENGTH_TOO_WEAK), 'Group too weak to push');
  assert.equal(getBlockedMoveExplanation('PRIVATE_INTERNAL_RULE'), 'Move unavailable');
});

test('shared coordinate chips preserve geometry classes and escape malformed values',()=>{
 assert.equal(renderCoordinateChip(null),'');
 assert.equal(renderCoordinateChip({row:9,col:9}),'<span class="board-preview-coordinate-chip board-preview-coordinate-chip-neutral">9, 9</span>');
 const html=renderCoordinateChip({row:'<img>',col:'"'},'tone" onclick="bad');
 assert(!html.includes('<img>'));assert(!html.includes(' onclick="bad'));
 assert(html.includes('&lt;img&gt;'));assert(html.includes('&quot;'));
});


test('all action-first missing connections retain classification across ordinary, frozen and at-risk states',()=>{
 assert.equal(SELECTED_CONTINUATION_LABELS.rushBlocker,'Restore connection for piece at');
 for(const [supplied,commanded,missing] of [[true,false,'command'],[false,true,'supply'],[false,false,'command or supply']]){
  const piece={id:'A',supplied,commanded};
  assert.equal(getSelectedPieceCondition(piece,{}).type,'inactive');assert.equal(getSelectedPieceExplanation(piece,{}),`No ${missing} connection`);
  for(const type of ['rush','push']){
   assert.equal(getSelectedPieceCondition(piece,{continuation:{type}}).type,'at-risk');assert.equal(getSelectedPieceExplanation(piece,{continuation:{type}}),`No ${missing} connection`);
   const frozen={continuation:{type,frozenPieceStatesById:{A:{supplied,commanded}}}};
   const restored={...piece,displaySupplied:true,displayCommanded:true};assert.equal(getSelectedPieceCondition(restored,frozen).type,'frozen');assert.equal(getSelectedPieceExplanation(restored,frozen),`Cannot move: no ${missing} at start of ${type}`);
  }
 }
});
