// This owner decorates only turn controls. It never decides whether a command
// is admissible, changes legality or releases another owner's disabled state.
export function createInlineActionAvailability() {
 const owned=new Set();
 return {
  owns:button=>owned.has(button),
  sync(root,blocked){
   const buttons=new Set(root?.querySelectorAll?.('[data-board-preview-action="pass"], [data-board-preview-action="end-turn"], [data-board-message-action="pass"], [data-board-message-action="end-turn"]')??[]);
   for(const button of owned)if(!buttons.has(button))owned.delete(button);
   for(const button of buttons){
    if(blocked){if(!button.disabled){button.disabled=true;owned.add(button);}}
    else if(owned.delete(button)&&button.disabled)button.disabled=false;
   }
  },
  clear(){owned.clear();},
 };
}
