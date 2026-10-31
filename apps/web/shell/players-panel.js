import {participantButton,participantDisplayName} from './public-profile.js';
import {humanControlledSides,playerDisplayName,hasAnonymousPlayers} from './perspective-labels.js';
import {viewerSummary} from './viewer-summary.js';
import {renderComputerPlayerCard} from './computer-player-card.js';
const escape = value => String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderPlayersPanel(game,{identityId,expanded=false,pendingSeat,icon=()=>'',formatStatus=()=>'',computerActivity,expandedComputers=new Set()}={}) {
 const own=humanControlledSides(game,{identityId}),anonymousPair=hasAnonymousPlayers(game);
 const seats=['P1','P2'].map((side,index)=>{
  const person=game[index?'player2':'player1'],color=index?'Blue':'Red';
  const computerProfile=game.computer ? game.computer.seats?.[index?'p2':'p1'] : person?.computerProfile;
  const visibleIdentity=anonymousPair?playerDisplayName(game,side):own.includes(side)?'You':playerDisplayName(game,side);
  const accessibleIdentity=anonymousPair&&own.includes(side)?`${visibleIdentity}, you`:visibleIdentity;
  const content=computerProfile?renderComputerPlayerCard({...person,computerProfile},{gameId:game.id,side,expanded:expandedComputers.has(side),activity:computerActivity}):person?participantButton(person,{key:`seat:${side}`,side:side.toLowerCase(),presence:formatStatus(person.connected),displayName:visibleIdentity,accessibleName:`${accessibleIdentity}, ${color}, ${person.connected?'Connected':'Disconnected'}`}):`<span class="participant-empty" data-player-side="${side.toLowerCase()}" ${pendingSeat===(index?'blue':'red')?'data-testid="pending-invitation"':''}>${icon('account')}<span>${pendingSeat===(index?'blue':'red')?'Awaiting player':'Open seat'}</span><span class="sr-only">${color}</span></span>`;
  return `<li data-testid="participant-player-${index+1}">${content}</li>`;
 }).join('');
 const viewers=viewerSummary(game.viewers??[],{identityId});
 const summary=viewers.count?`<button class="viewers-summary secondary" data-action="toggle-viewers" data-game-id="${escape(game.id)}" aria-label="Viewers: ${escape(viewers.text)}" aria-expanded="${expanded}" aria-controls="viewers-${escape(game.id)}">${icon('players')}<bdi>${escape(viewers.text)}</bdi><span class="viewers-disclosure" aria-hidden="true">${icon('right')}</span></button>`:`<span class="participant-empty">${icon('account-none')}<span>No viewers</span></span>`;
 const rows=viewers.count?`<ul class="expanded-viewers" id="viewers-${escape(game.id)}" ${expanded?'':'hidden'}>${(expanded?viewers.entries:[]).map((person,index)=>`<li data-testid="participant-viewer">${participantButton(person,{key:`viewer:${person.identityId||index}`,presence:formatStatus(person.connected),displayName:identityId&&person.identityId===identityId?'You':participantDisplayName(person,'Guest')})}</li>`).join('')}</ul>`:'';
 return `<ul class="participant-list perspective-participants" data-testid="participants-list">${seats}<li class="viewers-row">${summary}${rows}</li></ul>`;
}
