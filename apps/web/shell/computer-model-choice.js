import {COMPUTER_MODEL_CHOICES,CURRENT_COMPUTER_MODEL,CANDIDATE_A_COMPUTER_MODEL} from '../generated/packages/shared-types/src/computer-play.js';

export const selectableComputerModel = id => COMPUTER_MODEL_CHOICES.some(model=>model.id===id);
export const computerModelChoiceLabel = id => id===CANDIDATE_A_COMPUTER_MODEL.id?'Candidate A · Experimental':null;
export function renderComputerModelChoice(modelId=CURRENT_COMPUTER_MODEL.id,name='computer-model') {
  return `<fieldset class="computer-model-choice" data-computer-model-choice><legend>Opponent version</legend><div>${COMPUTER_MODEL_CHOICES.map(model=>`<label><input type="radio" name="${name}" value="${model.id}" ${model.id===modelId?'checked':''}><span>${model.label}</span></label>`).join('')}</div><p class="small">Candidate A is experimental.</p></fieldset>`;
}
