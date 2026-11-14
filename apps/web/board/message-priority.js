export const BOARD_MESSAGE_PRIORITY=Object.freeze({
 GENERIC_INSTRUCTION:1,
 CONTEXT:2,
 SEMANTIC:3,
 REQUIRED_ACTION:4,
 BLOCKING:5,
});

const candidate=(value,priority,field)=>value==null?null:{value,priority,field};

export function isMeaningfulHistoryMessage(message){
 if(!message)return false;
 const text=String(message.text??'').trim();
 if(['History','Turn overview','Historical move details unavailable','Historical turn details unavailable'].includes(text))return false;
 if(message.coordinates?.length||message.rows?.length||message.actorName||message.action||message.actions?.length)return true;
 return Boolean(text);
}

// One owner chooses the visible Board message. Generic usage instructions
// yield to meaningful state, required actions, and blocking recovery.
export function resolveBoardMessageOwner({blocking=null,required=null,semantic=null,context=null,generic=null}={}){
 const candidates=[
  candidate(blocking,BOARD_MESSAGE_PRIORITY.BLOCKING,'prompt'),
  candidate(required,BOARD_MESSAGE_PRIORITY.REQUIRED_ACTION,'prompt'),
  candidate(semantic,BOARD_MESSAGE_PRIORITY.SEMANTIC,'context'),
  candidate(context,BOARD_MESSAGE_PRIORITY.CONTEXT,'context'),
  candidate(generic,BOARD_MESSAGE_PRIORITY.GENERIC_INSTRUCTION,'prompt'),
 ].filter(Boolean);
 const owner=candidates.sort((left,right)=>right.priority-left.priority)[0]??null;
 return {
  owner:owner?.priority??null,
  prompt:owner?.field==='prompt'?owner.value:null,
  context:owner?.field==='context'?owner.value:null,
 };
}
