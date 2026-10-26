import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
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
  // Retain native backend diagnostics for Linux-only suspended audio failures.
  // This changes logging only, without overriding autoplay or output devices.
  if (platform === "linux" && name === "firefox" && env.CI) {
    return { executablePath, env: { ...env,
      MOZ_LOG: env.MOZ_LOG || "timestamp,cubeb:5,AudioStream:5,MediaTrackGraph:2,rotate:4",
      MOZ_LOG_FILE: env.MOZ_LOG_FILE || resolve("test-results/firefox-native-audio.log"),
    } };
  }
  // Headless Linux runners have no sound card. Keep WebAudio processing enabled
  // with OpenAL's null output instead of repeatedly probing missing devices.
  if (platform === "linux" && name === "webkit" && env.CI) {
    return { executablePath, env: { ...env, ALSOFT_DRIVERS: env.ALSOFT_DRIVERS || "null" } };
  }
  if (platform !== "darwin" || name !== "webkit") return { executablePath };
  return {
    executablePath: fileURLToPath(new URL("./webkit-no-window-animations.sh", import.meta.url)),
    env: {
      ...env,
      RIGHELT_WEBKIT_BROWSER_EXECUTABLE: executablePath || webkitExecutablePath(),
    },
  };
};
