import { CACHE_BOOTSTRAP_SHORT } from "../generated/packages/shared-types/src/http.js";

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

export const getBootstrapCachePolicy = () => CACHE_BOOTSTRAP_SHORT;

export const shouldDeferNonCriticalLoad = ({ firstRenderComplete }) => firstRenderComplete === true;
