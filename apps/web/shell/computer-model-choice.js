import {COMPUTER_MODEL_CHOICES,CURRENT_COMPUTER_MODEL} from '../generated/packages/shared-types/src/computer-play.js';

export const selectableComputerModel = id => COMPUTER_MODEL_CHOICES.some(model=>model.id===id);
export const computerModelChoiceLabel = id => {
  const model = COMPUTER_MODEL_CHOICES.find(model=>model.id===id);
  return model && id!==CURRENT_COMPUTER_MODEL.id ? `${model.label} · Experimental` : null;
};
export function renderComputerModelChoice(modelId=CURRENT_COMPUTER_MODEL.id,name='computer-model') {
  return `<fieldset class="computer-model-choice" data-computer-model-choice><legend>Opponent version</legend><div>${COMPUTER_MODEL_CHOICES.map(model=>`<label><input type="radio" name="${name}" value="${model.id}" ${model.id===modelId?'checked':''}><span>${model.label}</span></label>`).join('')}</div><p class="small">Candidate versions are experimental.</p></fieldset>`;
}
