const escapeHtml = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const messages = {
  invalid_input:
    "Check the fields. Usernames use 3–24 letters, digits or underscores; passwords need 12–128 characters and cannot be common passwords.",
  invalid_credentials: "The username or password/recovery code is incorrect.",
  username_unavailable: "That username is unavailable. Choose another.",
  stale_operation:
    "This recovery step has expired or been replaced. Please start again.",
  session_changed: "Your session changed. Please try again.",
  identity_mismatch: "Your session changed. Please sign in again.",
  rate_limited: "Too many attempts. Wait before trying again.",
  temporarily_unavailable:
    "The service is temporarily unavailable. Your entries are still here; please try again.",
  logout_pending: "Sign-out pending. Reconnect to finish signing out.",
  upgrade_required: "Please refresh to update Righelt.",
};
export const recoveryDownloadText = ({ site, username, code }) =>
  `${site}\nUsername: ${username}\nRecovery code: ${code}\n\nKeep this code private. A replacement code makes the previous code invalid. No recovery is promised if both your password and recovery code are lost.\n`;
export const createAccountDialog = ({
  controller,
  document = globalThis.document,
  onComplete = () => {},
  onTutorial = () => {},
  getSiteKey = () => null,
  sound = null,
} = {}) => {
  const dialog = document.createElement("dialog");
  dialog.className = "account-dialog";
  dialog.dataset.testid = "account-dialog";
  dialog.setAttribute("aria-labelledby", "account-title");
  document.body.append(dialog);
  let mode = "login",
    trigger = null,
    pending = null,
    values = {},
    code = null,
    version = null,
    operationContext = null,
    finish = null,
    username = "",
    challengeToken = "",
    widget = null,
    flow = 0,
    owner = {};
  const status = (text) => {
    const target = dialog.querySelector("[data-account-status]");
    if (target) target.textContent = text;
  };
  const title = () =>
    ({
      login: "Sign in",
      register: "Create account",
      recovery: "Recover account",
      code: "Save your recovery code",
      account: "Account",
      password: "Change password",
      replacement: "Replace recovery code",
    })[mode];
  const input = (
    name,
    label,
    { secret = false, autocomplete = "", optional = false } = {},
  ) =>
    `<label for="account-${name}">${label}</label><div class="account-input-row"><input id="account-${name}" name="${name}" ${secret ? 'type="password"' : 'type="text"'} ${optional ? "" : "required"} autocomplete="${autocomplete}" ${name === "username" ? 'autocapitalize="none" spellcheck="false"' : ""} value="${escapeHtml(secret ? "" : values[name] || "")}" ${name === "displayName" ? `placeholder="${escapeHtml(values.username || "Username")}"` : ""}>${secret ? `<button type="button" class="secondary" data-toggle="${name}" aria-label="Show ${label.toLowerCase()}">Show</button>` : ""}</div>`;
  const render = () => {
    challengeToken = "";
    widget = null;
    const session = controller.snapshot().session;
    let body = "";
    if (mode === "account")
      body = `<p><bdi>${escapeHtml(session.account?.displayName)}</bdi> <span class="small">@${escapeHtml(session.account?.username)}</span></p><label for="account-displayName">Display name</label><input id="account-displayName" name="displayName" autocomplete="nickname" value="${escapeHtml(session.account?.displayName)}"><label for="account-view">View preference</label><select id="account-view" name="view"><option value="focused" ${session.account?.preferences?.view !== "explanatory" ? "selected" : ""}>Focused</option><option value="explanatory" ${session.account?.preferences?.view === "explanatory" ? "selected" : ""}>Explanatory</option></select><button type="submit">Save account settings</button><p data-testid="tutorial-status">Tutorial: ${escapeHtml(session.account?.preferences?.tutorial || "new")}</p><button type="button" data-tutorial>Replay tutorial</button><button type="button" data-mode="password">Change password</button><button type="button" data-mode="replacement">Replace recovery code</button><button type="button" data-mode="login">Switch account</button><button type="button" data-logout>Sign out</button>`;
    else if (mode === "code")
      body = `<p>Save this code somewhere private. It is the only way to recover your account without your password. If both are lost, we cannot promise account recovery.</p><output data-testid="recovery-code" class="account-recovery-code">${escapeHtml(code)}</output><div class="account-actions"><button type="button" data-copy>Copy recovery code</button><button type="button" data-download>Download recovery code</button></div><label class="account-check"><input type="checkbox" name="saved" required> I saved my recovery code</label><button type="submit">Continue</button>`;
    else {
      if (["login", "register", "recovery"].includes(mode))
        body += input("username", "Username", { autocomplete: "username" });
      if (mode === "register")
        body += input("displayName", "Display name (optional)", {
          autocomplete: "nickname",
          optional: true,
        });
      if (["login", "register"].includes(mode))
        body += input("password", "Password", {
          secret: true,
          autocomplete: mode === "login" ? "current-password" : "new-password",
        });
      if (mode === "recovery")
        body += input("recoveryCode", "Recovery code", { autocomplete: "off" });
      if (["password", "replacement"].includes(mode))
        body += input("currentPassword", "Current password", {
          secret: true,
          autocomplete: "current-password",
        });
      if (["password", "recovery"].includes(mode))
        body += input("newPassword", "New password", {
          secret: true,
          autocomplete: "new-password",
        });
      if (["register", "password", "recovery"].includes(mode))
        body +=
          '<p class="small">Use 12–128 characters. Spaces and password managers are welcome.</p>';
      body += `<div data-challenge></div><button type="submit">${{ login: "Sign in", register: "Create account", recovery: "Prepare recovery", password: "Change password", replacement: "Prepare replacement code" }[mode]}</button>`;
      if (mode === "login")
        body +=
          '<button type="button" class="secondary" data-mode="register">Create account</button><button type="button" class="secondary" data-mode="recovery">Recover account</button>';
      if (["register", "recovery"].includes(mode))
        body +=
          '<button type="button" class="secondary" data-mode="login">Back to sign in</button>';
    }
    if (mode === "account" && sound) body += `<button type="button" data-device-sound aria-pressed="${sound.enabled()}">Sound on this device: ${sound.enabled() ? "On" : "Off"}</button>`;
    dialog.innerHTML = `<form class="account-form"><h2 id="account-title" tabindex="-1">${title()}</h2>${body}<p class="account-status" role="status" aria-live="polite" data-account-status></p><button type="button" class="secondary" data-cancel>Cancel</button></form>`;
    queueMicrotask(() =>
      dialog.querySelector("input, #account-title")?.focus(),
    );
  };
  const close = () => {
    flow++;
    owner = {};
    pending = null;
    values = {};
    code = null;
    version = null;
    operationContext = null;
    finish = null;
    challengeToken = "";
    if (widget !== null) globalThis.turnstile?.remove(widget);
    dialog.close();
    dialog.replaceChildren();
    const action = trigger
      ?.closest?.("[data-action]")
      ?.getAttribute("data-action");
    const restored = trigger?.isConnected
      ? trigger
      : action
        ? document.querySelector(`[data-action="${CSS.escape(action)}"]`)
        : document.querySelector('[data-action="account-open"]');
    restored?.focus?.();
  };
  const open = (next = "login", intent = null, source = null) => {
    flow++;
    owner = {};
    pending = intent;
    // Safari does not focus pointer-clicked buttons before opening a dialog.
    trigger =
      source ||
      (document.activeElement !== document.body
        ? document.activeElement
        : null);
    values = {};
    mode = next;
    const session = controller.snapshot().session;
    if (next === "account" && !session.authenticated) mode = "login";
    dialog.dataset.actionAffiliation = document.querySelector("#app")?.dataset.actionAffiliation || "red";
    render();
    if (!dialog.open) dialog.showModal();
  };
  const complete = () => {
    const intent = pending;
    close();
    onComplete(intent);
  };
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
        { register: "register", login: "login", recovery: "recovery" }[mode] ||
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
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  dialog.addEventListener("keydown", (event) => {
    if (event.key !== "Tab") return;
    const nodes = [
      ...dialog.querySelectorAll(
        'button:not([disabled]),input:not([disabled]),[tabindex="0"]',
      ),
    ];
    const first = nodes[0],
      last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  dialog.addEventListener("input", (event) => {
    if (event.target.name === "username") {
      values.username = event.target.value;
      const field = dialog.querySelector("[name=displayName]");
      if (field) field.placeholder = event.target.value || "Username";
    }
  });
  dialog.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button) return;
    if (button.hasAttribute("data-device-sound")) { const enabled = sound.toggle(); button.setAttribute("aria-pressed", String(enabled)); button.textContent = `Sound on this device: ${enabled ? "On" : "Off"}`; return; }
    if (button.hasAttribute("data-cancel")) {
      close();
      return;
    }
    if (button.dataset.mode) {
      mode = button.dataset.mode;
      flow++;
      owner = {};
      code = null;
      version = null;
      operationContext = null;
      finish = null;
      values = {
        username:
          values.username ||
          controller.snapshot().session.account?.username ||
          "",
      };
      render();
      return;
    }
    if (button.dataset.toggle) {
      const field = dialog.querySelector(`[name="${button.dataset.toggle}"]`);
      field.type = field.type === "password" ? "text" : "password";
      button.textContent = field.type === "password" ? "Show" : "Hide";
      button.setAttribute(
        "aria-label",
        `${button.textContent} ${button.dataset.toggle === "newPassword" ? "new password" : button.dataset.toggle === "currentPassword" ? "current password" : "password"}`,
      );
      return;
    }
    if (button.hasAttribute("data-copy")) {
      try {
        await navigator.clipboard.writeText(code);
        status("Recovery code copied.");
      } catch {
        status(
          "Copy failed. Select the code and copy it manually, or download it.",
        );
      }
      return;
    }
    if (button.hasAttribute("data-download")) {
      try {
        const blob = new Blob(
          [recoveryDownloadText({ site: location.origin, username, code })],
          { type: "text/plain" },
        );
        const url = URL.createObjectURL(blob),
          link = document.createElement("a");
        link.href = url;
        link.download = "righelt-recovery-code.txt";
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        status("Download requested. Check your saved file before continuing.");
      } catch {
        status("Download failed. Copy the code or write it down.");
      }
      return;
    }
    if (button.hasAttribute("data-tutorial")) {
      close();
      onTutorial();
      return;
    }
    if (button.hasAttribute("data-logout")) {
      await controller.logout();
      close();
      onComplete(null);
    }
  });
  dialog.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    if (!form.reportValidity() || controller.snapshot().busy) return;
    const marker = flow,
      operationOwner = owner,
      data = Object.fromEntries(new FormData(form));
    values = {
      username: data.username || values.username,
      displayName: data.displayName || values.displayName,
    };
    const buttons = [...form.querySelectorAll("button[type=submit]")];
    buttons.forEach((b) => (b.disabled = true));
    status("Working…");
    try {
      let result;
      const token = challengeToken ? { challengeToken } : {};
      challengeToken = "";
      if (mode === "account") {
        result = await controller.updateAccount({
          displayName: data.displayName,
          preferences: { view: data.view },
        });
        if (marker === flow && dialog.open) {
          render();
          status("Account settings saved.");
          onComplete(null);
        }
        return;
      }
      if (mode === "code")
        result = await controller.act(finish, {
          saved: true,
          recoveryVersion: version,
          ...(finish !== "recovery-code/acknowledge" ? { operationContext } : {}),
        }, operationOwner);
      else if (mode === "login")
        result = await controller.act("login", {
          username: data.username,
          password: data.password,
          ...token,
        }, operationOwner);
      else if (mode === "register")
        result = await controller.act("register", {
          username: data.username,
          displayName: data.displayName,
          password: data.password,
          ...token,
        }, operationOwner);
      else if (mode === "recovery")
        result = await controller.act("recovery/prepare", {
          username: data.username,
          recoveryCode: data.recoveryCode,
          newPassword: data.newPassword,
          ...token,
        }, operationOwner);
      else if (mode === "password")
        result = await controller.act("password", {
          currentPassword: data.currentPassword,
          newPassword: data.newPassword,
          ...token,
        }, operationOwner);
      else if (mode === "replacement")
        result = await controller.act("recovery-code/prepare", {
          currentPassword: data.currentPassword,
          ...token,
        }, operationOwner);
      if (marker !== flow || !dialog.open) return;
      username =
        data.username ||
        controller.snapshot().session.account?.username ||
        username;
      if (result.recoveryCode) {
        finish =
          mode === "register"
            ? "recovery-code/acknowledge"
            : mode === "recovery"
              ? "recovery/finish"
              : "recovery-code/finish";
        code = result.recoveryCode;
        version = result.recoveryVersion;
        operationContext = result.operationContext ?? null;
        mode = "code";
        render();
        return;
      }
      if (controller.snapshot().session.recoveryAcknowledgmentRequired) {
        mode = "replacement";
        render();
        status(
          "Save a recovery code before playing. Enter your password to issue a replacement code.",
        );
        return;
      }
      complete();
    } catch (error) {
      if (marker === flow) {
        status(
          messages[error.code] ||
            "Could not connect. Your entries are still here; please try again.",
        );
        if (error.body?.challengeRequired || widget !== null) await challenge();
      }
    } finally {
      if (marker === flow) buttons.forEach((b) => (b.disabled = false));
    }
  });
  const refreshSession = () => {
    if (!dialog.open || mode !== "account") return;
    const node = dialog.querySelector('[data-testid="tutorial-status"]');
    if (node)
      node.textContent = `Tutorial: ${controller.snapshot().session.account?.preferences?.tutorial || "new"}`;
  };
  return {
    open,
    close,
    refreshSession,
    onTransition: ({ owner: transitionOwner } = {}) => {
      // Only the operation submitted by this exact dialog flow may carry it
      // across a session replacement. Other tabs and revocation retire secrets.
      if (dialog.open && transitionOwner !== owner) close();
    },
    isOpen: () => dialog.open,
    element: dialog,
  };
};
