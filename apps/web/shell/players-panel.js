import {participantButton,participantDisplayName} from './public-profile.js';
import {humanControlledSides,playerDisplayName} from './perspective-labels.js';
import {viewerSummary} from './viewer-summary.js';
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderPlayersPanel(game,{identityId,expanded=false,pendingSeat,icon=()=>'',formatStatus=()=>''}={}) {
 const own=humanControlledSides(game,{identityId});
 const seats=['P1','P2'].map((side,index)=>{
  const person=game[index?'player2':'player1'],color=index?'Blue':'Red';
  const accessibleIdentity=own.includes(side)?'You':playerDisplayName(game,side);
  const content=person?participantButton(person,{key:`seat:${side}`,side:side.toLowerCase(),presence:formatStatus(person.connected),displayName:own.includes(side)?'You':participantDisplayName(person,'Guest'),accessibleName:`${accessibleIdentity}, ${color}, ${person.computerProfile?'Computer player':person.connected?'Connected':'Disconnected'}`}):`<span class="participant-empty" data-player-side="${side.toLowerCase()}" ${pendingSeat===(index?'blue':'red')?'data-testid="pending-invitation"':''}>${icon('account')}<span>${pendingSeat===(index?'blue':'red')?'Awaiting player':'Open seat'}</span><span class="sr-only">${color}</span></span>`;
  return `<li data-testid="participant-player-${index+1}">${content}</li>`;
 }).join('');
 const viewers=viewerSummary(game.viewers??[],{identityId});
 const summary=viewers.count?`<button class="viewers-summary secondary" data-action="toggle-viewers" data-game-id="${escape(game.id)}" aria-label="Viewers: ${escape(viewers.text)}" aria-expanded="${expanded}" aria-controls="viewers-${escape(game.id)}">${icon('players')}<bdi>${escape(viewers.text)}</bdi><span class="viewers-disclosure" aria-hidden="true">${icon('right')}</span></button>`:`<span class="participant-empty">${icon('account-none')}<span>No viewers</span></span>`;
 const rows=viewers.count?`<ul class="expanded-viewers" id="viewers-${escape(game.id)}" ${expanded?'':'hidden'}>${(expanded?viewers.entries:[]).map((person,index)=>`<li data-testid="participant-viewer">${participantButton(person,{key:`viewer:${person.identityId||index}`,presence:formatStatus(person.connected),displayName:identityId&&person.identityId===identityId?'You':participantDisplayName(person,'Guest')})}</li>`).join('')}</ul>`:'';
 return `<ul class="participant-list perspective-participants" data-testid="participants-list">${seats}<li class="viewers-row">${summary}${rows}</li></ul>`;
}
