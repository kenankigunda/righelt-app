// Presentation only: neither the logo's turn nor the live turn chooses action color.
export const BRAND_QUIET_MS = 9000;
export const BRAND_MOVE_MS = 360;
const normalizeSide = (side) => side === "p2" || side === "Player 2" ? "blue" : side === "p1" || side === "Player 1" ? "red" : null;

export const resolveActionAffiliation = ({ pendingSide, game, identityId, selfPlaySide = "p1" } = {}) => {
  const pending = normalizeSide(pendingSide);
  if (pending) return pending;
  if (!identityId || !game) return "red";
  const ownsRed = game.player1?.identityId === identityId;
  const ownsBlue = game.player2?.identityId === identityId;
  if (ownsRed && ownsBlue) return normalizeSide(selfPlaySide) ?? "red";
  return ownsBlue ? "blue" : "red";
};

// All lettering is vector geometry, so counters and the peaked cap survive scaling.
// The t cap base and stem both occupy x=459..488; its crossbar is separate.
export const renderWordmark = ({ player = "red", cell = 0 } = {}) => `
<svg class="brand-wordmark" data-brand-wordmark data-player="${player === "blue" ? "blue" : "red"}" data-cell="${cell === 1 ? 1 : cell === 2 ? 2 : 0}" viewBox="0 0 755 151" role="img" aria-label="Righelt" focusable="false">
  <g class="brand-letters">
    <path class="brand-r" fill-rule="evenodd" stroke-linejoin="round" d="M4 20H51C109 20 119 74 77 88L107 126H71L47 93H34V126H4Z M34 44V69H49C71 69 71 44 49 44Z"/>
    <path d="M113 52H143V126H113Z"/>
    <path class="brand-dot-outline" d="M128 11L147 30L128 49L109 30Z"/>
    <path class="brand-current" d="M128 19L139 30L128 41L117 30Z"/>
    <path fill-rule="evenodd" d="M203 52H232V117C232 156 183 160 153 139L168 119C188 133 203 128 203 113C175 136 146 109 148 85C150 54 180 39 203 59Z M190 71C168 71 168 101 190 101C212 101 212 71 190 71Z"/>
    <path class="brand-current" fill-rule="evenodd" d="M240 20H269V60L289 42L324 72V109L330 115L313 133L297 118V90L283 76L269 90V126H240Z M313 108L304 117L313 126L322 117Z"/>
    <path fill-rule="evenodd" d="M415 94H361C366 111 382 111 394 100L412 117C383 143 333 126 332 89C332 40 419 35 415 94Z M361 78H387C384 62 365 62 361 78Z"/>
    <path d="M421 20H449V126H421Z"/>
    <path class="brand-t-cap" d="M459 43L473.5 29L488 43V55H459Z"/>
    <path class="brand-t-stem" d="M459 72H488V101Q488 109 504 112V126H482Q459 126 459 103Z"/>
    <path class="brand-t-crossbar" d="M447 55H505V73H447Z"/>
  </g>
  <g class="brand-motif" aria-hidden="true">
    <path data-brand-cell="0" d="M525 81L562 44L599 81L562 118Z"/>
    <path data-brand-cell="1" d="M599 81L636 44L673 81L636 118Z"/>
    <path data-brand-cell="2" d="M673 81L710 44L747 81L710 118Z"/>
    <circle class="brand-piece" cx="562" cy="81" r="17"/>
  </g>
</svg>`;

export const createBrandController = ({ documentObject = document, windowObject = window } = {}) => {
  const motion = windowObject.matchMedia("(prefers-reduced-motion: reduce)");
  let home = false;
  let timer = null;
  let player = "red";
  let cell = 0;
  let destroyed = false;
  const paint = () => {
    for (const element of documentObject.querySelectorAll("[data-brand-wordmark]")) {
      element.setAttribute("data-player", player);
      element.setAttribute("data-cell", String(cell));
      element.style.setProperty("--brand-move-duration", `${BRAND_MOVE_MS}ms`);
    }
  };
  const reconcile = () => {
    if (timer !== null) windowObject.clearTimeout(timer);
    timer = null;
    if (motion.matches || !home) { player = "red"; cell = 0; }
    paint();
    if (!destroyed && home && !motion.matches && !documentObject.hidden) {
      timer = windowObject.setTimeout(() => {
        timer = null;
        player = player === "red" ? "blue" : "red";
        cell = (cell + 1) % 3;
        reconcile();
      }, BRAND_QUIET_MS + BRAND_MOVE_MS);
    }
  };
  documentObject.addEventListener("visibilitychange", reconcile);
  motion.addEventListener("change", reconcile);
  return {
    getState: () => ({ player, cell }),
    setHome(value) {
      if (home !== value) { home = value; reconcile(); }
    },
    destroy() {
      destroyed = true;
      home = false;
      reconcile();
      documentObject.removeEventListener("visibilitychange", reconcile);
      motion.removeEventListener("change", reconcile);
    },
  };
};

// The decorative grid uses the actual motif geometry rather than an unrelated CSS pitch.
export const createBrandGrid = ({ documentObject = document, windowObject = window } = {}) => {
  const ns='http://www.w3.org/2000/svg';
  const grid=documentObject.createElementNS(ns,'svg');grid.classList.add('brand-grid');grid.setAttribute('aria-hidden','true');
  grid.innerHTML='<defs><pattern id="brand-background-grid" patternUnits="userSpaceOnUse"><path fill="none" stroke="#252b2d" stroke-opacity=".14"/></pattern></defs><rect width="100%" height="100%" fill="url(#brand-background-grid)"/>';
  documentObject.body.prepend(grid);
  let frame=null, previousGeometry=null;
  const setAttribute=(element,name,value)=>{
    const next=String(value);
    if(element.getAttribute(name)!==next)element.setAttribute(name,next);
  };
  const setStyle=(name,value)=>{
    if(grid.style.getPropertyValue(name)!==value)grid.style.setProperty(name,value);
  };
  const update=()=>{
    frame=null;
    const logo=documentObject.querySelector('[data-brand-wordmark]');
    if(!logo)return;
    const r=logo.getBoundingClientRect(), geometry=[r.left,r.top,r.width,r.height];
    // App subtrees update frequently without moving the logo. Rewriting an SVG
    // pattern can invalidate its full-screen raster even when values are equal.
    if(previousGeometry?.every((value,index)=>value===geometry[index]))return;
    previousGeometry=geometry;
    setStyle('--grid-origin-x',`${r.left+r.width*.72}px`);
    setStyle('--grid-origin-y',`${Math.max(0,r.top+r.height*.5)}px`);
    const scale=r.width/755, pitch=74*scale, half=pitch/2;
    const pattern=grid.querySelector('pattern'), path=pattern.querySelector('path');
    setAttribute(pattern,'width',pitch);setAttribute(pattern,'height',pitch);
    setAttribute(pattern,'x',r.left+525*scale);setAttribute(pattern,'y',r.top+44*scale);
    setAttribute(path,'d',`M0 ${half}L${half} 0L${pitch} ${half}L${half} ${pitch}Z`);
    setAttribute(path,'stroke-width',Math.max(.65,2*scale));
  };
  const schedule=()=>{if(frame===null)frame=windowObject.requestAnimationFrame(update);};
  const observer=new windowObject.MutationObserver(schedule);observer.observe(documentObject.getElementById('app'),{childList:true,subtree:true});
  windowObject.addEventListener('resize',schedule);windowObject.addEventListener('scroll',schedule,{passive:true});schedule();
  return ()=>{observer.disconnect();windowObject.removeEventListener('resize',schedule);windowObject.removeEventListener('scroll',schedule);if(frame!==null)windowObject.cancelAnimationFrame(frame);grid.remove();};
};
