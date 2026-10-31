import {computerKindIcon} from './ui.js';
import { COMPUTER_PROFILES } from '../generated/packages/shared-types/src/computer-play.js';
import { loadingAttributes } from "./loading.js";
import { renderPlayerEmblem } from './player-emblem.js';
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const participantDisplayName = (person, fallback = 'Guest player') =>
  COMPUTER_PROFILES[person?.computerProfile]?.name || person?.profile?.displayName || person?.profile?.username || fallback;
export const participantName = (person, {inlineComputerBadge = false} = {}) =>
  person?.computerProfile && COMPUTER_PROFILES[person.computerProfile]
    ? `<span class="player-name">${COMPUTER_PROFILES[person.computerProfile].name}</span>${inlineComputerBadge ? computerKindIcon() : ''}`
    : person?.profile
    ? `<span class="player-name"><bdi>${escape(person.profile.displayName || person.profile.username)}</bdi></span><span class="player-username"><bdi>@${escape(person.profile.username)}</bdi></span>`
    : `<bdi>Guest player</bdi>`;
export const participantButton = (person, {key = person?.profile?.username || person?.identityId || "guest", side = "neutral", presence = "", displayName, accessibleName} = {}) => {
  if (person?.computerProfile && COMPUTER_PROFILES[person.computerProfile]) return `<span class="participant-identity" data-player-side="${escape(side)}"><span class="participant-profile participant-computer"${accessibleName ? ` role="group" aria-label="${escape(accessibleName)}"` : ''}>${renderPlayerEmblem(person.computerProfile)}<span class="player-name-stack">${participantName(person,{inlineComputerBadge:true})}</span><span class="connection-status-icon is-connected" role="img" aria-label="Computer player" title="Computer player"></span></span></span>`;
  const username = person?.profile?.username;
  const name = displayName === undefined ? participantName(person) : `<span class="player-name"><bdi>${escape(displayName)}</bdi></span>`;
  return `<span class="participant-identity" data-player-side="${escape(side)}"><button class="participant-profile" data-profile-key="${escape(key)}" aria-expanded="false" ${accessibleName ? `aria-label="${escape(accessibleName)}"` : ''} data-action="${username ? "public-profile" : "guest-profile"}" ${username ? `data-username="${escape(username)}"` : `data-identity-id="${escape(person?.identityId)}"`}>${renderPlayerEmblem(username || "guest")}<span class="player-name-stack">${name}</span>${presence}</button><span class="player-profile-details" data-profile-slot="${escape(key)}"></span></span>`;
};
export const formatJoinedMonth = month => /^\d{4}-(0[1-9]|1[0-2])$/.test(month)
  ? new Intl.DateTimeFormat("en", {year:"numeric",month:"long",timeZone:"UTC"}).format(new Date(`${month}-01T00:00:00Z`)) : "";

// Details live beside the name and survive unrelated shell updates. A closed
// row or account change invalidates an outstanding public-profile response.
export const createInlineProfiles = ({document = globalThis.document, fetcher = fetch} = {}) => {
  let state = null, generation = 0;
  const buttonUsername = (button, fallback) => button?.dataset.action === 'public-profile'
    ? button.dataset.username || null : button?.dataset.action === 'guest-profile' ? null : fallback;
  const loadProfile = async (username, marker) => {
    try {
      const response = await fetcher(`/api/profiles/${encodeURIComponent(username)}`,{cache:'no-store'});
      const profile = await response.json();
      if (marker !== generation || state?.username !== username) return;
      if (!response.ok) throw Error('unavailable');
      const joined = formatJoinedMonth(profile.joinedMonth);
      state.pending = false; state.text = joined ? `Joined ${joined}` : 'Righelt player';sync();
    } catch {
      if (marker === generation && state?.username === username) {state.pending = false; state.text = 'Could not load. Close and try again.';sync();}
    }
  };
  const sync = () => {
    const buttons = [...document.querySelectorAll('[data-profile-key]')];
    if (state) {
      const current = buttons.find(button => button.dataset.profileKey === state.key);
      const username = buttonUsername(current, state.username);
      if (username !== state.username) {
        const marker = ++generation;
        state = {key:state.key,username,pending:Boolean(username),text:username ? '' : 'Playing as a guest.'};
        if (username) void loadProfile(username,marker);
      }
    }
    for (const [index, button] of buttons.entries()) {
      const open = state?.key === button.dataset.profileKey;
      button.setAttribute('aria-expanded', String(open));
      const slot = button.parentElement.querySelector('[data-profile-slot]');
      if (!slot) continue;
      slot.id = `player-profile-details-${index}`;button.setAttribute("aria-controls",slot.id);
      const markup = open ? `<span data-testid="public-profile" role="status" ${state.pending ? loadingAttributes(`profile:${state.key}`, "This profile is taking a little longer to load.") : ""}>${escape(state.text)}</span>` : '';
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
    const current = [...document.querySelectorAll('[data-profile-key]')].find(button => button.dataset.profileKey === key) || source;
    username = buttonUsername(current,username);
    const marker = ++generation;
    state = {key,username,pending:Boolean(username),text:username ? '' : 'Playing as a guest.'};sync();
    if (username) await loadProfile(username,marker);
  }};
};
