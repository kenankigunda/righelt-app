// Test-stack-only public API connection isolation. No request is replayed.
import { createServer } from "node:net";
import { createWorkerConnectionOrigin } from "./auth-worker-connections.mjs";

export async function reserveApiBackendPort(excludedPorts) {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (excludedPorts.includes(port)) throw new Error("Reserved API backend port conflicts with an owned endpoint");
  // The release→Wrangler-bind interval is not reserved. Any collision must fail
  // startup; neither a different port nor another request is tried.
  return port;
}

export async function createPublicApiConnection({ publicPort, backendPort }) {
  if (![publicPort, backendPort].every(port => Number.isInteger(port) && port > 0 && port <= 65535)
    || publicPort === backendPort) throw new Error("Distinct exact public/backend ports required");
  return createWorkerConnectionOrigin(`http://127.0.0.1:${backendPort}`, { listenPort: publicPort });
}

// A successful health response alone could belong to a port-collision winner.
// Require the exact owned Wrangler child to announce its own requested listener.
export function waitForOwnedApiReady(child, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    let tail = "";
    const finish = error => {
      clearTimeout(timer); child.stdout.off("data", data); child.stderr.off("data", data);
      child.off("exit", exited); child.off("error", failed);
      error ? reject(error) : resolve();
    };
    const exited = () => finish(new Error("Owned API exited before its exact backend listener was ready"));
    const failed = error => finish(error);
    const data = bytes => {
      tail = (tail + bytes.toString("utf8")).replace(/\x1b\[[0-9;]*[A-Za-z]/g, "").slice(-65536);
      const expected = `[wrangler:info] Ready on http://localhost:${port}`;
      if (tail.split(/\r?\n/).slice(0,-1).some(line => line.trim() === expected)) {
        if (child.exitCode !== null || child.signalCode !== null) exited(); else finish();
      }
    };
    const timer = setTimeout(() => finish(new Error("Owned API backend readiness not observed")), timeoutMs);
    child.stdout.on("data", data); child.stderr.on("data", data);
    child.once("exit", exited); child.once("error", failed);
    if (child.exitCode !== null || child.signalCode !== null) exited();
  });
}
