#!/usr/bin/env node
// Zero-dependency static server for the HTML-to-Figma fixture pages.
//
// Serves fixtures/pages/ and fixtures/assets/ on three origins at once:
//   main    http://localhost:4173   pages are opened from here
//   second  http://127.0.0.1:4174   no CORS headers; also /login and /protected/<file>
//   third   http://127.0.0.2:4175   no CORS headers; an origin NOT on the extension allow-list
//
//   node fixtures/serve.mjs
//   H2F_PORT_MAIN=5000 H2F_PORT_SECOND=5001 H2F_PORT_THIRD=5002 node fixtures/serve.mjs
//
// Programmatic use (e.g. Playwright global setup):
//   import { start } from "./fixtures/serve.mjs";
//   const server = await start({ quiet: true });
//   ... server.origins.main ...
//   await server.close();
//
// If non-default ports are used, references to the default cross-origin hosts inside served
// HTML (127.0.0.1:4174, 127.0.0.2:4175, localhost:4173) are rewritten to the actual ports.

import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(fileURLToPath(import.meta.url));
const SERVED_DIRS = { pages: join(ROOT, "pages"), assets: join(ROOT, "assets") };
const DEFAULT_PORTS = { main: 4173, second: 4174, third: 4175 };
const SESSION_COOKIE = "h2f_session";

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/**
 * Resolve a URL path segment list inside `base`, refusing anything that escapes it.
 * @returns {string|null}
 */
function safeJoin(base, relPath) {
  if (relPath.includes("\0")) return null;
  const full = resolve(base, "." + sep + relPath);
  return full === base || full.startsWith(base + sep) ? full : null;
}

function parseCookies(header = "") {
  const out = {};
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

function page(title, bodyHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px/1.5 system-ui,sans-serif;margin:40px;color:#111827}code{background:#f3f4f6;padding:2px 4px}</style>
</head><body>${bodyHtml}</body></html>`;
}

async function serveFile(req, res, filePath, rewrite) {
  let info;
  try {
    info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = join(filePath, "index.html");
      info = await stat(filePath);
    }
  } catch {
    return send(res, 404, "Not found\n");
  }
  if (!info.isFile()) return send(res, 404, "Not found\n");
  const type = MIME[extname(filePath).toLowerCase()] ?? "application/octet-stream";
  const headers = { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

  if (rewrite && type.startsWith("text/html")) {
    const body = Buffer.from(rewrite(await readFile(filePath, "utf8")), "utf8");
    res.writeHead(200, { ...headers, "Content-Length": body.length });
    return res.end(req.method === "HEAD" ? undefined : body);
  }
  headers["Accept-Ranges"] = "bytes";
  // Single byte-range support so <video> can seek (Chrome needs 206 responses for that).
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : Math.max(0, info.size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
    if (start > end || start >= info.size) {
      res.writeHead(416, { ...headers, "Content-Range": `bytes */${info.size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${info.size}` });
    if (req.method === "HEAD") return res.end();
    return createReadStream(filePath, { start, end }).on("error", () => res.destroy()).pipe(res);
  }
  res.writeHead(200, { ...headers, "Content-Length": info.size });
  if (req.method === "HEAD") return res.end();
  createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
}

/** Build the request handler for one origin. */
function makeHandler(role, ctx) {
  return async (req, res) => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        return send(res, 405, "Method not allowed\n", { Allow: "GET, HEAD" });
      }
      const url = new URL(req.url, "http://placeholder");
      let path;
      try {
        path = decodeURIComponent(url.pathname);
      } catch {
        return send(res, 400, "Bad request\n");
      }
      if (ctx.log) console.log(`[h2f-serve] ${role} ${req.method} ${req.url}`);

      if (path === "/" || path === "") {
        return send(res, 302, "", { Location: "/pages/index.html" });
      }

      if (role === "second") {
        if (path === "/login") {
          return send(
            res,
            200,
            page("Logged in", `<h1>logged in</h1><p>Cookie <code>${SESSION_COOKIE}=ok</code> set for this origin.</p>`),
            {
              "Content-Type": MIME[".html"],
              "Set-Cookie": `${SESSION_COOKIE}=ok; SameSite=Lax; Path=/`,
            },
          );
        }
        if (path === "/logout") {
          return send(res, 200, page("Logged out", "<h1>logged out</h1>"), {
            "Content-Type": MIME[".html"],
            "Set-Cookie": `${SESSION_COOKIE}=; SameSite=Lax; Path=/; Max-Age=0`,
          });
        }
        if (path.startsWith("/protected/")) {
          if (parseCookies(req.headers.cookie)[SESSION_COOKIE] !== "ok") {
            return send(res, 401, "Unauthorized: visit /login on this origin first\n", {
              "WWW-Authenticate": 'Cookie realm="h2f"',
            });
          }
          const file = safeJoin(SERVED_DIRS.assets, path.slice("/protected/".length));
          if (!file) return send(res, 403, "Forbidden\n");
          return serveFile(req, res, file, null);
        }
      }

      if (path === "/favicon.ico") {
        return serveFile(req, res, join(SERVED_DIRS.assets, "img", "favicon.ico"), null);
      }

      const m = path.match(/^\/(pages|assets)(?:\/(.*))?$/);
      if (!m) return send(res, 404, "Not found\n");
      const file = safeJoin(SERVED_DIRS[m[1]], m[2] ?? "");
      if (!file) return send(res, 403, "Forbidden\n");
      return serveFile(req, res, file, ctx.rewrite);
    } catch (err) {
      console.error(`[h2f-serve] ${role} error`, err);
      if (!res.headersSent) send(res, 500, "Internal error\n");
      else res.destroy();
    }
  };
}

function listen(server, port, host) {
  return new Promise((resolveP, reject) => {
    const onError = (err) => reject(err);
    server.once("error", onError);
    server.listen(port, host, () => {
      server.off("error", onError);
      resolveP();
    });
  });
}

function envPort(name, fallback) {
  const v = process.env[name];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`${name} must be a port number, got "${v}"`);
  return n;
}

/**
 * Start all three origins.
 * @param {{ quiet?: boolean, log?: boolean, ports?: Partial<typeof DEFAULT_PORTS> }} [opts]
 * Pass `ports: { main: 0, ... }` for ephemeral ports (served HTML is then rewritten to match).
 * @returns {Promise<{ origins: { main: string, second: string, third: string | null },
 *   ports: { main: number, second: number, third: number | null }, close: () => Promise<void> }>}
 */
export async function start(opts = {}) {
  const ports = {
    main: opts.ports?.main ?? envPort("H2F_PORT_MAIN", DEFAULT_PORTS.main),
    second: opts.ports?.second ?? envPort("H2F_PORT_SECOND", DEFAULT_PORTS.second),
    third: opts.ports?.third ?? envPort("H2F_PORT_THIRD", DEFAULT_PORTS.third),
  };
  const ctx = { rewrite: null, log: opts.log ?? process.env.H2F_LOG === "1" };
  const servers = [];

  // Main origin: IPv4 loopback is required; IPv6 ::1 too when available, because
  // "localhost" may resolve to either.
  const mainV4 = createServer(makeHandler("main", ctx));
  await listen(mainV4, ports.main, "127.0.0.1");
  servers.push(mainV4);
  const actualMain = mainV4.address().port;
  try {
    const mainV6 = createServer(makeHandler("main", ctx));
    await listen(mainV6, actualMain, "::1");
    servers.push(mainV6);
  } catch {
    /* no IPv6 loopback — fine */
  }

  const second = createServer(makeHandler("second", ctx));
  try {
    await listen(second, ports.second, "127.0.0.1");
  } catch (err) {
    servers.forEach((s) => s.close());
    throw err;
  }
  servers.push(second);

  let thirdOrigin = null;
  const third = createServer(makeHandler("third", ctx));
  try {
    await listen(third, ports.third, "127.0.0.2");
    servers.push(third);
    thirdOrigin = `http://127.0.0.2:${third.address().port}`;
  } catch (err) {
    console.warn(
      `[h2f-serve] WARNING: could not bind 127.0.0.2:${ports.third} (${err.code ?? err.message}). ` +
        "The third origin is disabled (on macOS: sudo ifconfig lo0 alias 127.0.0.2 up).",
    );
  }

  const actual = { main: actualMain, second: second.address().port, third: thirdOrigin ? third.address().port : null };
  if (Object.keys(DEFAULT_PORTS).some((k) => actual[k] !== null && actual[k] !== DEFAULT_PORTS[k])) {
    ctx.rewrite = (html) =>
      html
        .replaceAll(`localhost:${DEFAULT_PORTS.main}`, `localhost:${actual.main}`)
        .replaceAll(`127.0.0.1:${DEFAULT_PORTS.second}`, `127.0.0.1:${actual.second}`)
        .replaceAll(`127.0.0.2:${DEFAULT_PORTS.third}`, `127.0.0.2:${actual.third ?? DEFAULT_PORTS.third}`);
  }

  const origins = {
    main: `http://localhost:${actualMain}`,
    second: `http://127.0.0.1:${second.address().port}`,
    third: thirdOrigin,
  };
  if (!opts.quiet) {
    console.log("[h2f-serve] fixture server running:");
    console.log(`  main    ${origins.main}/pages/index.html`);
    console.log(`  second  ${origins.second}   (no CORS; /login, /protected/<file>)`);
    console.log(`  third   ${origins.third ?? "(disabled)"}   (no CORS; not allow-listed)`);
  }

  let closed = false;
  return {
    origins,
    ports: actual,
    async close() {
      if (closed) return;
      closed = true;
      await Promise.all(
        servers.map(
          (s) =>
            new Promise((r) => {
              s.close(() => r());
              s.closeAllConnections?.();
            }),
        ),
      );
    },
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  start()
    .then((srv) => {
      const stop = () => srv.close().then(() => process.exit(0));
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    })
    .catch((err) => {
      console.error(`[h2f-serve] failed to start: ${err.message}`);
      process.exit(1);
    });
}
