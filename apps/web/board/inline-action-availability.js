// This owner decorates only turn controls. It never decides whether a command
// is admissible, changes legality or releases another owner's disabled state.
export function createInlineActionAvailability() {
 const owned=new Set();
 const decorated=new Set();
 const decorate=(button,presentation)=>{
  const dataset=button.dataset??(button.dataset={});
  if(presentation.unavailable)dataset.mutationUnavailable='true';else delete dataset.mutationUnavailable;
  if(presentation.pulsing){
   dataset.mutationPulse='true';
   button.style?.setProperty?.('--surface-pulse-delay',`${-presentation.elapsedMs}ms`);
  }else{
   delete dataset.mutationPulse;
   button.style?.removeProperty?.('--surface-pulse-delay');
  }
 };
 return {
  owns:button=>owned.has(button),
  sync(root,presentation){
   const resolved=typeof presentation==='boolean'?{unavailable:presentation}:presentation??{};
   const blocked=Boolean(resolved.unavailable);
   const buttons=new Set(root?.querySelectorAll?.('[data-board-preview-action="pass"], [data-board-preview-action="end-turn"], [data-board-message-action="pass"], [data-board-message-action="end-turn"]')??[]);
   for(const button of owned)if(!buttons.has(button))owned.delete(button);
   for(const button of decorated)if(!buttons.has(button)){decorate(button,{});decorated.delete(button);}
   for(const button of buttons){
    decorate(button,resolved);
    decorated.add(button);
    if(blocked){if(!button.disabled){button.disabled=true;owned.add(button);}}
    else if(owned.delete(button)&&button.disabled)button.disabled=false;
   }
  },
  clear(){for(const button of decorated)decorate(button,{});owned.clear();decorated.clear();},
 };
}
