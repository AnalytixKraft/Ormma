/* The first page the desktop app opens: choose your password. It stands in
 * for scripts/setup.sh, which asks for one in a terminal — someone who
 * installed Ormma from a download has no terminal open, and should not need
 * one.
 *
 * It answers on Ormma's own port, before the app starts, and only while no
 * password is set: on the first run, and after `Ormma reset-password`. The
 * password goes where Settings → Password puts one — a salted scrypt hash in
 * the app's database — and the answer carries the app's own sign-in cookie,
 * so the next page is Ormma, already signed in.
 *
 * Whoever reaches this page first chooses the password, so it is reachable
 * from this computer only: it listens on 127.0.0.1, takes a form only from
 * itself (as the app does), and answers only to a Host of localhost or
 * 127.0.0.1 — not to another name that some web page pointed at 127.0.0.1. */

import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { COOKIE, MAX_AGE_S, MAX_PASSWORD, MIN_PASSWORD, createAuth, hashPassword } from "../../app/src/auth.mjs";
import { zonedNow } from "../../app/src/dates.mjs";
import { SECURITY_HEADERS, isSameOrigin, readForm, serializeCookie } from "../../app/src/http.mjs";
import { html } from "../../app/src/views/html.mjs";
import { APP_NAME, APP_TAGLINE, dayHeader, layout, stepHtml } from "../../app/src/views/layout.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP_PUBLIC = join(HERE, "..", "..", "app", "public");
const STATIC = {
  "style.css": [join(APP_PUBLIC, "style.css"), "text/css; charset=utf-8"],
  "favicon.svg": [join(APP_PUBLIC, "favicon.svg"), "image/svg+xml"],
  "apple-touch-icon.png": [join(APP_PUBLIC, "apple-touch-icon.png"), "image/png"],
  "icon-512.png": [join(APP_PUBLIC, "icon-512.png"), "image/png"],
  "manifest.webmanifest": [join(APP_PUBLIC, "manifest.webmanifest"), "application/manifest+json"],
  "first-run.js": [join(HERE, "..", "public", "first-run.js"), "text/javascript; charset=utf-8"],
};
const ASSETS = { css: "/static/style.css", js: "/static/first-run.js" };

export const isLocalHost = (host, port) => [`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`].includes(String(host).toLowerCase());

const cover = html`<div class="signin__cover">
    <img class="signin__mark" src="/static/favicon.svg" alt="" width="64" height="64">
    <h1>${APP_NAME}</h1>
    <p class="signin__tagline">${APP_TAGLINE}</p>
  </div>`;

export function choosePage({ today, error = null, hints = null }) {
  return layout({
    title: "Welcome",
    signedIn: false,
    assets: ASSETS,
    body: html`<div class="signin">
  ${cover}
  <form method="post" action="/" class="signin__form">
    ${dayHeader({ date: today, size: "small", heading: "p" })}
    <h2>Welcome</h2>
    <p>Choose a password for Ormma. You sign in with it in this browser, on this computer — Ormma answers nowhere else.</p>
    <label class="field">
      <span class="field__label">Password <span class="optional">${MIN_PASSWORD}+ characters</span></span>
      <input type="password" name="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" maxlength="${MAX_PASSWORD}" required autofocus>
    </label>
    <label class="field">
      <span class="field__label">Password again</span>
      <input type="password" name="again" autocomplete="new-password" minlength="${MIN_PASSWORD}" maxlength="${MAX_PASSWORD}" required>
    </label>
    ${error ? html`<p class="field__error" role="alert">${error}</p>` : ""}
    <button type="submit" class="button">Start Ormma</button>
    <p class="hint">Your list, your calendar and your notes stay on this computer.${hints ? html` If you forget the password one day, ${stepHtml(hints.reset)}, and this page comes back.` : ""}</p>
  </form>
</div>`,
  });
}

export function startingPage() {
  return layout({
    title: "Starting",
    signedIn: false,
    assets: ASSETS,
    body: html`<div class="signin">
  ${cover}
  <div class="signin__form" id="starting">
    <h2>Ormma is starting</h2>
    <p>Your password is set. In a moment this page opens Ormma.</p>
    <p>Then link your WhatsApp in <strong>Settings → WhatsApp</strong>: on the phone, WhatsApp → Settings → Linked devices → Link a device, and scan the code.</p>
    <p class="hint">Nothing after a minute? <a href="/">Open Ormma</a>.</p>
  </div>
</div>`,
  });
}

/* What a submitted form is wrong about, or null. */
export function passwordProblem(password, again) {
  if (password.length < MIN_PASSWORD) return `The password needs at least ${MIN_PASSWORD} characters.`;
  if (password.length > MAX_PASSWORD) return `The password can be at most ${MAX_PASSWORD} characters.`;
  if (password !== again) return "The two passwords are not the same — type them again.";
  return null;
}

/* Serves the page on 127.0.0.1:`port` until a password is chosen.
 * → { listening: Promise (rejects when the port is taken), chosen: Promise
 * (resolves once the password is stored and the answer sent), close() }.
 * `store` is where the hash goes — {hash(), set(hash)}, as db.password. */
export function startFirstRun({ port, timezone, store, secret, fallbackPassword, hints = null, log = () => {} }) {
  const files = new Map();
  const file = async (name) => {
    if (!files.has(name)) files.set(name, await readFile(STATIC[name][0]));
    return files.get(name);
  };
  let choose;
  const chosen = new Promise((resolve) => (choose = resolve));
  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, { ...SECURITY_HEADERS, "cache-control": "no-store", "content-type": "text/html; charset=utf-8", ...headers });
    res.end(String(body));
  };
  const today = () => zonedNow(new Date(), timezone);

  const server = createServer(async (req, res) => {
    try {
      if (!isLocalHost(req.headers.host, port)) return send(res, 421, "Open Ormma at http://localhost:" + port, { "content-type": "text/plain; charset=utf-8" });
      const path = new URL(req.url || "/", "http://ormma").pathname;
      if (path === "/healthz") return send(res, 200, JSON.stringify({ ok: true, setup: true }), { "content-type": "application/json" });
      if (path.startsWith("/static/")) {
        const name = path.slice("/static/".length);
        if (!Object.hasOwn(STATIC, name)) return send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
        return send(res, 200, await file(name), { "content-type": STATIC[name][1] });
      }
      if (req.method === "POST") {
        if (!isSameOrigin(req)) return send(res, 403, "That form was sent from another site, so it was not accepted.", { "content-type": "text/plain; charset=utf-8" });
        const form = await readForm(req, 16_384);
        const password = form.raw("password");
        const problem = passwordProblem(password, form.raw("again"));
        if (problem) return send(res, 400, choosePage({ today: today(), error: problem, hints }));
        store.set(hashPassword(password));
        log("a password was chosen on the first-run page");
        // Signed as the app signs it — the same secret, the password just
        // stored — so the app takes it as its own.
        const auth = createAuth({ password: fallbackPassword, secret, store });
        send(res, 200, startingPage(), { "set-cookie": serializeCookie(COOKIE, auth.issue(), { maxAge: MAX_AGE_S }) });
        res.once("finish", () => choose());
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "Method not allowed", { "content-type": "text/plain; charset=utf-8" });
      // Every other address is this page: whatever was bookmarked, the
      // first thing to do is choose the password.
      send(res, 200, choosePage({ today: today(), hints }));
    } catch (err) {
      log(`first-run page: ${err?.stack || err}`);
      if (!res.headersSent) send(res, err?.status || 500, err?.status ? err.message : "Something went wrong.", { "content-type": "text/plain; charset=utf-8" });
      else res.end();
    }
  });

  const listening = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  return {
    listening,
    chosen,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
        // The browser keeps its connection open; the app needs the port now.
        server.closeAllConnections();
      }),
  };
}
