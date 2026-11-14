const actionLabel = action => action === 'signin' ? 'Sign in' : action === 'reload' ? 'Reload' : 'Retry';
const entryGenerations=new WeakMap();

export const quietFieldDestinationNotice = ({transition,message}={}) => Boolean(
  message && transition?.type === 'game-entry' && ['covering','covered','revealing'].includes(transition.phase)
);

export const mountDestinationNotice = element => {
  entryGenerations.set(element,0);
  element.hidden=true;element.inert=true;element.setAttribute('inert','');element.setAttribute('aria-hidden','true');
};

export const retireDestinationNotice = (element,{quietField,documentObject=element.ownerDocument}={}) => {
  const active=documentObject?.activeElement,ownedFocus=Boolean(active&&element.contains(active));
  const generation=(entryGenerations.get(element)??0)+1;entryGenerations.set(element,generation);
  element.dataset.state=quietField?'exiting':'hidden';element.inert=true;element.setAttribute('inert','');element.setAttribute('aria-hidden','true');
  if(ownedFocus)active.blur?.();
  return {ownedFocus,generation};
};

export const createDestinationNoticeRetirementOwner = ({setTimeout,clearTimeout}) => {
  let owner=null;
  const cancel=()=>{if(owner)clearTimeout(owner.timer);owner=null;};
  return {
    cancel,
    schedule(element,generation,delay=140){
      cancel();
      const episode={element,generation,timer:null};
      episode.timer=setTimeout(()=>{
        if(owner!==episode||entryGenerations.get(element)!==generation||element.dataset.state!=='exiting')return;
        element.hidden=true;element.innerHTML='';element.dataset.state='hidden';owner=null;
      },delay);
      owner=episode;
      return episode;
    },
    owns:episode=>owner===episode,
  };
};

export const presentDestinationNotice = (element,{quietField,requestAnimationFrame}={}) => {
  const inactive=element.hidden||element.inert||element.hasAttribute('inert')||element.getAttribute('aria-hidden')==='true';
  const generation=(entryGenerations.get(element)??0)+1;entryGenerations.set(element,generation);
  element.dataset.state=quietField&&inactive?'entering':'visible';
  element.hidden=false;element.inert=false;element.removeAttribute('inert');element.removeAttribute('aria-hidden');
  if(element.dataset.state==='entering')requestAnimationFrame(()=>{if(entryGenerations.get(element)===generation&&!element.hidden&&!element.inert&&element.dataset.state==='entering')element.dataset.state='visible';});
  return element.dataset.state;
};

export const renderQuietFieldDestinationNotice = ({message,escapeHtml,icon,homeHref}) => {
  const action=message.action?`<button type="button" class="destination-load-field-action" data-destination-action="${escapeHtml(message.action)}">${icon(message.action==='signin'?'account':'rematch')}<span>${actionLabel(message.action)}</span></button>`:'';
  const home=message.home?`<a class="destination-load-field-action" data-destination-action="home" href="${escapeHtml(homeHref)}">${icon('home')}<span>Home</span></a>`:'';
  return `<div class="destination-load-field-content">
    <div class="destination-load-field-copy">
      <h2>${escapeHtml(message.heading??message.message)}</h2>
      ${message.support?`<p>${escapeHtml(message.support)}</p>`:''}
    </div>
    ${action||home?`<div class="destination-load-field-actions">${action}${home}</div>`:''}
  </div>`;
};
