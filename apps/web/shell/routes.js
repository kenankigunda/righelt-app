const HOME_ROUTE = { name: "home" };

const trimSlash = (value) => value.replace(/^\/+|\/+$/g, "");
const getFlyoutState = (query) => ({
  debug: query.get("debug") === "1",
  scenarios: query.get("scenarios") === "1",
});
const withFlyoutState = (route, query) => ({
  ...route,
  ...getFlyoutState(query),
});

export const parseRouteFromHash = (hash) => {
  if (!hash || hash === "#" || hash === "#/" || hash === "") {
    return { ...HOME_ROUTE, debug: false, scenarios: false };
  }

  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryIndex = raw.indexOf("?");
  const pathOnly = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
  const queryText = queryIndex >= 0 ? raw.slice(queryIndex + 1) : "";
  const path = trimSlash(pathOnly);
  const parts = path ? path.split("/") : [];

  const query = new URLSearchParams(queryText);

  if (parts.length === 0) {
    return { ...HOME_ROUTE, ...getFlyoutState(query) };
  }

  if (parts[0] === "game" && parts[1]) {
    return withFlyoutState({
      name: "game",
      gameId: decodeURIComponent(parts[1]),
      inviteFromRole: query.get("from") || null,
    }, query);
  }

  if (parts[0] === "invite" && parts[1]) {
    return withFlyoutState({
      name: "invite",
      inviteToken: decodeURIComponent(parts[1]),
    }, query);
  }

  if (parts[0] === "tutorial") {
    return withFlyoutState({
      name: "tutorial",
      gameId: parts[1] ? decodeURIComponent(parts[1]) : null,
    }, query);
  }

  return withFlyoutState({ name: "not-found" }, query);
};

const normalizeFlyoutState = (flyouts = {}) => {
  if (typeof flyouts === "boolean") {
    return { debug: flyouts, scenarios: false };
  }
  return {
    debug: flyouts.debug === true,
    scenarios: flyouts.scenarios === true,
  };
};

const appendFlyoutQuery = (hash, flyouts = {}) => {
  const { debug, scenarios } = normalizeFlyoutState(flyouts);
  if (!debug && !scenarios) {
    return hash;
  }
  const query = new URLSearchParams();
  if (debug) {
    query.set("debug", "1");
  }
  if (scenarios) {
    query.set("scenarios", "1");
  }
  return `${hash}${hash.includes("?") ? "&" : "?"}${query.toString()}`;
};

export const buildHomeHash = (flyouts = {}) => appendFlyoutQuery("#/", flyouts);

export const buildGameHash = (gameId, inviteFromRole = null, flyouts = {}) => {
  const safe = encodeURIComponent(gameId);
  if (!inviteFromRole) {
    return appendFlyoutQuery(`#/game/${safe}`, flyouts);
  }
  return appendFlyoutQuery(`#/game/${safe}?from=${encodeURIComponent(inviteFromRole)}`, flyouts);
};

export const buildInviteHash = (inviteToken, flyouts = {}) => appendFlyoutQuery(`#/invite/${encodeURIComponent(inviteToken)}`, flyouts);

export const buildTutorialHash = (gameId = null, flyouts = {}) => {
  if (!gameId) {
    return appendFlyoutQuery("#/tutorial", flyouts);
  }
  return appendFlyoutQuery(`#/tutorial/${encodeURIComponent(gameId)}`, flyouts);
};

export const shouldLiveSyncRoute = (route) => route?.name === "game" || route?.name === "invite";

export const shouldPassiveRefreshRoute = (route) => route?.name === "home";

export const isShellRootHash = (hash) => {
  return !hash || hash === "#" || hash === "#/" || hash === "";
};

export const isShellRouteHash = (hash) => {
  if (!hash || hash === "#" || hash === "#/" || hash === "") {
    return true;
  }
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const pathOnly = raw.includes("?") ? raw.slice(0, raw.indexOf("?")) : raw;
  return (
    pathOnly === "/game" ||
    pathOnly.startsWith("/game/") ||
    pathOnly === "/invite" ||
    pathOnly.startsWith("/invite/") ||
    pathOnly === "/tutorial" ||
    pathOnly.startsWith("/tutorial/")
  );
};

const buildHashForParsedRoute = (parsed, flyouts) => {
  switch (parsed.name) {
    case "game":
      return buildGameHash(parsed.gameId, parsed.inviteFromRole, flyouts);
    case "invite":
      return buildInviteHash(parsed.inviteToken, flyouts);
    case "tutorial":
      return buildTutorialHash(parsed.gameId, flyouts);
    case "home":
    default:
      return buildHomeHash(flyouts);
  }
};

const toggleFlyoutHash = (hash, flyoutKey) => {
  const raw = hash && hash !== "#" ? hash : "#/";
  const parsed = parseRouteFromHash(raw);
  return buildHashForParsedRoute(parsed, {
    debug: parsed.debug,
    scenarios: parsed.scenarios,
    [flyoutKey]: !parsed[flyoutKey],
  });
};

export const toggleDebugHash = (hash) => toggleFlyoutHash(hash, "debug");

export const toggleScenariosHash = (hash) => toggleFlyoutHash(hash, "scenarios");
