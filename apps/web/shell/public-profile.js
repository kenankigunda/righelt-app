import { icon } from './ui.js';
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
    ? `<bdi>${escape(person.profile.displayName)}</bdi> <span class="small"><bdi>@${escape(person.profile.username)}</bdi></span>`
    : `<bdi>Guest player</bdi>`;
export const participantButton = (person) =>
  person?.profile
    ? `<button class="secondary participant-profile" data-action="public-profile" data-username="${escape(person.profile.username)}">${participantName(person)}</button>`
    : `<button class="participant-profile" data-action="guest-profile" data-identity-id="${escape(person?.identityId)}">${participantName(person)}</button>`;
export const createPublicProfileDialog = ({
  document = globalThis.document,
  fetcher = fetch,
} = {}) => {
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog";
  dialog.dataset.testid = "public-profile";
  dialog.setAttribute("aria-labelledby", "public-profile-title");
  document.body.append(dialog);
  let backdropPress = false;
  const outside = event => {const r=dialog.getBoundingClientRect();return event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom;};
  const heading = () => `<div class="account-dialog-heading"><h2 id="public-profile-title">Player profile</h2><button class="secondary account-close" data-profile-close aria-label="Close">${icon("close")}</button></div>`;
  let generation = 0,
    trigger;
  const close = () => {
    generation++;
    dialog.close();
    dialog.replaceChildren();
    if (trigger?.isConnected) trigger.focus();
  };
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("pointerdown",event=>{backdropPress=event.target===dialog && outside(event);});
  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-profile-close]") || backdropPress && event.target===dialog && outside(event)) close();
    backdropPress=false;
  });
  return {
    close,
    async open(username, source) {
      const marker = ++generation;
      trigger = source;
      dialog.innerHTML =
        `<div class="public-profile-content">${heading()}<p role="status">Loading…</p></div>`;
      if (!dialog.open) dialog.showModal();
      try {
        const response = await fetcher(
          `/api/profiles/${encodeURIComponent(username)}`,
          { cache: "no-store" },
        );
        const profile = await response.json();
        if (marker !== generation) return;
        if (!response.ok) throw Error("unavailable");
        const joined = /^\d{4}-\d{2}$/.test(profile.joinedMonth)
          ? new Intl.DateTimeFormat("en", {
              year: "numeric",
              month: "long",
              timeZone: "UTC",
            }).format(new Date(`${profile.joinedMonth}-01T00:00:00Z`))
          : "";
        dialog.innerHTML = `<div class="public-profile-content">${heading()}<p>${participantName({ profile })}</p><p class="small">Joined ${escape(joined)}</p></div>`;
        dialog.querySelector("button").focus();
      } catch {
        if (marker === generation)
          dialog.querySelector("[role=status]").textContent =
            "Could not load this profile. Close and try again.";
      }
    },
  };
};
