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
 return `<ul class="participant-list perspective-participants" data-testid="participants-list">${seats}</ul>`;
}

export function renderViewersPanel(game,{identityId,expanded=false,icon=()=>'',formatStatus=()=>'',after=''}={}) {
 const viewers=viewerSummary(game.viewers??[],{identityId});
 const identity=(person,index)=>participantButton(person,{key:`viewer:${person.identityId||index}`,presence:formatStatus(person.connected),displayName:identityId&&person.identityId===identityId?'You':participantDisplayName(person,'Guest')});
 const rows=()=>`<ul class="participant-list viewer-roster">${viewers.entries.map((person,index)=>`<li data-testid="participant-viewer">${identity(person,index)}</li>`).join('')}</ul>`;
 const audience=!viewers.count?`<p class="viewer-empty">${icon('players')}<span>None</span></p>`
  :viewers.count===1?rows():`<details class="viewer-audience" data-viewer-disclosure data-persist data-decision-id="${escape(game.id)}" data-version="${escape(game.id)}" data-game-id="${escape(game.id)}" ${expanded?'open':''}>
   <summary data-action="viewer-disclosure"><span class="viewer-audience-compact"><bdi>${escape(viewers.text)}</bdi></span><span class="viewer-audience-expanded">${viewers.count} viewers</span></summary>${rows()}</details>`;
 return `<section class="viewers-section" data-testid="viewers-section" data-game-id="${escape(game.id)}"><h3 tabindex="-1">Viewers</h3><div data-viewer-audience>${audience}</div>${after}</section>`;
}
