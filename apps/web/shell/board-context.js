import {renderBoardMessageHtml} from '../board/message-presentation.js';
import {renderDismissButton} from './dismiss-control.js';

const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

// Acknowledged turns and current piece help have independent lifetimes. Neither
// hover nor a quiet status render acknowledges a turn or revives a dismissal.
export function createBoardContextStore() {
 const current=new Map(),entries=new Map(),dismissed=new Set(),announced=new Set();
 const prune=map=>{while(map.size>128){const protectedKeys=new Set(current.values()),key=[...map.keys()].find(value=>!protectedKeys.has(value));if(key===undefined)break;map.delete(key);}};
 return {
  update(channel,context) {
   if(!['acknowledged','piece'].includes(channel))throw Error('Unknown Board context channel');
   if(!context){const changed=current.has(channel);current.delete(channel);return changed;}
   if(typeof context.key!=='string'||!context.key||!context.gameId)throw Error('Board context requires an identity');
   const previous=entries.get(context.key);
   const signature=JSON.stringify({message:context.message,purpose:context.purpose,actorSide:context.actorSide,mandatory:Boolean(context.mandatory),transient:Boolean(context.transient)});
   const changed=current.get(channel)!==context.key||previous?.signature!==signature;
   entries.set(context.key,{...context,channel,signature});current.set(channel,context.key);prune(entries);
   return changed;
  },
  clear(){const changed=current.size>0;current.clear();entries.clear();dismissed.clear();announced.clear();return changed;},
  get(key){return entries.get(key)??null;},
  channel(channel){return entries.get(current.get(channel))??null;},
  items(gameId){return [...current.values()].map(key=>entries.get(key)).filter(context=>context?.gameId===gameId&&context.message&&!dismissed.has(context.key));},
  dismiss(key){const context=entries.get(key);if(!context||context.mandatory||dismissed.has(key))return false;dismissed.add(key);prune(dismissed);return true;},
  isDismissed(key){return dismissed.has(key);},
  takeAnnouncement(key){
   const context=entries.get(key);
   if(!context||context.transient||dismissed.has(key)||announced.has(key))return null;
   announced.add(key);prune(announced);return String(context.message?.text??'');
  },
 };
}

// Text and structured coordinates use the same escaped renderer as the Board.
// The context owner dispatches replay. Runtime recovery controls stay in Board.
export function renderBoardContext(context,{replayEnabled=false}={}) {
 const body={...context.message};delete body.action;delete body.actions;delete body.context;
 const key=escape(context.key);
 return `<section class="shell-game-alert alert board-context-notice" data-board-context="${key}" aria-label="${context.mandatory?'Required Board guidance':'Board context'}" aria-live="off">
  <span class="notice-paper-face" hidden aria-hidden="true"></span><span class="notice-paper-curl" hidden aria-hidden="true"></span>
  <div class="board-context-body" role="region" aria-label="${context.mandatory?'Required piece coordinates':'Board explanation'}" tabindex="0"><div class="board-context-content">${renderBoardMessageHtml(body)}</div></div>
  <span class="board-context-scroll-cue" aria-hidden="true">More ↓</span>
  ${context.replay?`<div class="board-context-actions"><button type="button" class="secondary board-context-replay" data-action="replay-board-context" data-board-context-key="${key}"${replayEnabled?'':' disabled'}>Show me again</button></div>`:''}
  ${context.mandatory?'':renderDismissButton({label:'Dismiss Board context',className:'board-context-dismiss',attributes:{'data-action':'dismiss-board-context','data-board-context-key':context.key}})}
 </section>`;
}
