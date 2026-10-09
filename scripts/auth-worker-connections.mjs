// Isolated test-stack transport. Each forwarded request has one backend socket.
// No application requests are retried, including ambiguous mutation failures.
import http from "node:http";

function destination(input) {
  const url = new URL(input);
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash)
    throw new Error("Account worker forwarding requires a fixed loopback HTTP origin");
  return url;
}

export async function createWorkerConnectionOrigin(input) {
  const target = destination(input);
  const sockets = new Set();
  const track = socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  };
  const options = request => ({
    hostname: target.hostname === "localhost" ? "127.0.0.1" : target.hostname.replace(/^\[|\]$/g, ""),
    port: Number(target.port), path: request.url, method: request.method,
    headers: request.rawHeaders, agent: false,
  });
  const server = http.createServer((request, response) => {
    const outgoing = http.request(options(request), incoming => {
      // Connection lifetime belongs to the adapter, not to application headers.
      const headers = incoming.rawHeaders.filter((_value, index, all) =>
        all[index - index % 2].toLowerCase() !== "connection");
      response.shouldKeepAlive = false;
      response.writeHead(incoming.statusCode, incoming.statusMessage, headers);
      incoming.on("error", () => response.destroy());
      incoming.on("end", () => response.addTrailers(incoming.trailers));
      incoming.pipe(response);
    });
    outgoing.on("socket", track);
    // Preserve a failed forwarding request as a failed connection. In particular,
    // never turn a lost response after a POST into success or a second POST.
    outgoing.on("error", () => response.destroy());
    request.on("aborted", () => outgoing.destroy());
    request.on("error", () => outgoing.destroy());
    response.on("close", () => { if (!response.writableFinished) outgoing.destroy(); });
    request.pipe(outgoing);
  });
  server.on("connection", track);
  server.on("upgrade", (request, client, head) => {
    const outgoing = http.request(options(request));
    outgoing.on("socket", track);
    outgoing.on("upgrade", (incoming, backend, backendHead) => {
      const headers = incoming.rawHeaders;
      let start = `HTTP/${incoming.httpVersion} ${incoming.statusCode} ${incoming.statusMessage}\r\n`;
      for (let index = 0; index < headers.length; index += 2) start += `${headers[index]}: ${headers[index + 1]}\r\n`;
      client.write(start + "\r\n");
      if (backendHead.length) client.write(backendHead);
      if (head.length) backend.write(head);
      client.on("error", () => backend.destroy());
      backend.on("error", () => client.destroy());
      client.on("close", () => backend.destroy());
      backend.on("close", () => client.destroy());
      client.pipe(backend); backend.pipe(client);
    });
    // A rejected upgrade still returns its real HTTP response and complete body.
    outgoing.on("response", incoming => {
      let start = `HTTP/${incoming.httpVersion} ${incoming.statusCode} ${incoming.statusMessage}\r\n`;
      // IncomingMessage has decoded chunk framing; close-delimit this response.
      for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
        const name = incoming.rawHeaders[index];
        if (!["connection", "transfer-encoding", "content-length"].includes(name.toLowerCase()))
          start += `${name}: ${incoming.rawHeaders[index + 1]}\r\n`;
      }
      client.write(start + "Connection: close\r\n\r\n");
      incoming.on("error", () => client.destroy());
      incoming.pipe(client);
    });
    outgoing.on("error", () => client.destroy());
    client.on("error", () => outgoing.destroy());
    client.on("close", () => outgoing.destroy());
    outgoing.end();
  });
  // There is no server idle-close timer racing the caller's connection pool.
  // Ordinary responses close as soon as their complete body has been sent.
  server.keepAliveTimeout = 0;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  let closing;
  const retire = () => closing ??= new Promise(resolve => server.close(resolve));
  return {
    target: target.origin,
    url: new URL(`http://127.0.0.1:${server.address().port}`),
    retire,
    async close() {
      const done = retire();
      await Promise.all([...sockets].map(socket => new Promise(resolve => {
        socket.once("close", resolve); socket.destroy();
      })));
      await done;
    },
  };
}

export function createWorkerConnectionPool() {
  const owners = new WeakMap();
  return {
    origin(owner, input, isCurrent = () => true) {
      const target = destination(input);
      let state = owners.get(owner);
      if (!state) owners.set(owner, state = { entries: new Set(), current: null, chain: Promise.resolve(), closed: false });
      return state.chain = state.chain.catch(() => {}).then(async () => {
        if (state.closed || !isCurrent()) return target;
        if (state.current?.target === target.origin) return state.current.url;
        const connection = await createWorkerConnectionOrigin(target);
        state.entries.add(connection);
        if (state.closed || !isCurrent()) {
          await connection.close(); state.entries.delete(connection); return target;
        }
        const previous = state.current;
        state.current = connection;
        // Stop accepting on a replaced origin, but allow its in-flight response
        // or upgrade to finish. Teardown also closes any remaining active sockets.
        if (previous) void previous.retire();
        return connection.url;
      });
    },
    async close(owner) {
      const state = owners.get(owner);
      if (!state) return;
      state.closed = true;
      await state.chain.catch(() => {});
      await Promise.all([...state.entries].map(entry => entry.close()));
      if (owners.get(owner) === state) owners.delete(owner);
    },
  };
}
const pool = createWorkerConnectionPool();
export const workerConnectionOrigin = (owner, input, isCurrent) =>
  process.env.RIGHELT_AUTH_FRESH_CONNECTIONS === "1" ? pool.origin(owner, input, isCurrent) : input;
export const closeWorkerConnections = owner => pool.close(owner);
