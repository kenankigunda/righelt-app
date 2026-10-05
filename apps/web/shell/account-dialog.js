import { USERNAME_LOOKUP_DEBOUNCE_MS } from "../generated/packages/shared-types/src/auth-policy.js";
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const messages = {
  invalid_input: "Check the fields. Usernames use 3–24 letters, digits or underscores; passwords need 8–128 characters and cannot be common passwords.",
  invalid_credentials: "The username or password is incorrect.",
  username_unavailable: "That username is taken. Choose another.",
  session_changed: "Your session changed. Please try again.",
  identity_mismatch: "Your session changed. Please sign in again.",
  rate_limited: "Too many attempts. Wait before trying again.",
  temporarily_unavailable: "The service is temporarily unavailable. Your entries are still here; please try again.",
  logout_pending: "Sign-out pending. Reconnect to finish signing out.",
  upgrade_required: "Please refresh to update Righelt.",
};
export const canonicalEntryUsername = (value) => String(value ?? "").replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "").toLowerCase();
export const validEntryUsername = (value) => /^[a-z0-9_]{3,24}$/.test(canonicalEntryUsername(value));
export const createAccountDialog = ({
  controller, document = globalThis.document, onComplete = () => {},
  onTutorial = () => {}, getSiteKey = () => null, timers = globalThis,
} = {}) => {
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog";
  dialog.dataset.testid = "account-dialog";
  dialog.setAttribute("aria-labelledby", "account-title");
  document.body.append(dialog);
  let mode = "entry", entryMode = "automatic", lookupState = "idle", lookupName = "", resolvedEntryMode = null,
    lookupTimer = null, lookupAbort = null, lookupRevision = 0,
    trigger = null, pending = null, values = {}, challengeToken = "", widget = null,
    flow = 0, pendingLogoutGeneration = null, owner = {};
  const status = (text) => {
    const target = dialog.querySelector("[data-account-status]");
    if (target) target.textContent = text;
  };
  const credentialMode = () => mode !== "entry" ? mode : entryMode === "create" || resolvedEntryMode === "register" ? "register" : "login";
  const clearChallenge = () => {
    challengeToken = "";
    if (widget !== null) globalThis.turnstile?.remove(widget);
    widget = null;
  };
  const invalidateLookup = () => {
    lookupRevision++;
    timers.clearTimeout(lookupTimer);
    lookupTimer = null;
    lookupAbort?.abort();
    lookupAbort = null;
  };
  const input = (name, label, { secret = false, autocomplete = "", value = "" } = {}) =>
    `<label for="account-${name}">${label}</label><div class="account-input-row"><input id="account-${name}" name="${name}" type="${secret ? "password" : "text"}" required autocomplete="${autocomplete}" ${name === "username" ? 'autocapitalize="none" spellcheck="false"' : ""} value="${escapeHtml(value)}">${secret ? `<button type="button" class="secondary" data-toggle="${name}" aria-label="Show ${label.toLowerCase()}">Show</button>` : ""}</div>`;
  // Unfurl and change modes in place. Autofill, selection and focus retain their
  // native input nodes; a lookup completion must never replace a typed password.
  const updateEntry = ({ resetPassword = false } = {}) => {
    if (mode !== "entry") return;
    const form = dialog.querySelector("form");
    if (!form) return;
    form.dataset.lookupState = lookupState;
    form.dataset.entryMode = entryMode;
    const create = credentialMode() === "register";
    const expanded = entryMode === "create" || ["available", "taken"].includes(lookupState);
    const section = dialog.querySelector("[data-password-section]");
    section.hidden = !expanded;
    const password = dialog.querySelector('[name="password"]');
    password.disabled = !expanded;
    password.autocomplete = create ? "new-password" : "current-password";
    if (resetPassword) {
      password.value = "";
      password.type = create ? "text" : "password";
      const toggle = dialog.querySelector('[data-toggle="password"]');
      toggle.textContent = create ? "Hide" : "Show";
      toggle.setAttribute("aria-label", `${create ? "Hide" : "Show"} password`);
    }
    dialog.querySelector("[data-entry-heading]").textContent = create ? "Create an account" : "Enter password";
    const submit = dialog.querySelector("button[type=submit]");
    submit.hidden = !expanded;
    submit.disabled = create && lookupState !== "available";
    submit.textContent = create ? "Create account & continue" : "Sign in";
    dialog.querySelector("[data-create]").hidden = create && expanded;
    dialog.querySelector("[data-signin]").hidden = !create;
    dialog.querySelector("[data-create-notice]").hidden = !create;
    dialog.querySelector("[data-existing-hint]").hidden = create;
    dialog.querySelector("[data-lookup-retry]").hidden = lookupState !== "error";
    if (entryMode === "create" && lookupState === "taken") status(messages.username_unavailable);
  };
  const render = () => {
    clearChallenge();
    const session = controller.snapshot().session;
    let body = "", title = "Pick up your games anywhere";
    if (mode === "account") {
      title = "Account";
      body = `<p><bdi>${escapeHtml(session.account?.displayName)}</bdi> <span class="small">@${escapeHtml(session.account?.username)}</span></p><label for="account-displayName">Display name</label><input id="account-displayName" name="displayName" autocomplete="nickname" value="${escapeHtml(session.account?.displayName)}"><label for="account-view">View preference</label><select id="account-view" name="view"><option value="focused" ${session.account?.preferences?.view !== "explanatory" ? "selected" : ""}>Focused</option><option value="explanatory" ${session.account?.preferences?.view === "explanatory" ? "selected" : ""}>Explanatory</option></select><button type="submit">Save account settings</button><p data-testid="tutorial-status">Tutorial: ${escapeHtml(session.account?.preferences?.tutorial || "new")}</p><button type="button" data-tutorial>Replay tutorial</button><button type="button" data-mode="password">Change password</button><button type="button" data-mode="login">Switch account</button><button type="button" data-logout>Sign out</button>`;
    } else if (mode === "password") {
      title = "Change password";
      body = input("newPassword", "New password", { secret: true, autocomplete: "new-password" }) + '<p class="small">Use 8–128 characters. Spaces and password managers are welcome.</p><p>Changing your password signs you out on other devices.</p><div data-challenge></div><button type="submit">Change password</button>';
    } else {
      body = '<p>Enter your username to sign in or create an account.</p>' + input("username", "Username", { autocomplete: "username", value: values.username || "" }) +
        '<section data-password-section hidden><h3 data-entry-heading>Enter password</h3>' + input("password", "Password", { secret: true, autocomplete: "current-password" }) +
        '<p class="small" data-create-notice hidden>Save your password. If you forget it and are signed out everywhere, you’ll need a new account.</p><p class="small" data-existing-hint>Not your account? Choose a different username to create a new one.</p><details data-forgot hidden><summary>Forgot password?</summary><p>On another signed-in device, open Account → Change password. If you are signed out everywhere, you’ll need a new account. Your existing games remain with your original account.</p><button type="button" class="secondary" data-new-username>Choose another username</button></details></section><div data-challenge></div><button type="submit" hidden>Sign in</button><button type="button" class="secondary" data-create>Create account</button><button type="button" class="secondary" data-signin hidden>Sign in</button><button type="button" class="secondary" data-lookup-retry hidden>Try again</button>';
    }
    dialog.innerHTML = `<form class="account-form"><h2 id="account-title" tabindex="-1">${title}</h2>${body}<p class="account-status" role="status" aria-live="polite" data-account-status></p><button type="button" class="secondary" data-cancel>Cancel</button></form>`;
    updateEntry({ resetPassword: true });
    const marker = flow;
    queueMicrotask(() => { if (marker === flow && dialog.open) dialog.querySelector("input, #account-title")?.focus(); });
  };
  const checkUsername = async ({ focusPassword = false } = {}) => {
    if (mode !== "entry") return;
    const field = dialog.querySelector('[name="username"]');
    const raw = field?.value || "", canonical = canonicalEntryUsername(raw);
    if (canonical !== canonicalEntryUsername(values.username)) updateEntry({ resetPassword: true });
    values.username = raw;
    invalidateLookup();
    if (!validEntryUsername(raw)) {
      lookupState = "idle";
      updateEntry();
      status("Use 3–24 letters, digits or underscores for your username.");
      return;
    }
    const revision = lookupRevision, marker = flow, selectedMode = entryMode, generation = controller.snapshot().generation;
    lookupName = canonical;
    lookupState = "pending";
    lookupAbort = new AbortController();
    updateEntry();
    status("Checking username…");
    try {
      const result = await controller.lookupUsername(raw, { signal: lookupAbort.signal });
      if (marker !== flow || revision !== lookupRevision || !dialog.open || selectedMode !== entryMode || generation !== controller.snapshot().generation || canonical !== canonicalEntryUsername(field.value)) return;
      if (typeof result.exists !== "boolean") throw new Error("invalid_lookup_response");
      const previousMode = credentialMode();
      resolvedEntryMode = result.exists ? "login" : "register";
      lookupState = result.exists ? "taken" : "available";
      status("");
      updateEntry({ resetPassword: previousMode !== credentialMode() });
      if (focusPassword && !(entryMode === "create" && result.exists)) dialog.querySelector('[name="password"]')?.focus();
    } catch (error) {
      if (marker !== flow || revision !== lookupRevision || !dialog.open || generation !== controller.snapshot().generation) return;
      lookupState = "error";
      updateEntry();
      status(messages[error.code] || "Could not check this username. Try again.");
    }
  };
  const changeEntryMode = (next, empty = false) => {
    invalidateLookup();
    clearChallenge();
    flow++;
    owner = {};
    entryMode = next;
    const field = dialog.querySelector('[name="username"]');
    if (empty && field) field.value = "";
    values.username = field?.value || "";
    lookupState = "idle";
    lookupName = ""; resolvedEntryMode = null;
    status("");
    dialog.querySelector("[data-forgot]").hidden = true;
    updateEntry({ resetPassword: true });
    if (validEntryUsername(values.username)) {
      if (next === "create") dialog.querySelector('[name="password"]')?.focus();
      void checkUsername({ focusPassword: next !== "create" });
    } else field?.focus();
  };
  const close = () => {
    pendingLogoutGeneration = null;
    invalidateLookup();
    flow++;
    owner = {};
    pending = null;
    values = {};
    clearChallenge();
    dialog.close();
    dialog.replaceChildren();
    const action = trigger?.closest?.("[data-action]")?.getAttribute("data-action");
    const restored = trigger?.isConnected ? trigger : action ? document.querySelector(`[data-action="${CSS.escape(action)}"]`) : document.querySelector('[data-action="account-open"]');
    restored?.focus?.();
  };
  const open = (next = "login", intent = null, source = null) => {
    invalidateLookup();
    flow++;
    owner = {};
    pending = intent;
    trigger = source || (document.activeElement !== document.body ? document.activeElement : null);
    values = {};
    mode = ["account", "password"].includes(next) ? next : "entry";
    entryMode = next === "register" ? "create" : "automatic";
    lookupState = "idle";
    lookupName = ""; resolvedEntryMode = null;
    const snapshot = controller.snapshot();
    pendingLogoutGeneration = snapshot.pendingLogout && !snapshot.session.authenticated ? snapshot.generation : null;
    if (mode === "account" && !snapshot.session.authenticated) mode = "entry";
    render();
    if (!dialog.open) dialog.showModal();
  };
  const complete = () => { const intent = pending; close(); onComplete(intent); };
  const challenge = async () => {
    const marker = flow,
      sitekey = getSiteKey();
    if (widget !== null && globalThis.turnstile) {
      globalThis.turnstile.reset(widget);
      challengeToken = "";
      return;
    }
    if (!sitekey) {
      status(
        "Verification is temporarily unavailable. Please try again later.",
      );
      return;
    }
    try {
      if (!globalThis.turnstile)
        await new Promise((resolve, reject) => {
          let script = document.querySelector("script[data-turnstile]");
          if (!script) {
            script = document.createElement("script");
            script.src =
              "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
            script.dataset.turnstile = "true";
            document.head.append(script);
          }
          script.addEventListener("load", resolve, { once: true });
          script.addEventListener("error", reject, { once: true });
          setTimeout(() => reject(new Error("challenge_timeout")), 10000);
        });
      if (marker !== flow || !dialog.open) return;
      const action =
        { register: "register", login: "login" }[credentialMode()] ||
        "change";
      widget = globalThis.turnstile.render(
        dialog.querySelector("[data-challenge]"),
        {
          sitekey,
          action,
          callback: (token) => {
            if (marker === flow) challengeToken = token;
          },
          "expired-callback": () => {
            challengeToken = "";
          },
          "error-callback": () => {
            challengeToken = "";
            status("Verification is unavailable. Please try again.");
          },
        },
      );
    } catch {
      if (marker === flow)
        status("Verification is unavailable. Please try again.");
    }
  };
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && mode === "entry" && event.target.name === "username") {
      event.preventDefault();
      void checkUsername({ focusPassword: true });
      return;
    }
    if (event.key !== "Tab") return;
    const nodes = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary,[tabindex="0"]')].filter(node => !node.closest("[hidden]"));
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  dialog.addEventListener("input", (event) => {
    if (mode !== "entry" || event.target.name !== "username") return;
    const previous = canonicalEntryUsername(values.username);
    values.username = event.target.value;
    if (previous === canonicalEntryUsername(values.username)) return;
    invalidateLookup();
    clearChallenge();
    flow++;
    owner = {};
    lookupState = "idle";
    lookupName = ""; resolvedEntryMode = null;
    status("");
    dialog.querySelector("[data-forgot]").hidden = true;
    updateEntry({ resetPassword: true });
    if (validEntryUsername(values.username)) lookupTimer = timers.setTimeout(() => void checkUsername(), USERNAME_LOOKUP_DEBOUNCE_MS);
  });
  dialog.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-cancel")) { close(); return; }
    if (button.hasAttribute("data-create")) { changeEntryMode("create"); return; }
    if (button.hasAttribute("data-signin")) { changeEntryMode("automatic"); return; }
    if (button.hasAttribute("data-new-username")) { changeEntryMode("create", true); return; }
    if (button.hasAttribute("data-lookup-retry")) { void checkUsername(); return; }
    if (button.dataset.mode) {
      invalidateLookup(); flow++; owner = {};
      mode = button.dataset.mode === "login" ? "entry" : button.dataset.mode;
      entryMode = "automatic"; lookupState = "idle"; lookupName = ""; resolvedEntryMode = null; values = {};
      render(); return;
    }
    if (button.dataset.toggle) {
      const field = dialog.querySelector(`[name="${button.dataset.toggle}"]`);
      field.type = field.type === "password" ? "text" : "password";
      button.textContent = field.type === "password" ? "Show" : "Hide";
      button.setAttribute("aria-label", `${button.textContent} ${button.dataset.toggle === "newPassword" ? "new password" : "password"}`);
      return;
    }
    if (button.hasAttribute("data-tutorial")) { close(); onTutorial(); return; }
    if (button.hasAttribute("data-logout")) {
      const marker = flow;
      await controller.logout();
      if (marker !== flow) return;
      close(); onComplete(null);
    }
  });
  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    if (controller.snapshot().busy) return;
    // Native autofill can change values without an input event. Revalidate its
    // exact username before credential dispatch, without trusting old lookup.
    if (mode === "entry") {
      const current = canonicalEntryUsername(dialog.querySelector('[name="username"]').value);
      if (current !== lookupName || !["available", "taken"].includes(lookupState)) { await checkUsername({ focusPassword: true }); return; }
      if (entryMode === "create" && lookupState === "taken") { status(messages.username_unavailable); return; }
    }
    if (!form.reportValidity()) return;
    const marker = flow, operationOwner = owner, operation = credentialMode();
    const data = Object.fromEntries(new FormData(form));
    const buttons = [...form.querySelectorAll("button[type=submit]")];
    buttons.forEach(b => { b.disabled = true; });
    status("Working…");
    try {
      if (mode === "account") {
        await controller.updateAccount({ displayName: data.displayName, preferences: { view: data.view } });
        if (marker === flow && dialog.open) { render(); status("Account settings saved."); onComplete(null); }
        return;
      }
      const token = challengeToken ? { challengeToken } : {};
      challengeToken = "";
      await controller.act(operation, operation === "password" ? { newPassword: data.newPassword, ...token } : { username: data.username, password: data.password, ...token }, operationOwner);
      if (marker !== flow || !dialog.open) return;
      complete();
    } catch (error) {
      if (marker !== flow || !dialog.open) return;
      if (error.code === "username_unavailable" && operation === "register") {
        entryMode = "create"; lookupState = "taken";
        updateEntry({ resetPassword: true });
      }
      if (error.code === "invalid_credentials" && operation === "login") dialog.querySelector("[data-forgot]").hidden = false;
      status(messages[error.code] || "We could not confirm the result. Check your connection and account status before trying again.");
      if (error.body?.challengeRequired || widget !== null) await challenge();
    } finally {
      if (marker === flow) { buttons.forEach(b => { b.disabled = false; }); updateEntry(); }
    }
  });
  const refreshSession = () => {
    if (!dialog.open || mode !== "account") return;
    const node = dialog.querySelector('[data-testid="tutorial-status"]');
    if (node) node.textContent = `Tutorial: ${controller.snapshot().session.account?.preferences?.tutorial || "new"}`;
  };
  return {
    open, close, refreshSession,
    onTransition: ({ owner: transitionOwner, completedLogoutGeneration } = {}) => {
      if (dialog.open && pendingLogoutGeneration !== null && completedLogoutGeneration === pendingLogoutGeneration) { pendingLogoutGeneration = null; return; }
      if (dialog.open && transitionOwner !== owner) close();
    },
    isOpen: () => dialog.open, element: dialog,
  };
};
