const HOME_ROUTE = { name: "home" };
const SHELL_BASE = "shell";
const SHELL_ROUTE_PREFIXES = ["/shell/home", "/shell/game/", "/shell/invite/", "/shell/tutorial"];

const trimSlash = (value) => value.replace(/^\/+|\/+$/g, "");

export const parseRouteFromHash = (hash) => {
  if (!hash || hash === "#" || hash === "#/" || hash === "") {
    return HOME_ROUTE;
  }

  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  const queryIndex = raw.indexOf("?");
  const pathOnly = queryIndex >= 0 ? raw.slice(0, queryIndex) : raw;
  const queryText = queryIndex >= 0 ? raw.slice(queryIndex + 1) : "";
  const path = trimSlash(pathOnly);
  const rawParts = path ? path.split("/") : [];
  const parts = rawParts[0] === SHELL_BASE ? rawParts.slice(1) : rawParts;

  const query = new URLSearchParams(queryText);

  if (parts.length === 0) {
    return HOME_ROUTE;
  }

  if (parts[0] === "home") {
    return HOME_ROUTE;
  }

  if (parts[0] === "game" && parts[1]) {
    return {
      name: "game",
      gameId: decodeURIComponent(parts[1]),
      inviteFromRole: query.get("from") || null,
    };
  }

  if (parts[0] === "invite" && parts[1]) {
    return {
      name: "invite",
      inviteToken: decodeURIComponent(parts[1]),
    };
  }

  if (parts[0] === "tutorial") {
    return {
      name: "tutorial",
      gameId: parts[1] ? decodeURIComponent(parts[1]) : null,
    };
  }

  return { name: "not-found" };
};

export const buildHomeHash = () => "#/shell/home";

export const buildGameHash = (gameId, inviteFromRole = null) => {
  const safe = encodeURIComponent(gameId);
  if (!inviteFromRole) {
    return `#/shell/game/${safe}`;
  }
  return `#/shell/game/${safe}?from=${encodeURIComponent(inviteFromRole)}`;
};

export const buildInviteHash = (inviteToken) => `#/shell/invite/${encodeURIComponent(inviteToken)}`;

export const buildTutorialHash = (gameId = null) => {
  if (!gameId) {
    return "#/shell/tutorial";
  }
  return `#/shell/tutorial/${encodeURIComponent(gameId)}`;
};

export const shouldLiveSyncRoute = (route) => route?.name === "home" || route?.name === "game";

export const shouldPassiveRefreshRoute = (route) =>
  route?.name === "home" || route?.name === "game" || route?.name === "invite";

export const getLiveSyncRouteKey = (route) =>
  route?.name === "game" ? `game:${route.gameId}` : route?.name === "home" ? "home" : "none";

export const isShellRootHash = (hash) => {
  if (!hash) {
    return false;
  }
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return raw === "/shell";
};

export const isShellRouteHash = (hash) => {
  if (!hash || hash === "#" || hash === "#/" || hash === "") {
    return false;
  }

  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return SHELL_ROUTE_PREFIXES.some((prefix) => raw === prefix || raw.startsWith(prefix));
};
