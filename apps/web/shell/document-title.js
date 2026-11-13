import {gameTitleModel} from './game-title.js';

export const DOCUMENT_TITLE_SUFFIX=' | Righelt';
export const DOCUMENT_TITLE_MAX_CHARACTERS=40;
const segmenter=typeof Intl?.Segmenter==='function'?new Intl.Segmenter(undefined,{granularity:'grapheme'}):null;
const graphemes=value=>segmenter?[...segmenter.segment(String(value))].map(part=>part.segment):Array.from(String(value));
const length=value=>graphemes(value).length;
const initial=value=>`${graphemes(String(value).trim())[0]??''}.`;
const seatText=seat=>seat.label+(seat.qualifier?` (${seat.qualifier})`:'');
const coreText=(model,seats=model.seats,participant=model.participant)=>model.kind==='self'||model.kind==='watched-self'?seatText(participant):seats.map(seatText).join(' vs. ');
const startDateText=value=>{
 const timestamp=Date.parse(String(value??''));
 return Number.isFinite(timestamp)?new Intl.DateTimeFormat('en',{month:'short',day:'numeric'}).format(new Date(timestamp)):null;
};

export function browserMatchupTitle(model,{maxCharacters=DOCUMENT_TITLE_MAX_CHARACTERS,startedAt=null}={}){
 const date=startDateText(startedAt),withSuffix=value=>`${value}${date?` | ${date}`:''}${DOCUMENT_TITLE_SUFFIX}`;
 let seats=model.seats?.map(seat=>({...seat}))??[],participant=model.participant?{...model.participant}:null;
 let value=withSuffix(coreText(model,seats,participant));
 if(length(value)<=maxCharacters)return value;
 const candidates=model.kind==='watched-self'
  ? participant?.shortenable?[{kind:'participant',index:0,value:participant}]:[]
  : seats.map((seat,index)=>({kind:'seat',index,value:seat})).filter(candidate=>candidate.value.shortenable);
 candidates.sort((left,right)=>length(right.value.label)-length(left.value.label)||left.index-right.index);
 for(const candidate of candidates){
  if(candidate.kind==='participant')participant={...participant,label:initial(participant.label),shortenable:false};
  else seats[candidate.index]={...seats[candidate.index],label:initial(seats[candidate.index].label),shortenable:false};
  value=withSuffix(coreText(model,seats,participant));
  if(length(value)<=maxCharacters)break;
 }
 return value;
}

export function documentTitleForRoute({routeName,routeHydrated=false,game=null,identityId=null,inviteResolved=false,unavailable=false}={}){
 if(routeName==='invite'&&!inviteResolved)return `Invitation${DOCUMENT_TITLE_SUFFIX}`;
 if(routeName!=='game'&&routeName!=='invite')return 'Righelt';
 if(game)return browserMatchupTitle(gameTitleModel(game,{identityId}),{startedAt:game.createdAt});
 if(unavailable||routeHydrated)return `Game unavailable${DOCUMENT_TITLE_SUFFIX}`;
 return `Loading game${DOCUMENT_TITLE_SUFFIX}`;
}
