import { animateOverlayEntry, animateOverlayExit } from './overlay-motion.js';
import { lockOverlayScroll } from './overlay-scroll.js';
import { icon } from './ui.js';
import { renderPlayerEmblem } from './player-emblem.js';
import { createRenderGestureGate } from "./render-gesture.js";
import { evaluatePasswordRequirements, normalizeDisplayName } from "../generated/packages/shared-types/src/auth.js";
import { USERNAME_LOOKUP_DEBOUNCE_MS, USERNAME_LOOKUP_TIMEOUT_MS } from "../generated/packages/shared-types/src/auth-policy.js";
import { animateDialogSize } from "./dialog-size.js";
import { createAccountAutosave } from "./account-autosave.js";
import { renderInputAction } from "./input-action.js";
export const ACCOUNT_ENTRY_LAYOUT = "separate";
export const ACCOUNT_SIGNUP_PROFILE = "username-only";
// Play remains a supported entry contract; Account is also always in the header.
export const ACCOUNT_ENTRY_POINTS = "play";
export const ACCOUNT_HEADER_ENTRY = "always";
const LOGIN_HINT_DELAY_MS = 5000;
const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const messages = {
  invalid_input: "Usernames use 3–24 letters, digits or underscores. Passwords need 8–128 characters.",
  invalid_credentials: "The username or password is incorrect.",
  username_unavailable: "That username is taken. Choose another.",
  session_changed: "Your session changed. Please try again.",
  identity_mismatch: "Your session changed. Please sign in again.",
  rate_limited: "Too many attempts. Wait before trying again.",
  temporarily_unavailable: "The service is temporarily unavailable. Your entries are still here. Please try again.",
  logout_pending: "Sign-out pending. Reconnect to finish signing out.",
  upgrade_required: "Please refresh to update Righelt.",
};
export const canonicalEntryUsername = (value) => String(value ?? "").replace(/^[\t\n\v\f\r ]+|[\t\n\v\f\r ]+$/g, "").toLowerCase();
export const validEntryUsername = (value) => /^[a-z0-9_]{3,24}$/.test(canonicalEntryUsername(value));
export const createAccountDialog = ({
  controller, document = globalThis.document, onComplete = () => {},
  getSiteKey = () => null, timers = globalThis, fetcher = globalThis.fetch, onLayoutChange = () => {}, onSound = () => {},
} = {}) => {
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog";
  dialog.dataset.testid = "account-dialog";
  dialog.setAttribute("aria-labelledby", "account-title");
  document.body.append(dialog);
  const sizeAnimation = animateDialogSize(dialog);
  let autosave = null;
  let entryAnimation = null;
  let mode = "login", lookupState = "idle", lookupName = "", lookupRevealed = false,
    blocklist = null, blocklistFlight = null, blocklistFailed = false, passwordTouched = false,
    hintTimer = null, hintRevision = 0, lookupTimer = null, lookupAbort = null, lookupRevision = 0,
    trigger = null, pending = null, values = {}, challengeToken = "", widget = null,
    flow = 0, submittingFlow = null, pendingLogoutGeneration = null, owner = {}, backdropPress = false, discardPress = false;
  let releaseScroll = null;
  const phone = globalThis.matchMedia?.('(max-width:700px)');
  const isSettings = () => mode === 'account' || mode === 'password';
  const present = () => {
    dialog.classList.remove('is-closing');
    const flyout = isSettings();
    if(flyout && !dialog.open)onSound("flyout");
    dialog.dataset.presentation = flyout ? 'flyout' : 'modal';
    dialog.dataset.actionAffiliation = document.querySelector('#app')?.dataset?.actionAffiliation || 'red';
    const modal = !flyout || Boolean(phone?.matches);
    if (modal) releaseScroll ||= lockOverlayScroll(document);
    else {releaseScroll?.();releaseScroll = null;}
    const focused = document.activeElement;
    const position = {left:document.defaultView.scrollX,top:document.defaultView.scrollY,behavior:"instant"};
    if (dialog.open && dialog.matches?.(':modal') !== modal) dialog.close();
    if (!dialog.open) {
      if (modal || !dialog.show) dialog.showModal(); else dialog.show();
      if (!flyout) entryAnimation = animateOverlayEntry(dialog, trigger);
    }
    if (focused && dialog.contains?.(focused)) focused.focus({preventScroll:true});
    document.defaultView.scrollTo(position);
    if (document.documentElement?.dataset) document.documentElement.dataset.accountFlyout = String(flyout && !phone?.matches);
    onLayoutChange();
  };
  phone?.addEventListener('change', () => { if (dialog.open) present(); });
  const status = (text, state) => {
    const target = dialog.querySelector("[data-account-status]");
    if (target) { target.textContent = text; target.dataset.state = state; }
  };
  const credentialMode = () => mode;
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
  const input = (name, label, { secret = false, visible = false, autocomplete = "", value = "", optional = false, placeholder = "", inlineSave = false } = {}) =>
    `<label for="account-${name}">${label}</label><div class="${secret || inlineSave ? "input-with-action" : "account-input-row"}"><input id="account-${name}" name="${name}" type="${secret && !visible ? "password" : "text"}" ${optional ? "" : "required"} autocomplete="${autocomplete}" ${autocomplete === "new-password" ? 'aria-describedby="account-password-requirements"' : ""} ${name === "username" ? 'autocapitalize="none" spellcheck="false"' : ""} placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(value)}">${secret ? renderInputAction({ label: visible ? "Hide" : "Show", accessibleLabel: `${visible ? "Hide" : "Show"} ${label.toLowerCase()}`, action: "toggle-password", controls: `account-${name}` }) : inlineSave ? '<span class="account-autosave" data-state="idle"><span role="status" aria-live="polite" data-autosave-status>Autosaves</span>' + renderInputAction({ label: "Retry", action: "retry-account-save", controls: `account-${name}` }) + '</span>' : ""}</div>`;
  const checklist = () => '<ul class="account-password-requirements small" id="account-password-requirements" data-testid="password-requirements" aria-label="Password requirements"><li data-requirement="length">8–128 characters</li><li data-requirement="differentFromUsername">Different from your username</li><li data-requirement="notCommon">Not a common password</li></ul>';
  const feedbackGesture = createRenderGestureGate({ schedule: timers.setTimeout, cancel: timers.clearTimeout, render: () => {
    sizeAnimation.resume();
    updateLookup();
    updateRequirements();
  } });
  const updateRequirements = () => {
    if (!["register", "password"].includes(mode)) return;
    const field = dialog.querySelector(`[name="${mode === "password" ? "newPassword" : "password"}"]`);
    if (!field) return;
    const username = mode === "password" ? controller.snapshot().session.account?.username : dialog.querySelector('[name="username"]')?.value;
    const requirements = evaluatePasswordRequirements(field.value, username || "", blocklist);
    // Validation remains synchronous; only its visual feedback waits for release.
    if (feedbackGesture.defer({})) return requirements;
    for (const [key, label] of [["length", "8–128 characters"], ["differentFromUsername", "Different from your username"], ["notCommon", "Not a common password"]]) {
      const node = dialog.querySelector(`[data-requirement="${key}"]`);
      if (!node) continue;
      const state = !passwordTouched && !field.value ? "neutral" : requirements[key] === null ? "unavailable" : requirements[key] ? "met" : "unmet";
      node.dataset.state = state;
      node.textContent = `${{ neutral: "○", met: "✓", unmet: "✕", unavailable: "○" }[state]} ${label}${state === "unavailable" ? (blocklistFailed ? ": unavailable, checked when you submit" : ": checking") : state === "met" ? ": met" : state === "unmet" ? ": not met" : ""}`;
    }
    return requirements;
  };
  const loadBlocklist = () => {
    if (blocklist || blocklistFlight) return;
    blocklistFailed = false;
    const abort = new AbortController();
    let timeout;
    const loading = (async () => {
      const response = await fetcher("/generated/packages/shared-types/data/common-passwords.json", { cache: "no-cache", credentials: "same-origin", signal: abort.signal });
      if (!response.ok) throw new Error("blocklist_unavailable");
      const values = await response.json();
      if (!Array.isArray(values) || !values.every(value => typeof value === "string")) throw new Error("blocklist_unavailable");
      return new Set(values.map(value => value.normalize("NFC")));
    })();
    const deadline = new Promise((_, reject) => { timeout = timers.setTimeout(() => { abort.abort(); reject(new Error("blocklist_timeout")); }, USERNAME_LOOKUP_TIMEOUT_MS); });
    blocklistFlight = Promise.race([loading, deadline]).then(value => { blocklist = value; }, () => { blocklistFailed = true; }).finally(() => {
      timers.clearTimeout(timeout); blocklistFlight = null;
      // Resource completion only refreshes the current form's local values.
      // It never carries credentials, advances a form, or submits an action.
      if (dialog.open) updateRequirements();
    });
  };
  const updateLookup = () => {
    if (mode !== "register") return;
    const form = dialog.querySelector("form");
    if (form) form.dataset.lookupState = lookupState;
    if (feedbackGesture.defer({})) return;
    const target = dialog.querySelector("[data-username-status]");
    if (target) {
      // Keep the largest revealed row, including wrapped errors, for this form.
      // Computed height stays in CSS units under zoom.
      const height = Number.parseFloat(globalThis.getComputedStyle?.(target).height);
      if (lookupRevealed && height > 0 && target.style) target.style.minHeight = `${height}px`;
      if (lookupState !== "idle") lookupRevealed = true;
      target.dataset.revealed = String(lookupRevealed);
      target.dataset.state = lookupState;
      target.textContent = ({ idle: "", pending: "○ Checking username…", available: "✓ Username available.", taken: `✕ ${messages.username_unavailable}`, error: "○ Availability check is offline. You can still try creating your account." })[lookupState];
    }
  };
  const updateLoginHint = (show = false) => {
    const hint = dialog.querySelector("[data-existing-hint]");
    if (hint) hint.hidden = !show;
  };
  const cancelLoginHint = () => {
    hintRevision++;
    timers.clearTimeout(hintTimer);
    hintTimer = null;
    updateLoginHint();
  };
  const scheduleLoginHint = () => {
    cancelLoginHint();
    const username = dialog.querySelector('[name="username"]');
    const password = dialog.querySelector('[name="password"]');
    if (!username?.value.trim() || password?.value) return;
    const revision = hintRevision, marker = flow;
    hintTimer = timers.setTimeout(() => {
      hintTimer = null;
      if (revision !== hintRevision || marker !== flow || mode !== "login" || !dialog.open || document.activeElement === username || password?.value) return;
      updateLoginHint(true);
    }, LOGIN_HINT_DELAY_MS);
  };
  const render = () => {
    cancelLoginHint();
    clearChallenge(); passwordTouched = false;
    const session = controller.snapshot().session;
    let body = "", title = "Log in to start playing";
    const feedback = '<p class="account-status" role="status" aria-live="polite" data-account-status></p>';
    if (mode === "account") {
      title = "Account";
      body = input("displayName", "Display name", { autocomplete: "nickname", value: session.account?.displayName || "", optional: true, inlineSave: true }) + `<button type="button" data-mode="password">${icon('key')}Change password</button><button type="button" data-logout>${icon('exit')}Sign out</button><button type="button" class="secondary" data-discard-account hidden>Discard changes</button>`;
    } else if (mode === "password") {
      title = "Change password";
      body = input("newPassword", "New password", { secret: true, visible: true, autocomplete: "new-password" }) + checklist() + '<p>Changing your password signs you out on other devices.</p><div data-challenge></div><button type="submit">Change password</button><button type="button" class="secondary" data-mode="account">Back</button>';
    } else if (mode === "register") {
      title = "Create account";
      body = input("username", "Username", { autocomplete: "username", value: values.username || "" }) + '<p class="account-status account-username-status small" role="status" data-username-status></p>' + input("password", "Password", { secret: true, visible: true, autocomplete: "new-password" }) + checklist() + '<p class="small" data-create-notice>Save your password. If you forget it and are signed out everywhere, you’ll need a new account.</p><div data-challenge></div><button type="submit">Create account & continue</button><button type="button" class="secondary" data-signin>Back to sign in</button>';
    } else {
      body = input("username", "Username", { autocomplete: "username", value: values.username || "" }) + input("password", "Password", { secret: true, autocomplete: "current-password" }) + feedback + '<div class="account-help"><p data-existing-hint hidden>Don’t have a password? <a href="#create-account" data-create-link>Create a new account.</a></p><details data-forgot hidden><summary>Forgot password?</summary><p>On another signed-in device, open Account → Change password. If you are signed out everywhere, you’ll need a new account. Your existing games remain with your original account.</p><button type="button" class="secondary" data-new-username>Choose another username</button></details></div><div data-challenge></div><button type="submit">Sign in</button><button type="button" class="secondary" data-create>Create account</button>';
    }
    const emblem = isSettings() ? `<div class="account-player-signature">${renderPlayerEmblem(session.account?.username)}<span class="player-name-stack"><strong><bdi>${escapeHtml(session.account?.displayName || session.account?.username)}</bdi></strong><span class="player-username"><bdi>@${escapeHtml(session.account?.username)}</bdi></span></span></div>` : '';
    dialog.innerHTML = `<form class="account-form" novalidate data-entry-mode="${mode === "register" ? "create" : mode}" data-lookup-state="${lookupState}"><div class="account-dialog-heading"><h2 id="account-title" tabindex="-1">${title}</h2><button type="button" class="ui-icon-button account-close" data-cancel aria-label="Close">${icon('close')}</button></div>${emblem}${body}${mode === "login" ? "" : feedback}</form>`;
    if (mode === "account") {
      autosave?.cancel();
      const marker = flow, generation = controller.snapshot().generation;
      autosave = createAccountAutosave({
        initial: session.account?.displayName || "", timers,
        validate: value => normalizeDisplayName(value, session.account?.username || ""),
        isCurrent: () => marker === flow && generation === controller.snapshot().generation && dialog.open,
        save: displayName => controller.updateAccount({ displayName }),
        report: (state) => {
          const target = dialog.querySelector("[data-autosave-status]");
          if (!target) return;
          target.parentElement.dataset.state = state;
          const discard = dialog.querySelector("[data-discard-account]");
          if (discard) discard.hidden = !["invalid", "error"].includes(state);
          target.textContent = { saving: "Saving…", saved: "Saved", invalid: "Not saved", error: "Not saved" }[state];
          status(state === "invalid" ? "Use a display name of up to 32 characters without control characters." : state === "error" ? "Could not save. Check your connection and retry." : "", state === "invalid" || state === "error" ? "error" : "info");
          if (state === "saved") onComplete(null);
        },
      });
    }
    sizeAnimation.refresh();
    updateLookup(); updateRequirements(); updateLoginHint();
    if (["register", "password"].includes(mode)) loadBlocklist();
    const marker = flow;
    queueMicrotask(() => {
      if (marker !== flow || !dialog.open) return;
      const first = ["register", "login"].includes(mode) && values.username?.trim()
        ? dialog.querySelector('[name="password"]') : dialog.querySelector("input");
      (first || dialog.querySelector("#account-title"))?.focus();
    });
  };
  const checkUsername = async () => {
    if (mode !== "register") return;
    const field = dialog.querySelector('[name="username"]');
    const raw = field?.value || "", canonical = canonicalEntryUsername(raw);
    values.username = raw;
    invalidateLookup();
    if (!validEntryUsername(raw)) { lookupState = "idle"; updateLookup(); return; }
    const revision = lookupRevision, marker = flow, generation = controller.snapshot().generation;
    lookupName = canonical; lookupState = "pending"; lookupAbort = new AbortController(); updateLookup();
    try {
      const result = await controller.lookupUsername(raw, { signal: lookupAbort.signal });
      if (mode !== "register" || marker !== flow || revision !== lookupRevision || !dialog.open || generation !== controller.snapshot().generation || canonical !== canonicalEntryUsername(field.value)) return;
      if (typeof result.exists !== "boolean") throw new Error("invalid_lookup_response");
      lookupState = result.exists ? "taken" : "available"; updateLookup();
    } catch {
      if (mode !== "register" || marker !== flow || revision !== lookupRevision || !dialog.open || generation !== controller.snapshot().generation) return;
      lookupState = "error"; updateLookup();
    }
  };
  const changeEntryMode = async (next, empty = false) => {
    if (mode === "account" && autosave?.dirty() && !await autosave.flush()) return;
    autosave?.cancel(); autosave = null;
    values.username = empty ? "" : dialog.querySelector('[name="username"]')?.value || values.username || "";
    invalidateLookup(); flow++; owner = {}; mode = next;
    lookupState = "idle"; lookupName = ""; lookupRevealed = false;
    render();
    present();
    if (next === "register" && validEntryUsername(values.username)) lookupTimer = timers.setTimeout(() => void checkUsername(), USERNAME_LOOKUP_DEBOUNCE_MS);
  };
  const close = async (discard = false) => {
    if (!discard && mode === "account" && autosave?.dirty() && !await autosave.flush()) return false;
    if (!discard && isSettings() && dialog.open)onSound("flyout-back");
    if (!discard && isSettings() && dialog.open && !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      const closingFlow = flow;
      dialog.classList.add('is-closing');
      await new Promise(resolve => setTimeout(resolve, 180));
      if (flow !== closingFlow) return false;
    }
    dialog.classList.remove('is-closing');
    autosave?.cancel(); autosave = null;
    pendingLogoutGeneration = null;
    backdropPress = false;
    cancelLoginHint();
    sizeAnimation.reset();
    invalidateLookup();
    flow++;
    owner = {};
    pending = null;
    values = {};
    clearChallenge();
    entryAnimation?.cancel();entryAnimation = null;
    const action = trigger?.closest?.("[data-action]")?.getAttribute("data-action");
    const resolveSource = () => trigger?.isConnected ? trigger : action ? document.querySelector(`[data-action="${CSS.escape(action)}"]`) : document.querySelector('[data-action="account-open"]');
    releaseScroll?.();releaseScroll = null;
    if (!discard && !isSettings()) animateOverlayExit(dialog, resolveSource());
    dialog.close();
    releaseScroll?.();releaseScroll = null;
    if (document.documentElement?.dataset) document.documentElement.dataset.accountFlyout = "false";
    onLayoutChange();
    dialog.replaceChildren();
    resolveSource()?.focus?.({preventScroll:true});
    return true;
  };
  const open = (next = "login", intent = null, source = null) => {
    autosave?.cancel(); autosave = null;
    invalidateLookup();
    flow++;
    owner = {};
    pending = intent;
    trigger = source || (document.activeElement !== document.body ? document.activeElement : null);
    values = {};
    mode = ["account", "password", "register"].includes(next) ? next : "login";
    lookupState = "idle";
    lookupName = "";
    lookupRevealed = false;
    const snapshot = controller.snapshot();
    pendingLogoutGeneration = snapshot.pendingLogout && !snapshot.session.authenticated ? snapshot.generation : null;
    if (mode === "account" && !snapshot.session.authenticated) mode = "login";
    render();
    present();
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
        "Verification is temporarily unavailable. Please try again later.", "error",
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
            status("Verification is unavailable. Please try again.", "error");
          },
        },
      );
    } catch {
      if (marker === flow)
        status("Verification is unavailable. Please try again.", "error");
    }
  };
  const outsideDialog = (event) => {
    const bounds = dialog.getBoundingClientRect();
    return event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom;
  };
  const beginFeedbackGesture = () => { feedbackGesture.begin(); feedbackGesture.defer({}); sizeAnimation.pause(); };
  const endFeedbackGesture = () => feedbackGesture.end();
  for (const type of ["pointerup", "pointercancel", "keyup", "blur"]) globalThis.addEventListener?.(type, endFeedbackGesture);
  dialog.addEventListener("pointerdown", (event) => {
    if (event.button === 0 && event.target.closest?.("button, a, summary")) beginFeedbackGesture();
    discardPress = Boolean(event.target.closest?.("[data-discard-account]"));
    backdropPress = event.button === 0 && event.target === dialog && outsideDialog(event);
  });
  dialog.addEventListener("pointercancel", () => { backdropPress = false; discardPress = false; });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("keydown", (event) => {
    if (!event.repeat && [" ", "Enter"].includes(event.key) && event.target.closest?.("button, a, summary")) beginFeedbackGesture();
    if (event.key === "Escape" && dialog.dataset.presentation === 'flyout' && !phone?.matches) {event.preventDefault();void close();return;}
    if (event.key !== "Tab" || dialog.dataset.presentation === 'flyout' && !phone?.matches) return;
    const nodes = [...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),a[href],summary,[tabindex="0"]')].filter(node => !node.closest("[hidden]"));
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
  const onInput = (event) => {
    if (mode === "account" && event.target.name === "displayName") { autosave?.change(event.target.value); return; }
    if (["password", "newPassword"].includes(event.target.name)) { if (mode === "login") cancelLoginHint(); passwordTouched = true; updateRequirements(); return; }
    if (!["login", "register"].includes(mode) || event.target.name !== "username") return;
    if (mode === "login") cancelLoginHint();
    const previous = canonicalEntryUsername(values.username); values.username = event.target.value;
    updateRequirements();
    if (mode !== "register" || previous === canonicalEntryUsername(values.username)) return;
    invalidateLookup(); clearChallenge();
    lookupState = lookupRevealed && validEntryUsername(values.username) ? "pending" : "idle";
    lookupName = ""; updateLookup();
    if (validEntryUsername(values.username)) lookupTimer = timers.setTimeout(() => void checkUsername(), USERNAME_LOOKUP_DEBOUNCE_MS);
  };
  dialog.addEventListener("input", onInput);
  dialog.addEventListener("change", onInput);
  dialog.addEventListener("focusin", (event) => {
    if (mode === "login" && event.target.name === "username") cancelLoginHint();
    updateRequirements();
  });
  dialog.addEventListener("focusout", (event) => {
    if (mode === "account" && event.target.name === "displayName" && !discardPress && !event.relatedTarget?.closest?.("[data-discard-account]")) { autosave?.change(event.target.value); void autosave?.flush(); }
    if (mode === "login" && event.target.name === "username")
      scheduleLoginHint();
  });
  dialog.addEventListener("click", async (event) => {
    endFeedbackGesture();
    discardPress = false;
    const dismiss = backdropPress && event.target === dialog && outsideDialog(event);
    backdropPress = false;
    if (dismiss) { close(); return; }
    const button = event.target.closest("button, [data-create-link], [data-signin]");
    if (!button) return;
    if (button.hasAttribute("data-discard-account")) { void close(true); return; }
    if (button.hasAttribute("data-cancel")) { close(); return; }
    if (button.hasAttribute("data-create") || button.hasAttribute("data-create-link")) { event.preventDefault(); changeEntryMode("register"); return; }
    if (button.hasAttribute("data-signin")) { event.preventDefault(); changeEntryMode("login"); return; }
    if (button.hasAttribute("data-new-username")) { changeEntryMode("register", true); return; }
    if (button.dataset.mode) { changeEntryMode(button.dataset.mode); return; }
    if (button.dataset.inputAction === "retry-account-save") { await autosave?.flush(); return; }
    if (button.dataset.inputAction === "toggle-password") {
      const field = document.getElementById(button.getAttribute("aria-controls"));
      if (!field || !dialog.contains(field)) return;
      field.type = field.type === "password" ? "text" : "password";
      button.textContent = field.type === "password" ? "Show" : "Hide";
      button.setAttribute("aria-label", `${button.textContent} ${field.name === "newPassword" ? "new password" : "password"}`);
      return;
    }
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
    if (mode === "account") { autosave?.change(dialog.querySelector('[name="displayName"]')?.value || ""); await autosave?.flush(); return; }
    if (controller.snapshot().busy || submittingFlow === flow) return;
    // Always inspect live values: native autofill need not emit input events.
    const field = name => dialog.querySelector(`[name="${name}"]`);
    const rejectField = (name, message, state = "error") => { status(message, state); field(name)?.focus(); };
    if (["login", "register"].includes(mode) && !validEntryUsername(field("username")?.value)) { rejectField("username", "Use 3–24 letters, digits or underscores for your username."); return; }
    if (mode === "register" && lookupName === canonicalEntryUsername(field("username")?.value) && lookupState === "taken") { rejectField("username", messages.username_unavailable); return; }
    if (mode === "account" && !normalizeDisplayName(field("displayName")?.value, field("username")?.value || controller.snapshot().session.account?.username || "").ok) { rejectField("displayName", "Use a display name of up to 32 characters without control characters."); return; }
    if (mode === "login" && !field("password")?.value) { rejectField("password", "Enter your password.", "info"); return; }
    if (["register", "password"].includes(mode)) {
      passwordTouched = true;
      const requirements = updateRequirements();
      if (requirements && Object.values(requirements).some(value => value === false)) { rejectField(mode === "password" ? "newPassword" : "password", "Choose a password that meets the requirements."); return; }
    }
    const marker = flow, operationOwner = owner, operation = credentialMode();
    submittingFlow = marker;
    const data = Object.fromEntries(new FormData(form));
    const buttons = [...form.querySelectorAll("button[type=submit]")];
    buttons.forEach(b => { b.disabled = true; });
    status("Working…", "pending");
    try {
      const token = challengeToken ? { challengeToken } : {};
      challengeToken = "";
      await controller.act(operation, operation === "password" ? { newPassword: data.newPassword, ...token } : { username: data.username, password: data.password, ...token }, operationOwner);
      if (marker !== flow || !dialog.open) return;
      complete();
    } catch (error) {
      if (marker !== flow || !dialog.open) return;
      if (error.code === "username_unavailable" && operation === "register") {
        lookupState = "taken"; lookupName = canonicalEntryUsername(data.username);
        updateLookup();
      }
      if (error.code === "invalid_credentials" && operation === "login") {
        cancelLoginHint();
        updateLoginHint(true);
        dialog.querySelector("[data-forgot]").hidden = false;
      }
      status(messages[error.code] || "We could not confirm the result. Check your connection and account status before trying again.", error.code === "logout_pending" ? "pending" : "error");
      if (error.body?.challengeRequired || widget !== null) await challenge();
    } finally {
      if (submittingFlow === marker) submittingFlow = null;
      if (marker === flow) { buttons.forEach(b => { b.disabled = false; }); updateRequirements(); }
    }
  });
  const refreshSession = () => {};
  return {
    open, close, refreshSession,
    onTransition: ({ owner: transitionOwner, completedLogoutGeneration } = {}) => {
      if (dialog.open && pendingLogoutGeneration !== null && completedLogoutGeneration === pendingLogoutGeneration) { pendingLogoutGeneration = null; return; }
      if (dialog.open && transitionOwner !== owner) void close(true);
    },
    isOpen: () => dialog.open, element: dialog,
  };
};
