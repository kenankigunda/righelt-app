import { renderPlayerEmblem } from './player-emblem.js';
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const participantName = (person) =>
  person?.profile
    ? `<span class="player-name"><bdi>${escape(person.profile.displayName || person.profile.username)}</bdi></span><span class="player-username"><bdi>@${escape(person.profile.username)}</bdi></span>`
    : `<bdi>Guest player</bdi>`;
export const participantButton = (person, {key = person?.profile?.username || person?.identityId || "guest", side = "neutral"} = {}) => {
  const username = person?.profile?.username;
  return `<span class="participant-identity" data-player-side="${escape(side)}"><button class="participant-profile" data-profile-key="${escape(key)}" aria-expanded="false" data-action="${username ? "public-profile" : "guest-profile"}" ${username ? `data-username="${escape(username)}"` : `data-identity-id="${escape(person?.identityId)}"`}>${renderPlayerEmblem(username || "guest")}<span class="player-name-stack">${participantName(person)}</span></button><span class="player-profile-details" data-profile-slot="${escape(key)}"></span></span>`;
};
export const formatJoinedMonth = month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
  ? new Intl.DateTimeFormat("en", {year:"numeric",month:"long",timeZone:"UTC"}).format(new Date(`${month}-01T00:00:00Z`)) : "";

// Details live beside the name and survive unrelated shell updates. A closed
// row or account change invalidates an outstanding public-profile response.
export const createInlineProfiles = ({document = globalThis.document, fetcher = fetch} = {}) => {
  let state = null, generation = 0;
  const sync = () => {
    for (const [index, button] of [...document.querySelectorAll('[data-profile-key]')].entries()) {
      const open = state?.key === button.dataset.profileKey;
      button.setAttribute('aria-expanded', String(open));
      const slot = button.parentElement.querySelector('[data-profile-slot]');
      if (!slot) continue;
      slot.id = `player-profile-details-${index}`;button.setAttribute("aria-controls",slot.id);
      const markup = open ? `<span data-testid="public-profile" role="status">${escape(state.text)}</span>` : '';
      if (slot.innerHTML === markup) continue;
      const from = slot.getBoundingClientRect().height;
      slot.getAnimations?.().forEach(animation => animation.cancel());
      slot.innerHTML = markup;
      const to = slot.getBoundingClientRect().height;
      if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches && from !== to) slot.animate?.([{height:`${from}px`},{height:`${to}px`}],{duration:180,easing:'ease-out'});
    }
  };
  const close = () => {generation++;state = null;sync();};
  return {close,sync,async open(username, source) {
    const key = source.dataset.profileKey;
    if (state?.key === key) {close();return;}
    const marker = ++generation;
    state = {key,text:username ? 'Loading…' : 'Playing as a guest.'};sync();
    if (!username) return;
    try {
      const response = await fetcher(`/api/profiles/${encodeURIComponent(username)}`,{cache:'no-store'});
      const profile = await response.json();
      if (marker !== generation) return;
      if (!response.ok) throw Error('unavailable');
      const joined = formatJoinedMonth(profile.joinedMonth);
      state.text = joined ? `Joined ${joined}` : 'Righelt player';sync();
    } catch {
      if (marker === generation) {state.text = 'Could not load. Close and try again.';sync();}
    }
  }};
};
