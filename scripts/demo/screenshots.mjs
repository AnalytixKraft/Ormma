/* The screenshots in docs/screenshots, taken again: Google Chrome, headless,
 * driven over the DevTools protocol with Node's own WebSocket and fetch —
 * no packages to install.
 *
 *   node scripts/demo/screenshots.mjs --start-demo           all of them, on a demo of their own
 *   node scripts/demo/screenshots.mjs [--url …] [--password …] [--only today,people]
 *
 * With --start-demo it runs the demo (run.mjs) itself, on its usual ports:
 * once as it normally is, and once with the stub bridge offering its fake
 * QR code (for link-phone). Without it, it signs in to the app at --url
 * (the demo's address and password unless told otherwise) and takes the
 * shots that suit the WhatsApp state that app is in, saying which it left.
 *
 * The shots are the table below: add a row to take one more. Each page is
 * opened, given a moment for its fonts and images, cropped where the row
 * says, and saved as PNG. Nothing is clicked but the sign-in button:
 * pictures of the app never press anything that sends.
 *
 * The fonts are this Mac's (the pages use no web fonts), and so is the
 * clock in a time field: Chrome draws "07:30 PM" or "19:30" as macOS is set,
 * whatever language it is told to use.
 *
 * Chrome runs with a new, empty profile in a temporary folder — never
 * anyone's own — which goes when it is done. */

import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { DEMO_PASSWORD, DEMO_PORT, startDemo } from "./run.mjs";

/* What to take. path: the page. width × height: the window, in CSS pixels.
 * scale: device pixels per CSS pixel (2 unless --scale says otherwise).
 * mobile: a phone's viewport. dark: dark mode. until: the window made just
 * tall enough to show down to this element, and `pad` CSS pixels more
 * (28) — else the picture is the window as it is. open: follow the link
 * with this text first. before: a script run on the page first.
 * signedOut: before signing in. state: the WhatsApp state it needs
 * (default open). firstRun: the desktop app's first-run page instead of the
 * demo (--start-demo only). */
const SHOTS = [
  { name: "first-run", path: "/", firstRun: true, signedOut: true, width: 1280, height: 860, until: ".signin__form", pad: 60 },
  { name: "sign-in", path: "/login", signedOut: true, width: 1280, height: 760 },
  { name: "today", path: "/", width: 1440, height: 900, until: ".spread" },
  { name: "today-dark", path: "/", width: 1440, height: 900, until: ".spread", dark: true },
  { name: "today-phone", path: "/", width: 390, height: 844, scale: 3, mobile: true },
  // pad: room below the sixth row for the Save changes bar, which sticks to
  // the bottom of the window.
  { name: "people", path: "/people", width: 1440, height: 960, until: "#people-table tbody tr:nth-child(6)", pad: 124 },
  { name: "person", path: "/people", open: "Meera Nair", width: 1280, height: 900, until: ".preview" },
  { name: "upload", path: "/people/import", width: 1280, height: 900, before: "fillList", until: "form[action='/people/import']" },
  { name: "calendar", path: "/calendar", width: 1440, height: 900, until: ".cal-layout" },
  { name: "notes", path: "/notes", width: 1280, height: 900, until: ".notes" },
  { name: "journal", path: "/journal", width: 1280, height: 860 },
  { name: "settings", path: "/settings", width: 1280, height: 920 },
  { name: "link-phone", path: "/settings", state: "pairing", width: 1280, height: 900, until: "#whatsapp" },
];

/* Scripts a row can run before its picture. */
const BEFORE = {
  // Upload a list, with a few made-up rows in the box, as a CSV file puts
  // them there — written in only: nothing is added.
  fillList: `document.querySelector("#list").value = ${JSON.stringify(
    [
      "Name,Birthday,Anniversary,WhatsApp number,Send to,Message",
      'Maria Joseph,21-11-1994,,+44 7700 900141,direct,"Happy birthday, Maria! 🎂"',
      "George & Elsa,,08-01-2005,,Family,",
      "Vinod Kumar,3 Dec,,,Choir,",
      "Asha Philip,14/02,,+44 7700 900142,St. Mary's Youth,",
    ].join("\n"),
  )};`,
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEBUG_PORT = 3292;
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/* ------------------------------------------------- the DevTools protocol */

/* One WebSocket to the browser; pages are sessions on it (flatten). */
class Cdp {
  #ws;
  #id = 0;
  #pending = new Map();
  #listeners = new Set();

  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((open, fail) => {
      ws.addEventListener("open", open, { once: true });
      ws.addEventListener("error", () => fail(new Error(`could not connect to Chrome at ${url}`)), { once: true });
    });
    return new Cdp(ws);
  }

  constructor(ws) {
    this.#ws = ws;
    ws.addEventListener("message", ({ data }) => {
      const message = JSON.parse(data);
      if (message.id) {
        const call = this.#pending.get(message.id);
        this.#pending.delete(message.id);
        if (message.error) call?.fail(new Error(`${call.method}: ${message.error.message}`));
        else call?.done(message.result);
      } else {
        for (const listener of this.#listeners) listener(message);
      }
    });
  }

  send(method, params = {}, sessionId = undefined) {
    const id = ++this.#id;
    this.#ws.send(JSON.stringify({ id, method, params, sessionId }));
    return new Promise((done, fail) => this.#pending.set(id, { method, done, fail }));
  }

  /* The next event `method` on this session. */
  next(method, sessionId, timeoutMs = 30_000) {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => {
        this.#listeners.delete(listener);
        fail(new Error(`no ${method} within ${timeoutMs / 1000} s`));
      }, timeoutMs);
      const listener = (message) => {
        if (message.method !== method || message.sessionId !== sessionId) return;
        clearTimeout(timer);
        this.#listeners.delete(listener);
        done(message.params);
      };
      this.#listeners.add(listener);
    });
  }

  close() {
    this.#ws.close();
  }
}

/* A tab, and what the shots do with it. */
async function openTab(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const call = (method, params) => cdp.send(method, params, sessionId);
  await call("Page.enable");
  await call("Emulation.setScrollbarsHidden", { hidden: true });

  async function evaluate(expression) {
    const { result, exceptionDetails } = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(`on the page: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`);
    return result.value;
  }

  /* Fonts loaded, every image in, and a frame drawn. */
  const settle = () =>
    evaluate(`(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((img) => img.complete || new Promise((done) => { img.onload = img.onerror = done; })));
      await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      return true;
    })()`);

  /* Waits for the page a navigation, or a form, leads to. */
  async function loaded(action) {
    const load = cdp.next("Page.loadEventFired", sessionId);
    await action();
    await load;
    await settle();
  }

  return {
    call,
    evaluate,
    settle,
    goto: (url) =>
      loaded(async () => {
        const { errorText } = await call("Page.navigate", { url });
        if (errorText) throw new Error(`${url}: ${errorText}`);
      }),
    submit: (selector) => loaded(() => evaluate(`document.querySelector(${JSON.stringify(selector)}).requestSubmit()`)),
    close: () => cdp.send("Target.closeTarget", { targetId }),
  };
}

/* ------------------------------------------------------------- Chrome */

function portFree(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => done(true)));
  });
}

async function launchChrome({ path, port }) {
  if (!(await portFree(port))) throw new Error(`port ${port} is taken; choose another with --debug-port`);
  const profile = mkdtempSync(join(tmpdir(), "ormma-shots-chrome-"));
  const chrome = spawn(
    path,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-extensions",
      "--disable-sync",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-features=Translate,MediaRouter,OptimizationHints",
      "--use-mock-keychain",
      "--password-store=basic",
      "--hide-scrollbars",
      "--mute-audio",
      "--force-color-profile=srgb",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "ignore"] },
  );
  const gone = new Promise((done) => chrome.once("exit", done));
  let endpoint = null;
  for (let waited = 0; !endpoint; waited += 250) {
    if (chrome.exitCode !== null) throw new Error(`Chrome stopped as it started (${path})`);
    if (waited > 20_000) throw new Error("Chrome did not open its DevTools port within 20 seconds");
    await sleep(250);
    endpoint = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then((res) => res.json())
      .then((v) => v.webSocketDebuggerUrl)
      .catch(() => null);
  }
  const cdp = await Cdp.connect(endpoint);
  return {
    cdp,
    async close() {
      await cdp.send("Browser.close").catch(() => {});
      cdp.close();
      const timer = setTimeout(() => chrome.kill("SIGKILL"), 5_000);
      await gone;
      clearTimeout(timer);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/* -------------------------------------------------------------- shots */

async function signIn(tab, url, password) {
  await tab.goto(`${url}/login`);
  if (new URL(await tab.evaluate("location.href")).pathname !== "/login") return; // signed in already
  await tab.evaluate(`document.querySelector("input[name=password]").value = ${JSON.stringify(password)}`);
  await tab.submit("form[action='/login']");
  if (new URL(await tab.evaluate("location.href")).pathname === "/login") throw new Error(`could not sign in to ${url} with that password`);
}

/* The WhatsApp state the app reports: open, pairing, idle … — or null
 * when it says none. */
const waState = (tab) => tab.evaluate(`fetch("/whatsapp/status.json").then((res) => res.json()).then((s) => s.state ?? null, () => null)`);

async function take(tab, shot, { url, out, scale }) {
  const deviceScaleFactor = shot.scale ?? scale;
  const resize = (height) =>
    tab.call("Emulation.setDeviceMetricsOverride", { width: shot.width, height, deviceScaleFactor, mobile: Boolean(shot.mobile) });
  await resize(shot.height);
  // Reduced motion: the ribbon and the day's numeral as they end up, not
  // halfway through falling into place.
  await tab.call("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: shot.dark ? "dark" : "light" },
      { name: "prefers-reduced-motion", value: "reduce" },
    ],
  });
  await tab.goto(url + shot.path);
  if (shot.open) {
    const href = await tab.evaluate(`[...document.querySelectorAll("a")].find((a) => a.textContent.trim() === ${JSON.stringify(shot.open)})?.href ?? null`);
    if (!href) throw new Error(`${shot.name}: no link “${shot.open}” on ${shot.path}`);
    await tab.goto(href);
  }
  if (shot.before) await tab.evaluate(BEFORE[shot.before]);
  // No caret, no focus ring, at the top.
  await tab.evaluate("document.activeElement?.blur(); window.scrollTo(0, 0); true");
  await tab.settle();
  // A window as tall as the picture, rather than a capture beyond it: what
  // sticks to the bottom of the window stays at the bottom of the picture.
  let height = shot.height;
  for (let tries = 0; shot.until && tries < 3; tries++) {
    const bottom = await tab.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(shot.until)});
      return el ? Math.ceil(el.getBoundingClientRect().bottom + window.scrollY) : null;
    })()`);
    if (!bottom) throw new Error(`${shot.name}: nothing matches ${shot.until}`);
    if (bottom + (shot.pad ?? 28) === height) break;
    height = bottom + (shot.pad ?? 28);
    await resize(height);
    await tab.settle();
  }
  const { data } = await tab.call("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: shot.width, height, scale: 1 } });
  const file = join(out, `${shot.name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  return { file, width: shot.width * deviceScaleFactor, height: Math.round(height * deviceScaleFactor) };
}

async function takeAll({ chrome, url, password, shots, out, scale }) {
  const tab = await openTab(chrome.cdp);
  const taken = [];
  try {
    for (const shot of shots.filter((s) => s.signedOut)) taken.push(await take(tab, shot, { url, out, scale }));
    if (shots.every((s) => s.signedOut)) return { taken, left: [], state: null };
    await signIn(tab, url, password);
    const state = await waState(tab);
    const left = [];
    for (const shot of shots.filter((s) => !s.signedOut)) {
      if ((shot.state ?? "open") !== (state ?? "open")) left.push(shot);
      else taken.push(await take(tab, shot, { url, out, scale }));
    }
    return { taken, left, state };
  } finally {
    await tab.close().catch(() => {});
  }
}

/* The desktop app's first-run page (desktop/launcher.mjs serve), on a data
 * folder of its own and the demo's spare ports: what someone sees the first
 * time they open Ormma from the Mac download. Nothing is set up, so it
 * starts no bridge; it is stopped once its picture is taken. */
const FIRST_RUN_PORT = 3293;
async function startFirstRunPage() {
  const home = mkdtempSync(join(tmpdir(), "ormma-first-run-"));
  writeFileSync(join(home, "ormma.env"), `APP_PORT=${FIRST_RUN_PORT}\nBRIDGE_PORT=${FIRST_RUN_PORT + 1}\n`);
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "desktop", "launcher.mjs"), "serve"], {
    // As the Mac app would say it: its hints name Ormma.app, not this clone.
    env: { ...process.env, ORMMA_HOME: home, ORMMA_LOGS: join(home, "logs"), ORMMA_SHIM: "/Applications/Ormma.app/Contents/MacOS/Ormma" },
    stdio: "ignore",
  });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  const url = `http://localhost:${FIRST_RUN_PORT}`;
  for (let i = 0; ; i++) {
    const health = await fetch(`${url}/healthz`).then((res) => res.json(), () => null);
    if (health?.setup) break;
    if (i > 60) throw new Error("the desktop app's first-run page did not answer");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    url,
    async stop() {
      child.kill("SIGTERM");
      await exited;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

/* ------------------------------------------------------------------ CLI */

const { values } = parseArgs({
  options: {
    url: { type: "string", default: `http://127.0.0.1:${DEMO_PORT}` },
    password: { type: "string", default: DEMO_PASSWORD },
    only: { type: "string" },
    out: { type: "string", default: join(ROOT, "docs", "screenshots") },
    scale: { type: "string", default: "2" },
    "start-demo": { type: "boolean", default: false },
    chrome: { type: "string", default: CHROME },
    "debug-port": { type: "string", default: String(DEBUG_PORT) },
  },
});
const only = values.only ? new Set(values.only.split(",").map((s) => s.trim())) : null;
const unknown = only ? [...only].filter((name) => !SHOTS.some((s) => s.name === name)) : [];
if (unknown.length) {
  console.error(`screenshots: no shot called ${unknown.join(", ")}. There are: ${SHOTS.map((s) => s.name).join(", ")}.`);
  process.exit(2);
}
const shots = SHOTS.filter((s) => !only || only.has(s.name));
const out = resolve(values.out);
const scale = Number(values.scale);
if (!(scale >= 1 && scale <= 4)) {
  console.error(`screenshots: --scale ${values.scale} is not a scale from 1 to 4.`);
  process.exit(2);
}
mkdirSync(out, { recursive: true });

let chrome = null;
let demo = null;
let desktop = null;
const taken = [];
let left = [];
try {
  chrome = await launchChrome({ path: values.chrome, port: Number(values["debug-port"]) });
  if (values["start-demo"]) {
    // As the demo usually is; then with the stub offering its QR code.
    for (const state of ["open", "pairing"]) {
      const group = shots.filter((s) => !s.firstRun && (s.state ?? "open") === state);
      if (!group.length) continue;
      demo = await startDemo({ state, print: null });
      console.log(`screenshots: demo started (WhatsApp ${state}) at ${demo.url}`);
      const result = await takeAll({ chrome, url: demo.url, password: demo.password, shots: group, out, scale });
      taken.push(...result.taken);
      await demo.stop();
      demo = null;
    }
    const firstRun = shots.filter((s) => s.firstRun);
    if (firstRun.length) {
      desktop = await startFirstRunPage();
      console.log(`screenshots: the desktop app's first-run page at ${desktop.url}`);
      taken.push(...(await takeAll({ chrome, url: desktop.url, password: null, shots: firstRun, out, scale })).taken);
      await desktop.stop();
      desktop = null;
    }
  } else {
    const result = await takeAll({ chrome, url: values.url.replace(/\/+$/, ""), password: values.password, shots: shots.filter((s) => !s.firstRun), out, scale });
    taken.push(...result.taken);
    left = result.left.map((s) => ({ ...s, now: result.state }));
  }
} catch (err) {
  console.error(`screenshots: ${err.message}`);
  process.exitCode = 1;
} finally {
  await demo?.stop();
  await desktop?.stop();
  await chrome?.close();
}

let total = 0;
for (const t of taken) {
  const size = statSync(t.file).size;
  total += size;
  console.log(`  ${relative(process.cwd(), t.file).padEnd(36)} ${`${t.width}×${t.height}`.padEnd(11)} ${(size / 1024).toFixed(0).padStart(5)} KB`);
}
if (taken.length) console.log(`screenshots: ${taken.length} taken, ${(total / 1024 / 1024).toFixed(2)} MB`);
for (const s of left) {
  console.log(`screenshots: left out ${s.name} — it needs WhatsApp ${s.state ?? "open"}, and the app says ${s.now}. ` +
    `Start the demo with --state ${s.state ?? "open"} and run this again with --only ${s.name}, or use --start-demo.`);
}
