import { fileURLToPath } from "node:url";
import { webkit } from "@playwright/test";

// Older macOS WebKit leaks AppKit animation threads while the display sleeps,
// eventually preventing navigation before any request reaches the application.
// https://github.com/microsoft/playwright/issues/42385#issuecomment-5539073362
// Remove once the pinned WebKit includes the upstream fix and the long-running
// display-asleep regression passes without this process-local workaround.
export const browserLaunchOptions = (name, {
  platform = process.platform,
  env = process.env,
  webkitExecutablePath = () => webkit.executablePath(),
} = {}) => {
  const executablePath = env[`RIGHELT_${name.toUpperCase()}_EXECUTABLE`];
  if (platform !== "darwin" || name !== "webkit") return { executablePath };
  return {
    executablePath: fileURLToPath(new URL("./webkit-no-window-animations.sh", import.meta.url)),
    env: {
      ...env,
      RIGHELT_WEBKIT_BROWSER_EXECUTABLE: executablePath || webkitExecutablePath(),
    },
  };
};
