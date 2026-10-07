// Shared source-linked motion. The exit copy is decorative so closing a dialog
// releases its focus trap and scroll lock immediately, even during animation.
export const overlaySourceFrames = (surface, source) => {
  if (!source || !surface.width || !surface.height || !source.width || !source.height) return null;
  const x = source.left + source.width / 2 - surface.left - surface.width / 2;
  const y = source.top + source.height / 2 - surface.top - surface.height / 2;
  const scale = Math.max(.08, Math.min(1, source.width / surface.width, source.height / surface.height));
  return [{transform:`translate(${x}px, ${y}px) scale(${scale})`,opacity:0}, {transform:'translate(0px, 0px) scale(1)',opacity:1}];
};
const options = {duration:220,easing:'cubic-bezier(.2,.75,.25,1)'};
const sourceRect = (source, view) => {
  const target = source?.closest?.('.opponent-choice,.mini-board-card') || source;
  const rect = target?.isConnected && target.getBoundingClientRect?.();
  return rect && rect.bottom > 0 && rect.top < view.innerHeight && rect.right > 0 && rect.left < view.innerWidth ? rect : null;
};
export const animateOverlayEntry = (element, source) => {
  const view = element.ownerDocument?.defaultView;
  if (!view || view.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || !element.animate) return null;
  const frames = overlaySourceFrames(element.getBoundingClientRect(), sourceRect(source, view));
  return frames ? element.animate(frames, options) : null;
};
export const animateOverlayExit = (element, source) => {
  const document = element.ownerDocument, view = document?.defaultView;
  if (!view || view.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches || !element.animate) return;
  const rect = element.getBoundingClientRect();
  const frames = overlaySourceFrames(rect, sourceRect(source, view));
  if (!frames) return;
  const copy = element.cloneNode(true);
  copy.removeAttribute('id');copy.removeAttribute('aria-labelledby');copy.setAttribute('aria-hidden','true');copy.inert = true;
  // Decorative copies must never duplicate live control identities.
  [copy, ...copy.querySelectorAll('*')].forEach(node => {
    for (const attribute of [...node.attributes]) {
      if (attribute.name === 'id' || attribute.name === 'data-testid' || attribute.name === 'data-action') node.removeAttribute(attribute.name);
    }
  });
  copy.classList.add('overlay-exit-copy');
  Object.assign(copy.style,{position:'fixed',inset:'auto',left:`${rect.left}px`,top:`${rect.top}px`,width:`${rect.width}px`,height:`${rect.height}px`,maxHeight:'none',margin:'0',boxSizing:'border-box',pointerEvents:'none',zIndex:'2147483646'});
  document.body.append(copy);
  const originalScroll = element.querySelector('.modal-content');
  if (originalScroll) copy.querySelector('.modal-content').scrollTop = originalScroll.scrollTop;
  const animation = copy.animate([...frames].reverse(), options);
  animation.finished.catch(()=>{}).finally(()=>copy.remove());
};
