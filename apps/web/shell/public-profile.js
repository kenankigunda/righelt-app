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
    : `<bdi>${escape(person?.identityId || "Unknown player")}</bdi>`;
export const participantButton = (person) =>
  person?.profile
    ? `<button class="secondary participant-profile" data-action="public-profile" data-username="${escape(person.profile.username)}">${participantName(person)}</button>`
    : participantName(person);
export const createPublicProfileDialog = ({
  document = globalThis.document,
  fetcher = fetch,
} = {}) => {
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog";
  dialog.dataset.testid = "public-profile";
  dialog.setAttribute("aria-labelledby", "public-profile-title");
  document.body.append(dialog);
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
  dialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-profile-close]")) close();
  });
  return {
    close,
    async open(username, source) {
      const marker = ++generation;
      trigger = source;
      dialog.innerHTML =
        '<h2 id="public-profile-title">Player profile</h2><p role="status">Loading…</p><button data-profile-close>Close</button>';
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
        dialog.innerHTML = `<h2 id="public-profile-title">Player profile</h2><p>${participantName({ profile })}</p><p>Joined ${escape(joined)}</p><button data-profile-close>Close</button>`;
        dialog.querySelector("button").focus();
      } catch {
        if (marker === generation)
          dialog.querySelector("[role=status]").textContent =
            "Could not load this profile. Close and try again.";
      }
    },
  };
};
