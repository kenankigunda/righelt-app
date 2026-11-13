import {createDestructionTransitions} from './destruction-transitions.js';

// The visual commit and optional cue share one synchronous presentation onset.
// This does not claim sample-accurate browser paint or audio scheduling.
export function commitRemovalOnset({visual,cue,isCurrent=()=>true}){
 if(!isCurrent())return false;
 visual();
 if(!isCurrent())return false;
 cue();return true;
}

const pendingRecords=view=>(view?.pendingMoves??[])
 .filter(move=>!move.undone)
 .flatMap(move=>move.destroyedPieces??[]);

export function createConfirmedRemovalPresentation({getScope,eligible,present,pending,clear,consume,cue,cancelSound,isCurrent=()=>true}){
 const transitions=createDestructionTransitions();let scope=null,disposed=false,needsBaseline=true;
 const retire=()=>{clear();cancelSound();scope=null;needsBaseline=true;};
 return{
  update(game,{view=game,reset=false,frozen=false,sequence}={}){
   if(disposed)return;
   if(!game){retire();return;}
   const next=getScope(game),changed=scope!==null&&scope!==next;
   if(changed)retire();scope=next;
   const history=Boolean(view?.inHistoryMode),authoritative=isCurrent(game);
   const blocked=frozen||history||!eligible(game)||!authoritative;
   const transition=transitions.update(game,{reset:reset||changed||needsBaseline,frozen:frozen||!authoritative,sequence});
   const baseline=needsBaseline;needsBaseline=false;
   // History replay owns its own removal markers after the board render.
   // Retire live sound/pending state without erasing that settled surface.
   if(transition.clear&&!history||frozen||!authoritative)clear();
   if(transition.clear||blocked)cancelSound();
   pending(blocked?[]:pendingRecords(view));
   if(blocked||reset||changed||baseline||!transition.effects.length){consume(game,{sequence});return;}
   const own=scope;
   const current=()=>!disposed&&scope===own&&getScope(game)===own&&eligible(game)&&isCurrent(game);
   const committed=commitRemovalOnset({isCurrent:current,visual:()=>present(transition.effects),cue:()=>cue(game,{sequence})});
   if(!committed){clear();cancelSound();consume(game,{sequence});}
  },
  retire,
  dispose(){if(disposed)return;disposed=true;retire();},
 };
}

// Transport changes render the current board before the authoritative owner
// synchronously commits the confirmed removal presentation.
export function presentRemovalTransportChange({render,presentation,transport,gameId,view,frozen,change}){
 render({animatePanels:false,includeBoard:change?.type!=='optimistic_enqueue'});
 presentation.update(transport.getAuthoritativeGame(gameId),{view,frozen,sequence:transport.getLastEventSeq(gameId),reset:change?.baseline===true||change?.type==='optimistic_rollback'||change?.type==='history_mode_changed'||change?.type==='computer_display'});
}
