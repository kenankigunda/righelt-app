const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

// The full text remains authoritative. Only a verified actor prefix receives
// visual truncation; coordinates, narration and action labels stay untouched.
export function boardMessagePresentation(message) {
  const text=String(message.text??'');
  const actorName=typeof message.actorName==='string'&&message.actorName.length&&text.startsWith(`${message.actorName} `)?message.actorName:null;
  return {text,actorName,rest:actorName?text.slice(actorName.length):text,
    actions:Array.isArray(message.actions)?message.actions:message.action?[message.action]:[]};
}
export function renderBoardMessageHtml(message) {
  const {text,actorName,rest,actions}=boardMessagePresentation(message);
  const copy=actorName?`<bdi class="board-message-name" dir="auto" title="${escape(actorName)}">${escape(actorName)}</bdi>${escape(rest)}`:escape(text);
  return copy+actions.map(action=>` <button type="button" class="board-preview-inline-button" data-board-message-action="${escape(action.id)}">${escape(action.label)}</button>`).join('');
}
