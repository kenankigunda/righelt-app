export const HOVER_CAPABILITY_ATTRIBUTE = "data-hover-capability";
export const HOVER_CAPABILITY_QUERY = "(any-hover: hover)";

let hoverCapabilityController = null;

export function detectSupportsHover(matchMediaFn) {
  if (typeof matchMediaFn !== "function") {
    return false;
  }
  return matchMediaFn(HOVER_CAPABILITY_QUERY).matches === true;
}

export function applyHoverCapabilityMarker(root, supportsHover) {
  if (!root || typeof root.setAttribute !== "function") {
    return;
  }
  root.setAttribute(HOVER_CAPABILITY_ATTRIBUTE, supportsHover ? "hover" : "none");
}

export function createHoverCapabilityController({
  root = globalThis.document?.documentElement ?? null,
  windowObject = globalThis.window ?? null,
} = {}) {
  const listeners = new Set();
  const mediaQueryList = windowObject?.matchMedia?.(HOVER_CAPABILITY_QUERY) ?? null;
  let supportsHover = mediaQueryList?.matches === true;

  const notify = () => {
    supportsHover = mediaQueryList?.matches === true;
    applyHoverCapabilityMarker(root, supportsHover);
    for (const listener of listeners) {
      listener(supportsHover);
    }
  };

  applyHoverCapabilityMarker(root, supportsHover);

  if (mediaQueryList) {
    if (typeof mediaQueryList.addEventListener === "function") {
      mediaQueryList.addEventListener("change", notify);
    } else if (typeof mediaQueryList.addListener === "function") {
      mediaQueryList.addListener(notify);
    }
  }

  return {
    getSupportsHover() {
      return supportsHover;
    },
    subscribe(listener) {
      if (typeof listener !== "function") {
        return () => {};
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() {
      if (mediaQueryList) {
        if (typeof mediaQueryList.removeEventListener === "function") {
          mediaQueryList.removeEventListener("change", notify);
        } else if (typeof mediaQueryList.removeListener === "function") {
          mediaQueryList.removeListener(notify);
        }
      }
      listeners.clear();
    },
  };
}

export function ensureHoverCapabilityController(options) {
  if (!hoverCapabilityController) {
    hoverCapabilityController = createHoverCapabilityController(options);
  }
  return hoverCapabilityController;
}
