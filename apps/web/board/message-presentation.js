import {icon} from '../icons.js';
const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

// The full text remains authoritative. Only a verified actor prefix receives
// visual truncation; coordinates, narration and action labels stay untouched.
export function boardMessagePresentation(message) {
  const text=String(message.text??'');
  const actorName=typeof message.actorName==='string'&&message.actorName.length&&text.startsWith(`${message.actorName} `)?message.actorName:null;
  return {text,actorName,rest:actorName?text.slice(actorName.length):text,
    actions:Array.isArray(message.actions)?message.actions:message.action?[message.action]:[]};
}
const actionIcons = {'replay-computer':'rematch','replay-next':'right','replay-stop':'close','replay-dismiss':'close',pass:'right','end-turn':'check'};
// Sizing uses identical content without exposing an actionable data attribute.
export function renderBoardInlineAction({id,label},{sizing=false,preview=false}={}) {
  const glyph=Object.hasOwn(actionIcons,id)?actionIcons[id]:null;
  return `<button type="button" class="board-preview-inline-button"${sizing?' disabled tabindex="-1"':` ${preview?'data-board-preview-action':'data-board-message-action'}="${escape(id)}"`}>${glyph?icon(glyph):''}<span class="board-inline-action-label">${escape(label)}</span></button>`;
}
export function updateBoardInlineActionLabel(button,label) {
  const target=button.querySelector?.(':scope > .board-inline-action-label');
  if (!target) return false;
  const text=String(label);
  if (target.textContent!==text) target.textContent=text;
  return true;
}
export function renderBoardMessageHtml(message) {
  const {text,actorName,rest,actions}=boardMessagePresentation(message);
  const copy=actorName?`<bdi class="board-message-name" dir="auto" title="${escape(actorName)}">${escape(actorName)}</bdi>${escape(rest)}`:escape(text);
  return copy+actions.map(action=>` ${renderBoardInlineAction(action)}`).join('');
}
