import {homeCardMatchup} from './home-card-identity.js';
import {sideColorName,viewerAliasQualifiers} from './perspective-labels.js';
import {renderGameInlay} from './game-inlay.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const genericLabels=new Set(['You','Guest','Guest 1','Guest 2','Open seat']);
const titleSeat=seat=>({...seat,label:seat.name,color:sideColorName(seat.side),owned:false,qualifier:null,shortenable:false});
const withQualifier=seat=>seat.label+(seat.qualifier?` (${seat.qualifier})`:'');

/** Saved seats own matchup identity. Live turns and temporary control never do. */
export function gameTitleModel(game,{identityId}={}){
 const matchup=homeCardMatchup(game,{identityId}),seats=matchup.seats.map(titleSeat);
 if(matchup.kind==='self')return{kind:'self',seats,text:'You play both sides',participant:{...seats[0],label:'You',owned:true,shortenable:false}};
 if(matchup.kind==='watched-self'){
  const participant={...seats[0],shortenable:!seats[0].computer&&!genericLabels.has(seats[0].label)};
  return{kind:'watched-self',seats,text:`${participant.label} plays both sides`,participant};
 }
 const ordered=matchup.kind==='player'
  ? [seats.find(seat=>seat.side===matchup.ownSide),seats.find(seat=>seat.side!==matchup.ownSide)]
  : seats;
 if(matchup.kind==='player'){ordered[0]={...ordered[0],label:'You',owned:true};}
 const qualifiers=viewerAliasQualifiers(ordered.map(seat=>({...seat,name:seat.label})));
 for(let index=0;index<ordered.length;index++)ordered[index]={...ordered[index],qualifier:qualifiers[ordered[index].side]??null,shortenable:!ordered[index].computer&&!genericLabels.has(ordered[index].label)};
 return{kind:matchup.kind,seats:ordered,text:ordered.map(withQualifier).join(' vs. ')};
}

const statusMarkup=seat=>{const status=seat.presence==='open'?'open to join':seat.presence,label=seat.computer?'Computer player':`${seat.label} ${status}`;return `<span class="connection-status-icon is-${seat.presence}" role="img" aria-label="${escape(label)}" title="${escape(label)}"></span>`;};
const participantMarkup=seat=>`<span class="game-title-player player-tone-${seat.side}"><span class="sr-only">${seat.color}: </span><bdi dir="auto">${escape(seat.label)}</bdi>${seat.qualifier?`<span class="small player-identity-qualifier"> <bdi dir="auto">${escape(seat.qualifier)}</bdi></span>`:''}</span>`;

/** Presence is requested only by live Home cards. Game and result headings omit it. */
export function renderGameTitle(game,{identityId,presence=false,loading=false}={}){
 const inlay=renderGameInlay(game.id);
 if(loading)return `<span class="game-identity-title">${inlay}<span>Loading game</span></span>`;
 const model=gameTitleModel(game,{identityId});
 let text;
 if(model.kind==='self')text='<strong class="player-tone-both">You play both sides</strong>';
 else if(model.kind==='watched-self')text=`${participantMarkup(model.participant)} <span>plays both sides</span>${presence?model.seats.map(statusMarkup).join(''):''}`;
 else text=model.seats.map((seat,index)=>`${participantMarkup(seat)}${presence&&(model.kind==='viewer'||!seat.owned)?statusMarkup(seat):''}${index===0?' <span class="game-title-versus">vs.</span> ':''}`).join('');
 return `<span class="game-identity-title">${inlay}<span class="game-title-matchup">${text}</span></span>`;
}
