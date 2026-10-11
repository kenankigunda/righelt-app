// Deployment settings are exact origins, never URL prefixes.
export function requireDeploymentOrigin(value, setting) {
  let url;
  try { url = new URL(value); } catch {}
  if (typeof value !== "string" || !url || url.protocol !== "https:" || url.origin !== value)
    throw Error(`${setting} must be one exact HTTPS origin (no trailing slash, path, credentials, query or fragment)`);
  return value;
}
