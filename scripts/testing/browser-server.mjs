import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};
export function createBrowserServer() {
  return createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(
        new URL(req.url, "http://localhost").pathname,
      );
      const file = path.resolve(
        root,
        "." +
          (pathname === "/"
            ? "/browser-integration/support/account.html"
            : pathname),
      );
      if (
        !file.startsWith(root + path.sep) ||
        !["browser-integration", "apps/web"].some((dir) =>
          file.startsWith(path.join(root, dir) + path.sep),
        )
      ) {
        res.writeHead(403).end();
        return;
      }
      res
        .writeHead(200, {
          "Content-Type":
            types[path.extname(file)] ?? "application/octet-stream",
          "Cache-Control": "no-store",
        })
        .end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createBrowserServer();
  server.listen(Number(process.env.RIGHELT_BROWSER_PORT ?? 10188), "127.0.0.1");
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => server.close(() => process.exit()));
}
