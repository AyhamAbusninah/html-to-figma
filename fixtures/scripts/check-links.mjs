#!/usr/bin/env node
// Smoke test for the fixture server and pages. Starts fixtures/serve.mjs on its default ports
// (or reuses one already running with --external), then for every page in fixtures/pages/:
//   - fetches it and expects 200 text/html,
//   - extracts every local URL (src, href, srcset, poster, CSS url(), <image href>, <use href>
//     to external files) including inside srcdoc attributes and linked stylesheets,
//   - fetches each and expects 200 (intentional failures are whitelisted below).
// It also checks the second-origin /login + /protected flow and path-traversal rejection.
//
//   node fixtures/scripts/check-links.mjs              # start the server itself
//   node fixtures/scripts/check-links.mjs --external   # use an already running server
//
// Exits non-zero if anything fails.

import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { request } from "node:http";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGES = join(HERE, "..", "pages");
const EXTERNAL = process.argv.includes("--external");
const MAIN = "http://localhost:4173";

/** URLs that are broken on purpose (see the comments at the top of each page). */
const EXPECTED_FAIL = new Map([
  ["/assets/img/does-not-exist.png", 404], // images-same-origin: broken image
  ["http://127.0.0.1:4174/protected/img/protected.png", 401], // needs the login cookie
]);

let failures = 0;
const fail = (msg) => {
  failures++;
  console.error(`  FAIL ${msg}`);
};

/** Minimal HTTP GET that does not follow redirects and allows raw paths (for traversal tests). */
function get(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request(
      { host: u.hostname, port: u.port, path: url.slice(url.indexOf("/", 8)), method: "GET", headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    req.setTimeout(10000, () => req.destroy(new Error("timeout")));
    req.end();
  });
}

const decode = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function extractUrls(html) {
  html = html.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, ""); // ignore comments
  html = html.replace(/&lt;[\s\S]*?&gt;/g, ""); // escaped markup shown as text
  const urls = new Set();
  const add = (u) => {
    u = decode(u.trim());
    if (!u || u.startsWith("#") || u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("javascript:")) return;
    if (u.includes("${")) return; // template literal inside a script
    urls.add(u);
  };
  for (const m of html.matchAll(/\s(?:src|href|poster|xlink:href)\s*=\s*("([^"]*)"|'([^']*)')/gi)) add(m[2] ?? m[3]);
  for (const m of html.matchAll(/\ssrcset\s*=\s*("([^"]*)"|'([^']*)')/gi))
    for (const part of (m[2] ?? m[3]).split(",")) add(part.trim().split(/\s+/)[0]);
  for (const m of html.matchAll(/(?<![\w.])url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) add(m[2]);
  // fetch("…") / img.src = "…" inside inline scripts
  for (const m of html.matchAll(/(?:fetch\(|\.src\s*=\s*)\s*"([^"]+)"/g)) add(m[1]);
  // srcdoc documents: recurse
  for (const m of html.matchAll(/\ssrcdoc\s*=\s*('([^']*)'|"([^"]*)")/gi))
    for (const u of extractUrls(decode(m[2] ?? m[3]))) urls.add(u);
  return urls;
}

async function checkUrl(abs, from, seen) {
  if (seen.has(abs)) return;
  seen.add(abs);
  const u = new URL(abs);
  const key = u.origin === MAIN ? u.pathname : abs.split("?")[0];
  let res;
  try {
    res = await get(abs);
  } catch (e) {
    return fail(`${abs} (from ${from}): ${e.message}`);
  }
  const expected = EXPECTED_FAIL.get(key) ?? 200;
  if (res.status !== expected) return fail(`${abs} (from ${from}): HTTP ${res.status}, expected ${expected}`);
  if (res.headers["cache-control"] !== "no-store") fail(`${abs}: missing Cache-Control: no-store`);
  if (res.headers["access-control-allow-origin"]) fail(`${abs}: unexpected CORS header`);
  if (res.status === 200 && /text\/css/.test(res.headers["content-type"] ?? "")) {
    for (const ref of extractUrls(res.body.toString("utf8"))) await checkUrl(new URL(ref, abs).href, abs, seen);
  }
}

let server;
if (!EXTERNAL) {
  const { start } = await import("../serve.mjs");
  server = await start({ quiet: true });
}

try {
  const pages = readdirSync(PAGES).filter((f) => f.endsWith(".html")).sort();
  const seen = new Set();
  console.log(`check-links: ${pages.length} pages`);
  for (const page of pages) {
    const url = `${MAIN}/pages/${page}`;
    const res = await get(url);
    if (res.status !== 200 || !/text\/html/.test(res.headers["content-type"] ?? "")) {
      fail(`${url}: HTTP ${res.status} ${res.headers["content-type"]}`);
      continue;
    }
    const html = res.body.toString("utf8");
    if (!/^<!doctype html>\s*<!--[\s\S]*?Requirements?:/i.test(html)) fail(`${page}: missing header comment with requirement IDs`);
    const refs = [...extractUrls(html)];
    for (const ref of refs) await checkUrl(new URL(ref, url).href, page, seen);
    console.log(`  ok   ${page.padEnd(26)} ${refs.length} refs`);
  }

  // Server behaviour checks.
  const S = "http://127.0.0.1:4174";
  const login = await get(`${S}/login`);
  const cookie = (login.headers["set-cookie"] ?? [])[0] ?? "";
  if (login.status !== 200 || !/h2f_session=ok/.test(cookie) || !/SameSite=Lax/i.test(cookie))
    fail(`/login: status ${login.status}, set-cookie "${cookie}"`);
  const prot = await get(`${S}/protected/img/protected.png`, { cookie: "h2f_session=ok" });
  if (prot.status !== 200 || prot.headers["content-type"] !== "image/png") fail(`/protected with cookie: HTTP ${prot.status}`);
  const noProt = await get(`${MAIN}/protected/img/protected.png`, { cookie: "h2f_session=ok" });
  if (noProt.status !== 404) fail(`/protected must only exist on the second origin (main gave ${noProt.status})`);
  for (const evil of ["/pages/../serve.mjs", "/assets/%2e%2e/serve.mjs", "/pages/..%2f..%2fREQUIREMENTS.md", "/assets/img/%00.png"]) {
    const r = await get(`${MAIN}${evil}`);
    if (r.status === 200) fail(`path traversal not blocked: ${evil}`);
  }
  const traversalProt = await get(`${S}/protected/..%2f..%2fserve.mjs`, { cookie: "h2f_session=ok" });
  if (traversalProt.status === 200) fail("path traversal via /protected not blocked");
  try {
    const third = await get("http://127.0.0.2:4175/assets/img/remote-c.png");
    if (third.status !== 200) fail(`third origin: HTTP ${third.status}`);
  } catch (e) {
    console.warn(`  warn third origin unreachable (${e.message}) — expected on macOS without a lo0 alias`);
  }
  console.log(`check-links: ${seen.size} unique asset URLs checked, ${failures} failure(s).`);
} finally {
  await server?.close();
}
process.exit(failures ? 1 : 0);
