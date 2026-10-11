process.env.RIGHELT_AUTH_CONTROLS = "only";
const { default: config } = await import("./playwright.auth.config.mjs");
export default config;
