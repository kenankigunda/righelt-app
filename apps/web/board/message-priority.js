export const BOARD_MESSAGE_PRIORITY=Object.freeze({
 GENERIC_INSTRUCTION:1,
 CONTEXT:2,
 SEMANTIC:3,
 REQUIRED_ACTION:4,
 BLOCKING:5,
});

export const BOARD_MESSAGE_STRENGTH=Object.freeze({
 PLACEHOLDER:'placeholder',
 SEMANTIC:'semantic',
});

const candidate=(value,priority,field)=>value==null?null:{value,priority,field};

export function isMeaningfulHistoryMessage(message,strength=BOARD_MESSAGE_STRENGTH.SEMANTIC){
 return Boolean(message)&&strength===BOARD_MESSAGE_STRENGTH.SEMANTIC;
}

export function isBoardMessageResolution(value){
 return Boolean(value)&&Object.values(BOARD_MESSAGE_PRIORITY).includes(value.owner)
  &&Object.hasOwn(value,'prompt')&&Object.hasOwn(value,'context');
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
