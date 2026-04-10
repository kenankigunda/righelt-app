const HOME_ROUTE = { name: "home" };
export const FLYOUT_KEYS = ["start", "debug", "scenarios"];
const URL_FLYOUT_KEYS = ["scenarios"];
export const GAME_PANEL_KEYS = ["players", "board", "history"];
export const DEFAULT_GAME_PANEL = "board";

const trimSlash = (value) => value.replace(/^\/+|\/+$/g, "");
const normalizeGamePanel = (value) => (GAME_PANEL_KEYS.includes(value) ? value : DEFAULT_GAME_PANEL);
const getFlyoutState = (query) =>
  {
    const urlFlyouts = Object.fromEntries(URL_FLYOUT_KEYS.map((key) => [key, query.get(key) === "1"]));
    return {
      start: false,
      debug: false,
      ...urlFlyouts,
    };
  };
const withFlyoutState = (route, query) => ({
  ...route,
  ...getFlyoutState(query),
});

export const parseRouteFromHash = (hash) => {
  if (!hash || hash === "#" || hash === "#/" || hash === "") {
    return { ...HOME_ROUTE, start: false, debug: false, scenarios: false };
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
      panel: normalizeGamePanel(query.get("panel")),
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
    return Object.fromEntries(FLYOUT_KEYS.map((key, index) => [key, index === 0 ? flyouts : false]));
  }
  return Object.fromEntries(FLYOUT_KEYS.map((key) => [key, flyouts[key] === true]));
};

export const resolveFlyoutState = (
  flyouts = {},
  { allowStacking = true, preferredKey = null } = {},
) => {
  const normalizedFlyouts = normalizeFlyoutState(flyouts);
  if (allowStacking) {
    return normalizedFlyouts;
  }
  const openKeys = FLYOUT_KEYS.filter((key) => normalizedFlyouts[key] === true);
  if (openKeys.length <= 1) {
    return normalizedFlyouts;
  }
  const preservedKey = preferredKey && normalizedFlyouts[preferredKey] === true ? preferredKey : openKeys.at(-1);
  return Object.fromEntries(FLYOUT_KEYS.map((key) => [key, key === preservedKey]));
};

const appendFlyoutQuery = (hash, flyouts = {}) => {
  const normalizedFlyouts = normalizeFlyoutState(flyouts);
  if (!URL_FLYOUT_KEYS.some((key) => normalizedFlyouts[key] === true)) {
    return hash;
  }
  const query = new URLSearchParams();
  URL_FLYOUT_KEYS.forEach((key) => {
    if (normalizedFlyouts[key] === true) {
      query.set(key, "1");
    }
  });
  return `${hash}${hash.includes("?") ? "&" : "?"}${query.toString()}`;
};

export const buildHomeHash = (flyouts = {}) => appendFlyoutQuery("#/", flyouts);

export const buildGameHash = (gameId, inviteFromRole = null, routeState = {}) => {
  const safe = encodeURIComponent(gameId);
  const query = new URLSearchParams();
  if (inviteFromRole) {
    query.set("from", inviteFromRole);
  }
  const panel = normalizeGamePanel(routeState?.panel);
  if (panel !== DEFAULT_GAME_PANEL) {
    query.set("panel", panel);
  }
  const normalizedFlyouts = normalizeFlyoutState(routeState);
  URL_FLYOUT_KEYS.forEach((key) => {
    if (normalizedFlyouts[key] === true) {
      query.set(key, "1");
    }
  });
  const queryText = query.toString();
  return queryText.length > 0 ? `#/game/${safe}?${queryText}` : `#/game/${safe}`;
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
      return buildGameHash(parsed.gameId, parsed.inviteFromRole, { ...flyouts, panel: parsed.panel });
    case "invite":
      return buildInviteHash(parsed.inviteToken, flyouts);
    case "tutorial":
      return buildTutorialHash(parsed.gameId, flyouts);
    case "home":
    default:
      return buildHomeHash(flyouts);
  }
};

export const buildHashForRoute = (route) => buildHashForParsedRoute(route, route);

const toggleFlyoutHash = (hash, flyoutKey) => {
  if (!URL_FLYOUT_KEYS.includes(flyoutKey)) {
    return hash && hash !== "#" ? hash : "#/";
  }
  const raw = hash && hash !== "#" ? hash : "#/";
  const parsed = parseRouteFromHash(raw);
  return buildHashForParsedRoute(parsed, {
    ...normalizeFlyoutState(parsed),
    [flyoutKey]: !parsed[flyoutKey],
  });
};

export const toggleScenariosHash = (hash) => toggleFlyoutHash(hash, "scenarios");
