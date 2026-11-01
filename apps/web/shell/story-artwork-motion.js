// Initial native calibration follows the approved draw-back/slide reference.
// Dimensions/timing remain visual tuning, never readiness or operation clocks.
export const STORY_SWAP_DURATION = 760;
export const storyArtworkFrames = (step = 1) => {
 const direction=step<0?-1:1;
 return {
  outgoing:[{transform:'translateX(0%)',opacity:1,offset:0,easing:'cubic-bezier(.3,0,.6,1)'},{transform:`translateX(${6*direction}%)`,opacity:1,offset:.2,easing:'cubic-bezier(.35,0,.2,1)'},{transform:`translateX(${-112*direction}%)`,opacity:1,offset:1}],
  incoming:[{transform:`translateX(${112*direction}%)`,opacity:1,offset:0},{transform:`translateX(${118*direction}%)`,opacity:1,offset:.2,easing:'cubic-bezier(.25,.2,.2,1)'},{transform:'translateX(0%)',opacity:1,offset:1}],
 };
};

export function createStoryArtworkMotion({reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches,getStyle=node=>globalThis.getComputedStyle?.(node)}={}) {
 let active=[];
 const cancel=()=>{const previous=active;active=[];for(const animation of previous)animation.cancel();};
 return {
  cancel,
  swap(previous,selected,step){
   const transforms=[previous,selected].map(node=>node&&getStyle(node)?.transform);
   cancel();
   if(!previous||previous===selected||!previous.animate||!selected?.animate||reducedMotion())return;
   const {outgoing,incoming}=storyArtworkFrames(step);
   if(transforms[0]&&transforms[0]!=='none')outgoing[0].transform=transforms[0];
   if(transforms[1]&&transforms[1]!=='none')incoming[0].transform=transforms[1];
   const owned=[previous.animate(outgoing,{duration:STORY_SWAP_DURATION,easing:'linear',fill:'both'}),selected.animate(incoming,{duration:STORY_SWAP_DURATION,easing:'linear',fill:'both'})];
   active=owned;
   Promise.all(owned.map(animation=>animation.finished)).then(()=>{if(active===owned)cancel();},()=>{if(active===owned)cancel();});
  },
 };
}
