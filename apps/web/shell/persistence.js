const SHELL_STATE_KEY = "righelt.shell.state.v1";
const LIVE_TRANSPORT_STATE_KEY = "righelt.live_transport.state.v1";
const IDENTITY_KEY = "righelt.identity.id.v1";
const TUTORIAL_KEY = "righelt.tutorial.done.v1";
const DEBUG_FLYOUT_KEY = "righelt.debug.flyout.v1";

export const loadJson = (storage, key, fallback) => {
  try {
    const raw = storage.getItem(key);
    if (!raw) {
      return fallback;
    }
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
};

export const saveJson = (storage, key, value) => {
  storage.setItem(key, JSON.stringify(value));
};

export const loadShellState = (storage) => loadJson(storage, SHELL_STATE_KEY, { games: [] });
export const saveShellState = (storage, state) => saveJson(storage, SHELL_STATE_KEY, state);
export const loadLiveTransportState = (storage) =>
  loadJson(storage, LIVE_TRANSPORT_STATE_KEY, {
    games: [],
    warningCode: null,
    pendingMutationsByGameId: {},
  });
export const saveLiveTransportState = (storage, state) => saveJson(storage, LIVE_TRANSPORT_STATE_KEY, state);

export const loadIdentity = (storage) => storage.getItem(IDENTITY_KEY);
export const saveIdentity = (storage, identityId) => storage.setItem(IDENTITY_KEY, identityId);

export const loadTutorialCompleted = (storage) => storage.getItem(TUTORIAL_KEY) === "1";
export const saveTutorialCompleted = (storage, value) => storage.setItem(TUTORIAL_KEY, value ? "1" : "0");

export const loadDebugFlyoutOpen = (storage) => storage.getItem(DEBUG_FLYOUT_KEY) === "1";
export const saveDebugFlyoutOpen = (storage, value) => storage.setItem(DEBUG_FLYOUT_KEY, value ? "1" : "0");
