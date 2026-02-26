const BOOTSTRAP_CACHE_CONTROL = "public, max-age=0, s-maxage=60, stale-while-revalidate=300";

const STATIC_BOOTSTRAP_PAYLOAD = Object.freeze({
  app: "righelt-web-shell",
  specVersion: 1,
  tutorialSteps: Object.freeze([
    "Select your role",
    "Review board state",
    "Make a move",
    "Inspect history and return live",
    "Invite participants",
  ]),
});

export const getBootstrapPayload = () => STATIC_BOOTSTRAP_PAYLOAD;

export const getBootstrapCachePolicy = () => BOOTSTRAP_CACHE_CONTROL;

export const shouldDeferNonCriticalLoad = ({ firstRenderComplete }) => firstRenderComplete === true;
