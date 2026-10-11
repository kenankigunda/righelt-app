import { createAccountDialog } from "/apps/web/shell/account-dialog.js";
// Only the controller boundary is controlled; rendering, focus and CSS are production code.
let generation = 0;
const session = { authenticated: false, account: null };
const controller = {
  snapshot: () => ({ session, generation, busy: false, pendingLogout: false }),
  lookupUsername: async (username, { signal } = {}) => {
    const response = await fetch(
      `/lookup?username=${encodeURIComponent(username)}`,
      { signal },
    );
    if (!response.ok)
      throw Object.assign(new Error("Unavailable"), {
        code: "temporarily_unavailable",
      });
    return response.json();
  },
  act: async () => {
    throw Object.assign(new Error("Unavailable"), {
      code: "temporarily_unavailable",
    });
  },
  logout: async () => {
    generation++;
    session.authenticated = false;
  },
  updateAccount: async () => {},
};
const dialog = createAccountDialog({
  controller,
  fetcher: async () =>
    new Response(JSON.stringify([]), {
      headers: { "Content-Type": "application/json" },
    }),
});
document
  .querySelector("button")
  .addEventListener("click", () => dialog.open("login"));
window.accountFixture = {
  open: (mode) => dialog.open(mode),
  close: () => dialog.close(),
  transition: () => dialog.onTransition({ owner: {} }),
};
window.fixtureReady = true;
