import { buildHomeHash, isShellRootHash, isShellRouteHash } from "./shell/routes.js";
import { registerOfflineShellServiceWorker } from "./offline/bootstrap.js";

if (isShellRootHash(window.location.hash)) {
  window.location.replace(`${window.location.pathname}${window.location.search}${buildHomeHash()}`);
} else if (!isShellRouteHash(window.location.hash)) {
  window.location.replace(`${window.location.pathname}${window.location.search}${buildHomeHash()}`);
}

const shellAppEl = document.getElementById("app");
if (shellAppEl) {
  shellAppEl.hidden = false;
}

void registerOfflineShellServiceWorker();
await import("./shell/app.js");
