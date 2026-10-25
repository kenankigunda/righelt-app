export const resultSound = result => ({victory:'result-victory',defeat:'result-defeat',draw:'result-draw'}[result?.tone] ?? 'result');

export const renderResultMark = result => `<div class="result-mark" data-result-mark><svg viewBox="0 0 160 110" focusable="false" aria-hidden="true"><path class="result-stone" d="M53 95V64h13V49h13V33h13v16h13v15h13v31z"/><path class="result-ground" d="M38 102h94"/>${[-1,1].flatMap(direction=>[0,1].map(row=>`<path data-result-fragment="${direction}" class="result-fragment" d="M${direction<0?20+row*8:130-row*8} ${25+row*25}l5 -5h8l5 5v8l-5 5h-8l-5 -5z"/>`)).join('')}</svg><span class="result-perspective">${result.tone==='victory'?'Your side won':result.tone==='defeat'?'The other side won':result.tone==='draw'?'An even finish':'Game complete'}</span></div>`;

// An observed live finish owns one timeline. Repainting its result preserves
// elapsed time, while manual opening, hydration and reload never create one.
export function createResultPresentation({now=()=>performance.now(),reducedMotion=()=>globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false}={}) {
  let entry = null;
  const mounted = new WeakSet();
  const animations = new Set();
  const track = animation => {animations.add(animation);animation.onfinish=()=>animations.delete(animation);};
  return {
    enter(gameId,result) { for(const animation of animations)animation.cancel();animations.clear();entry = {gameId,tone:result.tone,startedAt:now()}; },
    clear() { entry = null;for(const animation of animations)animation.cancel();animations.clear(); },
    mount(root,gameId) {
      if (!root || mounted.has(root)) return;
      mounted.add(root);
      if (!entry || entry.gameId!==gameId || reducedMotion() || !['victory','defeat'].includes(entry.tone)) return;
      const victory=entry.tone==='victory',duration=victory?1000:650,elapsed=Math.max(0,now()-entry.startedAt);
      if(elapsed>=duration)return;
      const mark=root.querySelector('[data-result-mark]');
      if(!mark)return;
      const animation=mark.animate(victory?[{opacity:0,transform:'translateY(10px) scale(.94)'},{opacity:1,transform:'translateY(-3px) scale(1.02)',offset:.55},{opacity:1,transform:'none'}]:[{opacity:0,transform:'translateY(-4px)'},{opacity:1,transform:'none'}],{duration,easing:'cubic-bezier(.2,.7,.2,1)',fill:'both'});
      animation.currentTime=elapsed;
      track(animation);
      if(victory)for(const fragment of root.querySelectorAll('[data-result-fragment]')) {
        const direction=Number(fragment.dataset.resultFragment);
        const pulse=fragment.animate([{opacity:0,transform:`translate(${-direction*12}px,16px)`},{opacity:1,transform:`translate(${direction*3}px,-3px)`,offset:.6},{opacity:1,transform:'none'}],{duration,easing:'ease-out',fill:'both'});
        pulse.currentTime=elapsed;
        track(pulse);
      }
    },
  };
}
