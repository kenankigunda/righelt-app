import {renderCoordinateChip} from './coordinate-chip.js';
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
const renderCopy = (text, coordinates = []) => {
  const known = new Map(coordinates.filter(Boolean).map(point => [`${point.row},${point.col}`, point]));
  return String(text).split(/(\(\d+,\s*\d+\))/g).map(part => {
    const match = part.match(/^\((\d+),\s*(\d+)\)$/);
    const point = match && known.get(`${Number(match[1])},${Number(match[2])}`);
    return point ? renderCoordinateChip(point) : escape(part);
  }).join('');
};
export function renderBoardMessageHtml(message, {sizing = false} = {}) {
  if (message.rows) return message.rows.map(row => `<span class="board-message-row">${renderBoardMessageHtml(row,{sizing})}</span>`).join('');
  const {text,actorName,rest,actions}=boardMessagePresentation(message);
  const copy=actorName?`<bdi class="board-message-name" dir="auto" title="${escape(actorName)}">${escape(actorName)}</bdi>${renderCopy(rest,message.coordinates)}`:renderCopy(text,message.coordinates);
  return copy+actions.map(action=>` ${renderBoardInlineAction(action,{sizing})}`).join('');
}

/** Patch changed narration without detaching its focused replay/action controls. */
export function patchBoardMessage(element, html) {
  const doc = element?.ownerDocument;
  if (!doc?.createElement) return false;
  const next = doc.createElement('span');
  next.innerHTML = html;
  const compatible = (left,right) => {
    if (left.nodeType !== right.nodeType || left.nodeName !== right.nodeName) return false;
    if (left.nodeType === 1) {
      const attrs = node => [...node.attributes].filter(attr => attr.name !== 'title').map(attr => {
        // Native press feedback belongs to the live control. It must not turn
        // an otherwise identical message refresh into a detached click target.
        const inlineAction=node.matches?.('button[data-board-message-action],button[data-board-preview-action]');
        const value=attr.name==='class'&&inlineAction
          ? attr.value.split(/\s+/).filter(name=>name!=='is-pressing'&&name!=='is-releasing'&&name!=='button-release-bounce').join(' ')
          : attr.value;
        return `${attr.name}=${value}`;
      }).sort().join('|');
      if (attrs(left) !== attrs(right)) return false;
    }
    return true;
  };
  const directActions=node=>[...(node.querySelectorAll?.(':scope > button[data-board-message-action]')??[])];
  const previousActions=directActions(element),nextActions=directActions(next);
  const patchRootActions=previousActions.length>0&&previousActions.length===nextActions.length
    &&previousActions.every((button,index)=>compatible(button,nextActions[index]));
  if (!patchRootActions&&(element.childNodes.length !== next.childNodes.length || ![...element.childNodes].every((child,index)=>compatible(child,next.childNodes[index])))) return false;
  const patch = (left,right) => {
    if (left.nodeType === 3 && left.nodeValue !== right.nodeValue) left.nodeValue = right.nodeValue;
    if (left.nodeType === 1 && left.title !== right.title) left.title = right.title;
    const previous=[...left.childNodes], incoming=[...right.childNodes];
    const actionKey=node=>node.nodeType===1&&node.matches?.('button[data-board-message-action]')
      ? node.getAttribute('data-board-message-action') : null;
    const oldActions=new Map(previous.map(node=>[actionKey(node),node]).filter(([key])=>key));
    const nextActions=new Map(incoming.map(node=>[actionKey(node),node]).filter(([key])=>key));
    const retained=new Set([...oldActions.keys()].filter(key=>nextActions.has(key)&&compatible(oldActions.get(key),nextActions.get(key))));
    const beforeKeys=previous.map(actionKey).filter(key=>retained.has(key));
    const afterKeys=incoming.map(actionKey).filter(key=>retained.has(key));
    // Keep matching action anchors in place: inserting/removing adjacent copy
    // preserves native focus, whereas moving a focused button can blur it.
    if(retained.size&&JSON.stringify(beforeKeys)===JSON.stringify(afterKeys)){
      let cursor=left.firstChild;
      for(const next of incoming){
        const anchor=retained.has(actionKey(next))?oldActions.get(actionKey(next)):null;
        if(anchor){
          while(cursor&&cursor!==anchor){const following=cursor.nextSibling;cursor.remove();cursor=following;}
          patch(anchor,next);cursor=anchor.nextSibling;
        }else if(cursor&&retained.has(actionKey(cursor))){
          left.insertBefore(next.cloneNode(true),cursor);
        }else if(cursor){
          const following=cursor.nextSibling;
          if(compatible(cursor,next))patch(cursor,next);else cursor.replaceWith(next.cloneNode(true));
          cursor=following;
        }else left.appendChild(next.cloneNode(true));
      }
      while(cursor){const following=cursor.nextSibling;cursor.remove();cursor=following;}
      return;
    }
    // Independent rows can also gain coordinate pills while their sibling
    // control row remains mounted and compatible.
    for(let index=0;index<Math.max(previous.length,incoming.length);index++){
      const old=previous[index], next=incoming[index];
      if(!next){old.remove();continue;}
      if(!old){left.appendChild(next.cloneNode(true));continue;}
      if(compatible(old,next))patch(old,next);
      else old.replaceWith(next.cloneNode(true));
    }
  };
  if(patchRootActions)patch(element,next);
  else [...element.childNodes].forEach((child,index)=>patch(child,next.childNodes[index]));
  return true;
}
