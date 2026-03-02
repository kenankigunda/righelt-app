const HOME_ROUTE = { name: "home" };

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
  const parts = path ? path.split("/") : [];

  const query = new URLSearchParams(queryText);

  if (parts.length === 0) {
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

export const buildHomeHash = () => "#/";

export const buildGameHash = (gameId, inviteFromRole = null) => {
  const safe = encodeURIComponent(gameId);
  if (!inviteFromRole) {
    return `#/game/${safe}`;
  }
  return `#/game/${safe}?from=${encodeURIComponent(inviteFromRole)}`;
};

export const buildInviteHash = (inviteToken) => `#/invite/${encodeURIComponent(inviteToken)}`;

export const buildTutorialHash = (gameId = null) => {
  if (!gameId) {
    return "#/tutorial";
  }
  return `#/tutorial/${encodeURIComponent(gameId)}`;
};

export const shouldLiveReconcileRoute = (route) =>
  route?.name === "home" || route?.name === "game" || route?.name === "invite";
