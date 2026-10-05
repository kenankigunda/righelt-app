import { parseRouteFromHash } from "./routes.js";
import {
  AUTH_PROTOCOL_VERSION,
  AUTH_BOOTSTRAP_TIMEOUT_MS,
  AUTH_LOGOUT_ATTEMPT_TIMEOUT_MS,
  USERNAME_LOOKUP_TIMEOUT_MS,
  AUTH_PROTOCOL_HEADER,
  AUTH_REQUEST_HEADER,
  SESSION_CONTEXT_HEADER,
  ACTIVITY_THROTTLE_MS,
} from "../generated/packages/shared-types/src/auth-policy.js";

export const AUTH_CHANGE_KEY = "righelt.account.change.v1";
export const LOGOUT_PENDING_KEY = "righelt.account.logout-pending.v1";
const failure = (code) => Object.assign(new Error(code), { code });
export const safeAccountIntent = (value) => {
  if (!value || typeof value !== "object") return null;
  if (
    typeof value.hash !== "string" ||
    !value.hash.startsWith("#/") ||
    /[\s\\]/.test(value.hash)
  )
    return null;
  try {
    if (parseRouteFromHash(value.hash).name === "not-found") return null;
  } catch {
    return null;
  }
  const allowed = [
    "create-game",
    "join-player",
    "accept-invite-player",
    "play-as-both-players",
    "load-scenario",
    "launch-history-branch",
    "analysis",
  ];
  if (!allowed.includes(value.action)) return null;
  return {
    hash: value.hash,
    action: value.action,
    ...(typeof value.gameId === "string" ? { gameId: value.gameId } : {}),
    ...(typeof value.moveIndex === "string"
      ? { moveIndex: value.moveIndex }
      : {}),
  };
};
export const createAccountController = ({
  fetcher = fetch,
  storage = globalThis.localStorage,
  eventTarget = globalThis.window,
  document = globalThis.document,
  now = Date.now,
  locks = globalThis.navigator?.locks,
  retryTimers = globalThis,
  bootstrapTimers = globalThis,
  logoutTimers = globalThis,
  channelFactory = globalThis.window && globalThis.BroadcastChannel
    ? () => new BroadcastChannel("righelt.accounts.v1")
    : null,
  onTransition = () => {},
  onChange = () => {},
} = {}) => {
  let siteKey = null,
    enabled = true,
    available = true,
    maintenance = false,
    ready = false,
    session = { authenticated: false },
    generation = 0,
    busy = false,
    lastActivity = 0,
    destroyed = false;
  const controllers = new Set(),
    network = new Set();
  let authorityLossPending = false;
  let accountMetadataRevision = 0;
  let channel = null;
  try {
    channel = channelFactory?.();
  } catch {}
  const announce = (message) => {
    try {
      channel?.postMessage(message);
    } catch {}
  };
  let localCookieQueue = Promise.resolve();
  const cookieRequest = (work) => {
    if (locks?.request)
      return locks.request(
        "righelt.session-cookie.v1",
        { mode: "exclusive" },
        work,
      );
    // Non-browser test consumers use a local queue. Account mutations require
    // Web Locks in browsers so a different tab cannot reorder Set-Cookie.
    if (globalThis.window)
      return Promise.reject(failure("temporarily_unavailable"));
    const result = localCookieQueue.then(work, work);
    localCookieQueue = result.catch(() => {});
    return result;
  };
  const track = (promise) => {
    network.add(promise);
    promise.finally(() => network.delete(promise)).catch(() => {});
    return promise;
  };
  let pendingLogout = null,
    logoutFlight = null,
    logoutRetryTimer = null,
    logoutRetryDelay = 1000,
    offline = globalThis.navigator?.onLine === false,
    expiryTimer = null;
  const readPending = () => {
    try {
      return pendingLogout || storage?.getItem(LOGOUT_PENDING_KEY) || null;
    } catch {
      return pendingLogout;
    }
  };
  const write = (key, value) => {
    try {
      value === null ? storage?.removeItem(key) : storage?.setItem(key, value);
    } catch {}
  };
  const snapshot = () => ({
    enabled,
    available,
    maintenance,
    ready,
    siteKey,
    session: structuredClone(session),
    generation,
    pendingLogout: Boolean(readPending()),
    busy,
  });
  const publish = () => {
    if (!destroyed) onChange(snapshot());
  };
  const retire = (next = { authenticated: false }, broadcast = false, owner = null, completedLogoutGeneration = null) => {
    generation++;
    clearTimeout(expiryTimer);
    for (const controller of controllers) controller.abort();
    controllers.clear();
    onTransition({ ...snapshot(), session: structuredClone(next), generation }, { owner, ...(completedLogoutGeneration === null ? {} : { completedLogoutGeneration }) });
    session = next;
    if (broadcast) {
      write(AUTH_CHANGE_KEY, `${now()}:${Math.random()}`);
      announce({ type: "changed", pendingLogout: Boolean(readPending()) });
    }
    publish();
  };
  const accept = (input, broadcast = false, owner = null) => {
    const next = input.authenticated
      ? {
          authenticated: true,
          account: input.account,
          contextId: input.contextId,
          expiresAt: input.expiresAt,
        }
      : { authenticated: false };
    if (
      next.authenticated &&
      session.authenticated &&
      next.contextId === session.contextId
    )
      next.expiresAt = Math.max(next.expiresAt, session.expiresAt);
    if (
      session.contextId !== next.contextId ||
      session.authenticated !== next.authenticated
    )
      retire(next, broadcast, owner);
    else {
      session = next;
      publish();
    }
    clearTimeout(expiryTimer);
    if (next.authenticated) {
      expiryTimer = setTimeout(
        () => {
          if (next.expiresAt > now()) {
            accept(next);
            return;
          }
          // A game mutation may have renewed the server expiry since the last
          // session response. Confirm with the server before retiring a queue.
          if (busy) {
            authorityLossPending = true;
            return;
          }
          const epoch = generation;
          void hydrate().catch(() => {
            if (epoch === generation) retire();
          });
        },
        Math.max(1000, Math.min(2147483647, next.expiresAt - now())),
      );
      expiryTimer.unref?.();
    }
  };
  const acceptObservedSession = (next, observedRevision) => {
    if (
      next.authenticated &&
      next.contextId === session.contextId &&
      observedRevision !== accountMetadataRevision
    )
      next = { ...next, account: session.account };
    accept(next);
  };
  const request = async (
    path,
    body,
    { context = session.contextId, epoch = generation, signal, readOnly = false } = {},
  ) => {
    const controller = new AbortController();
    controllers.add(controller);
    signal?.addEventListener("abort", () => controller.abort(), { once: true });
    if (signal?.aborted) controller.abort();
    try {
      const response = await (readOnly ? (promise) => promise : track)(
        (body === undefined || readOnly ? (work) => work() : cookieRequest)(() => {
          if (epoch !== generation || controller.signal.aborted)
            throw failure("session_changed");
          return fetcher(path, {
            method: body === undefined ? "GET" : "POST",
            credentials: "same-origin",
            cache: "no-store",
            signal: controller.signal,
            headers: {
              "Content-Type": "application/json",
              [AUTH_REQUEST_HEADER]: "1",
              [AUTH_PROTOCOL_HEADER]: String(AUTH_PROTOCOL_VERSION),
              ...(context ? { [SESSION_CONTEXT_HEADER]: context } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          });
        }),
      );
      const result = await response.json();
      if (epoch !== generation || destroyed || controller.signal.aborted)
        throw failure("session_changed");
      if (!response.ok || result.ok === false)
        throw Object.assign(
          failure(result.error || "temporarily_unavailable"),
          { body: result, status: response.status },
        );
      return result;
    } finally {
      controllers.delete(controller);
    }
  };
  const clearLogoutRetry = () => {
    retryTimers.clearTimeout(logoutRetryTimer);
    logoutRetryTimer = null;
  };
  const scheduleLogoutRetry = () => {
    if (destroyed || offline || !readPending() || logoutRetryTimer !== null)
      return;
    logoutRetryTimer = retryTimers.setTimeout(() => {
      logoutRetryTimer = null;
      if (!destroyed && !offline && readPending())
        void finishLogout().catch(() => publish());
    }, logoutRetryDelay);
    logoutRetryTimer?.unref?.();
    logoutRetryDelay = Math.min(logoutRetryDelay * 2, 30000);
  };
  const finishLogout = () => {
    if (logoutFlight) return logoutFlight;
    if (!readPending()) return Promise.resolve();
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = logoutTimers.setTimeout(() => {
        controller.abort();
        reject(failure("temporarily_unavailable"));
      }, AUTH_LOGOUT_ATTEMPT_TIMEOUT_MS);
      timer?.unref?.();
    });
    const attempt = (async () => {
      // Resolve the actual cookie before revocation, including a credential
      // response whose headers arrived without its body.
      const current = await request("/api/auth/session", undefined, { signal: controller.signal });
      await request("/api/auth/logout", {}, { context: current.contextId, signal: controller.signal });
      pendingLogout = null;
      clearLogoutRetry();
      logoutRetryDelay = 1000;
      write(LOGOUT_PENDING_KEY, null);
      announce({ type: "logout-complete" });
      // Rebuild the anonymous transport without retiring a newer anonymous form
      // opened in this exact pending-logout generation.
      retire({ authenticated: false }, true, null, generation);
    })();
    // Reconnect can leave a browser request pending without a network error.
    // Release the attempt for the existing retry loop, preserving denied local
    // authority until a later, confirmed server revocation succeeds.
    logoutFlight = Promise.race([attempt, deadline])
      .catch((error) => {
        scheduleLogoutRetry();
        throw error;
      })
      .finally(() => {
        logoutTimers.clearTimeout(timer);
        logoutFlight = null;
      });
    return logoutFlight;
  };
  const hydrate = async (signal) => {
    if (!enabled || !available || destroyed || busy) return snapshot();
    if (readPending()) {
      await finishLogout();
      return snapshot();
    }
    const metadataRevision = accountMetadataRevision;
    const next = await request("/api/auth/session", undefined, { signal });
    acceptObservedSession(next, metadataRevision);
    return snapshot();
  };
  let startFlight = null;
  const start = () => {
    if (startFlight) return startFlight;
    const controller = new AbortController(),
      epoch = generation;
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = bootstrapTimers.setTimeout(() => {
        controller.abort();
        reject(failure("temporarily_unavailable"));
      }, AUTH_BOOTSTRAP_TIMEOUT_MS);
      timer?.unref?.();
    });
    const load = async () => {
      const result = await request("/api/shell/bootstrap", undefined, {
        signal: controller.signal,
      });
      if (
        result.authProtocolVersion !== AUTH_PROTOCOL_VERSION ||
        typeof result.accountsRequired !== "boolean"
      )
        throw failure("upgrade_required");
      enabled = result.accountsRequired;
      available = result.accountsAvailable !== false;
      maintenance = result.maintenance === true;
      siteKey = result.turnstileSiteKey || null;
      if (enabled && available) await hydrate(controller.signal);
      else retire({ authenticated: false });
      if (controller.signal.aborted || destroyed)
        throw failure("session_changed");
      ready = true;
      publish();
      return snapshot();
    };
    startFlight = Promise.race([load(), deadline])
      .catch((error) => {
        if (epoch === generation) ready = false;
        throw error;
      })
      .finally(() => {
        bootstrapTimers.clearTimeout(timer);
        startFlight = null;
      });
    return startFlight;
  };
  const activity = async (force = false) => {
    if (
      !enabled ||
      busy ||
      !session.authenticated ||
      readPending() ||
      document?.visibilityState === "hidden"
    )
      return;
    if (!force && now() - lastActivity < ACTIVITY_THROTTLE_MS) return;
    lastActivity = now();
    const epoch = generation,
      metadataRevision = accountMetadataRevision;
    try {
      const result = await request("/api/auth/activity", {});
      acceptObservedSession(result, metadataRevision);
    } catch (error) {
      if (
        epoch === generation &&
        ["invalid_credentials", "session_changed"].includes(error.code)
      )
        authorityLost();
    }
  };
  // Availability is a read despite its JSON POST: it never queues a cookie
  // mutation, acquires credential authority, or blocks another account action.
  const lookupUsername = async (username, { signal } = {}) => {
    if (!ready) throw failure("auth_not_ready");
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) controller.abort();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = bootstrapTimers.setTimeout(() => {
        controller.abort();
        reject(failure("temporarily_unavailable"));
      }, USERNAME_LOOKUP_TIMEOUT_MS);
      timer?.unref?.();
    });
    try {
      return await Promise.race([
        request("/api/auth/username", { username }, { signal: controller.signal, readOnly: true }),
        deadline,
      ]);
    } finally {
      bootstrapTimers.clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  };
  const act = async (operation, body, owner = null) => {
    if (!ready) throw failure("auth_not_ready");
    if (readPending()) throw failure("logout_pending");
    if (busy) throw failure("operation_pending");
    const startingGeneration = generation;
    busy = true;
    publish();
    try {
      await Promise.allSettled([...network]);
      if (startingGeneration !== generation || readPending())
        throw failure("session_changed");
      const result = await request(`/api/auth/${operation}`, body);
      if (typeof result.authenticated === "boolean")
        accept(
          result,
          ["login", "register", "password"].includes(
            operation,
          ),
          owner,
        );
      return result;
    } catch (error) {
      busy = false;
      // A transport failure may follow applied Set-Cookie headers. Read the
      // actual browser session; never guess that the credential commit failed.
      if (!error.status || error.code === "session_changed")
        await hydrate().catch(() => {});
      throw error;
    } finally {
      busy = false;
      if (authorityLossPending) {
        authorityLossPending = false;
        const epoch = generation;
        await hydrate().catch(() => {
          if (epoch === generation) retire();
        });
      }
      publish();
    }
  };
  const logout = async () => {
    pendingLogout = session.contextId || "anonymous";
    write(LOGOUT_PENDING_KEY, pendingLogout);
    retire({ authenticated: false }, true);
    try {
      await finishLogout();
    } catch {
      /* Offline logout stays pending and blocks hydration. */
    }
  };
  const authenticatedFetch = async (url, init = {}) => {
    const epoch = generation,
      context = session.contextId;
    if (!ready) throw failure("auth_not_ready");
    if (enabled && readPending()) throw failure("logout_pending");
    if (enabled && busy && init.method && init.method !== "GET")
      throw failure("operation_pending");
    const controller = new AbortController();
    controllers.add(controller);
    init.signal?.addEventListener("abort", () => controller.abort(), {
      once: true,
    });
    if (init.signal?.aborted) controller.abort();
    const check = () => {
      if (epoch !== generation || destroyed || controller.signal.aborted)
        throw failure("session_changed");
    };
    try {
      check();
      const response = await track(
        (enabled && init.method && init.method !== "GET"
          ? cookieRequest
          : (work) => work())(() => {
          check();
          if (controller.signal.aborted) throw failure("session_changed");
          return fetcher(url, {
            ...init,
            credentials: "same-origin",
            signal: controller.signal,
            headers: {
              ...init.headers,
              ...(enabled
                ? {
                    [AUTH_REQUEST_HEADER]: "1",
                    [AUTH_PROTOCOL_HEADER]: String(AUTH_PROTOCOL_VERSION),
                    ...(context ? { [SESSION_CONTEXT_HEADER]: context } : {}),
                  }
                : {}),
            },
          });
        }),
      );
      check();
      const json = response.json.bind(response);
      response.json = async () => {
        const body = await json();
        check();
        if (
          enabled &&
          ["invalid_credentials", "session_changed"].includes(body.error)
        ) {
          authorityLost();
        }
        return body;
      };
      return response;
    } finally {
      controllers.delete(controller);
    }
  };
  let accountUpdateQueue = Promise.resolve();
  const updateAccount = (patch) => {
    const epoch = generation;
    accountMetadataRevision++;
    const update = accountUpdateQueue.then(async () => {
      if (epoch !== generation || destroyed) throw failure("session_changed");
      const response = await authenticatedFetch("/api/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const result = await response.json();
      if (!response.ok || result.ok === false)
        throw failure(result.error || "temporarily_unavailable");
      accountMetadataRevision++;
      accept(result);
      return result;
    });
    accountUpdateQueue = update.catch(() => {});
    return update;
  };
  const authorityLost = () => {
    if (readPending()) {
      void finishLogout().catch(() => publish());
      return;
    }
    // A password commit closes its old socket before its new response
    // body necessarily arrives. Let that credential result settle first.
    if (busy) {
      authorityLossPending = true;
      return;
    }
    retire();
    void hydrate().catch(() => publish());
  };
  const external = () => {
    if (destroyed) return;
    if (readPending() && !session.authenticated) {
      void finishLogout().catch(() => publish());
      return;
    }
    retire();
    void hydrate().catch(() => publish());
  };
  if (channel) {
    channel.onmessage = (event) => {
      const message = event.data;
      if (message?.type === "hello") {
        if (readPending()) announce({ type: "changed", pendingLogout: true });
        return;
      }
      if (message?.type === "logout-complete") pendingLogout = null;
      else if (message?.type === "changed") {
        if (message.pendingLogout) pendingLogout ||= "another-tab";
      } else return;
      external();
    };
    announce({ type: "hello" });
  }
  const onStorage = (e) => {
    if (e.key === AUTH_CHANGE_KEY || e.key === LOGOUT_PENDING_KEY) external();
  };
  const onForeground = () => {
    if (document?.visibilityState !== "hidden")
      void (ready ? hydrate() : start())
        .then(() => activity(true))
        .catch(() => publish());
  };
  const onOffline = () => {
    offline = true;
    clearLogoutRetry();
  };
  const onOnline = () => {
    offline = false;
    clearLogoutRetry();
    logoutRetryDelay = 1000;
    // An offline attempt can still be settling when the online event arrives.
    // Drain it, then make the reconnect attempt rather than joining its failure.
    void (async () => {
      if (logoutFlight) await logoutFlight.catch(() => {});
      await (ready ? hydrate() : start());
      await activity(true);
    })().catch(() => publish());
  };
  const onInteraction = () => void activity();
  eventTarget?.addEventListener("storage", onStorage);
  eventTarget?.addEventListener("online", onOnline);
  eventTarget?.addEventListener("offline", onOffline);
  document?.addEventListener("visibilitychange", onForeground);
  document?.addEventListener("pointerdown", onInteraction);
  document?.addEventListener("keydown", onInteraction);
  return {
    snapshot,
    start,
    hydrate,
    activity,
    lookupUsername,
    act,
    logout,
    fetch: authenticatedFetch,
    retire,
    authorityLost,
    updateAccount,
    canPlay: () =>
      !enabled ||
      (available && !maintenance && session.authenticated &&
        !readPending()),
    destroy() {
      destroyed = true;
      clearLogoutRetry();
      if (channel) channel.onmessage = null;
      channel?.close();
      retire();
      eventTarget?.removeEventListener("storage", onStorage);
      eventTarget?.removeEventListener("online", onOnline);
      eventTarget?.removeEventListener("offline", onOffline);
      document?.removeEventListener("visibilitychange", onForeground);
      document?.removeEventListener("pointerdown", onInteraction);
      document?.removeEventListener("keydown", onInteraction);
    },
  };
};
