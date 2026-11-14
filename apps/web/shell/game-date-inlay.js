import {celestialMarkMarkup} from './celestial-mark.js';

const escape=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));

const PHASES=Object.freeze([
  {name:'late night',until:5,position:[10,50],palette:['#2c405b','#a9bfc9'],moon:true},
  {name:'early morning',until:9,position:[4,29],palette:['#a06b75','#ddc0ae']},
  {name:'mid morning',until:11,position:[7,13],palette:['#4d7e91','#bfd4d9']},
  {name:'noon',until:14,position:[24,3],palette:['#326c8e','#d7e5de']},
  {name:'afternoon',until:18,position:[41,13],palette:['#78617e','#d3c1ac']},
  {name:'evening',until:21,position:[44,29],palette:['#805f7d','#d3b8bd']},
  {name:'night',until:24,position:[37,50],palette:['#465e83','#b8c8d8'],moon:true},
]);

const formatter=(locale,options)=>new Intl.DateTimeFormat(locale,options);
const partsObject=(value,locale,timeZone)=>Object.fromEntries(formatter(locale,{month:'short',day:'numeric',timeZone}).formatToParts(value).map(part=>[part.type,part.value]));
// Phase arithmetic never parses localized numerals. Visible date text and the
// full accessible label still use the viewer's requested numbering system.
const numericHour=(value,locale,timeZone)=>Number(formatter(locale,{hour:'numeric',hourCycle:'h23',numberingSystem:'latn',timeZone}).formatToParts(value).find(part=>part.type==='hour')?.value);

/** Presentation only. Righelt's immutable game creation instant is the available start contract. */
export function gameDateInlayModel(startedAt,{locale,timeZone}={}){
  const instant=new Date(String(startedAt??''));
  if(!Number.isFinite(instant.getTime()))return null;
  const parts=partsObject(instant,locale,timeZone),hour=numericHour(instant,locale,timeZone),phase=PHASES.find(candidate=>hour<candidate.until)??PHASES.at(-1);
  const label=formatter(locale,{dateStyle:'long',timeStyle:'short',timeZone}).format(instant);
  return{month:parts.month,day:parts.day,hour,phase:phase.name,position:phase.position,palette:phase.palette,moon:phase.moon===true,label};
}

export function renderGameDateInlay(startedAt,options={}){
  const model=gameDateInlayModel(startedAt,options);
  if(!model)return '<svg class="game-date-inlay is-loading" viewBox="0 0 48 56" aria-hidden="true" focusable="false"><path class="game-date-orbit-highlight" d="M3 37V10l7-7h28l7 7v27"/><path class="game-date-orbit" d="M3 37V10l7-7h28l7 7v27"/></svg>';
  const [deep]=model.palette;
  const celestial=celestialMarkMarkup(model,{className:'game-date-celestial'});
  return `<svg class="game-date-inlay" viewBox="0 0 48 56" role="img" aria-label="${escape(`Started ${model.label}, ${model.phase}`)}" focusable="false"><path class="game-date-orbit-highlight" d="M3 37V10l7-7h28l7 7v27"/><path class="game-date-orbit" stroke="${deep}" d="M3 37V10l7-7h28l7 7v27"/>${celestial}<text class="game-date-month" x="24" y="19">${escape(model.month)}</text><text class="game-date-day" x="24" y="36">${escape(model.day)}</text></svg>`;
}
