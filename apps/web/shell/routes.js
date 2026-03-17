const HOME_ROUTE = { name: "home" };

const trimSlash = (value) => value.replace(/^\/+|\/+$/g, "");
const withDebugState = (route, query) => ({
  ...route,
  debug: query.get("debug") === "1",
});

export const parseRouteFromHash = (hash) => {
  if (!hash || hash === "#" || hash === "#/" || hash === "") {
    return { ...HOME_ROUTE, debug: false };
  }

  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryIndex = raw.indexOf("?");
  const pathOnly = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
  const queryText = queryIndex >= 0 ? raw.slice(queryIndex + 1) : "";
  const path = trimSlash(pathOnly);
  const parts = path ? path.split("/") : [];

  const query = new URLSearchParams(queryText);

  if (parts.length === 0) {
    return { ...HOME_ROUTE, debug: query.get("debug") === "1" };
  }

  if (parts[0] === "game" && parts[1]) {
    return withDebugState({
      name: "game",
      gameId: decodeURIComponent(parts[1]),
      inviteFromRole: query.get("from") || null,
    }, query);
  }

  if (parts[0] === "invite" && parts[1]) {
    return withDebugState({
      name: "invite",
      inviteToken: decodeURIComponent(parts[1]),
    }, query);
  }

  if (parts[0] === "tutorial") {
    return withDebugState({
      name: "tutorial",
      gameId: parts[1] ? decodeURIComponent(parts[1]) : null,
    }, query);
  }

  return withDebugState({ name: "not-found" }, query);
};

export const buildHomeHash = (debug = false) => appendDebugQuery("#/", debug);

const appendDebugQuery = (hash, debug = false) => {
  if (!debug) {
    return hash;
  }
  return `${hash}${hash.includes("?") ? "&" : "?"}debug=1`;
};

export const buildGameHash = (gameId, inviteFromRole = null, debug = false) => {
  const safe = encodeURIComponent(gameId);
  if (!inviteFromRole) {
    return appendDebugQuery(`#/game/${safe}`, debug);
  }
  return appendDebugQuery(`#/game/${safe}?from=${encodeURIComponent(inviteFromRole)}`, debug);
};

export const buildInviteHash = (inviteToken, debug = false) => appendDebugQuery(`#/invite/${encodeURIComponent(inviteToken)}`, debug);

export const buildTutorialHash = (gameId = null, debug = false) => {
  if (!gameId) {
    return appendDebugQuery("#/tutorial", debug);
  }
  return appendDebugQuery(`#/tutorial/${encodeURIComponent(gameId)}`, debug);
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

export const toggleDebugHash = (hash) => {
  const raw = hash && hash !== "#" ? hash : "#/";
  const parsed = parseRouteFromHash(raw);
  switch (parsed.name) {
    case "game":
      return buildGameHash(parsed.gameId, parsed.inviteFromRole, !parsed.debug);
    case "invite":
      return buildInviteHash(parsed.inviteToken, !parsed.debug);
    case "tutorial":
      return buildTutorialHash(parsed.gameId, !parsed.debug);
    case "home":
      return parsed.debug ? "#/" : "#/?debug=1";
    default:
      return parsed.debug ? "#/" : "#/?debug=1";
  }
};
