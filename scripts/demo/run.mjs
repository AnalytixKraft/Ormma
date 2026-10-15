/* Try Ormma without WhatsApp: one command starts the app on made-up data,
 * beside a fake WhatsApp bridge that sends nothing — for a first look, for
 * working on the pages, and for the screenshots in docs/.
 *
 *   node scripts/demo/run.mjs [--state open|pairing|idle] [--port 3290] [--stub-port 3291] [--data-dir <new folder>]
 *
 * It makes a data folder (a new temporary one unless --data-dir says
 * where), fills it (seed.mjs), starts the stub bridge (stub-bridge.mjs) and
 * then the app — from this checkout, with secrets made up for the run —
 * prints the address and the password, and stops both on Ctrl+C. A
 * temporary folder goes with them.
 *
 * The app sends for real: sending is on, and the morning's messages and the
 * wishes go out at their times. So the one thing this must never get wrong
 * is where they go. The app is given BRIDGE_URL and BRIDGE_TOKEN here and
 * nothing else from this shell's environment; it starts only once the stub
 * is listening on 127.0.0.1 and has answered as the stub, to a token made
 * up a moment before; and nothing starts at all if BRIDGE_URL is set to
 * anything else, if either port is the live app's or bridge's (3210, 3000),
 * or if anything already answers on them. */

import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { STUB_PORT } from "./stub-bridge.mjs";

export const DEMO_PORT = 3290;
export const DEMO_PASSWORD = "ormma-demo";
const DEMO_TIMEZONE = "Asia/Kolkata";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
/* The live instance's app and bridge, as scripts/native and docker-compose
 * run them. The demo never takes their ports. */
const LIVE_PORTS = new Map([
  [3210, "the app's"],
  [3000, "the WhatsApp bridge's"],
]);
const STATES = ["open", "pairing", "idle"];

/* Whether anything at all answers HTTP on 127.0.0.1:port. */
async function answers(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(1_500) });
    return true;
  } catch (err) {
    return err?.name === "TimeoutError"; // something took the connection and said nothing
  }
}

/* Whether the port can be listened on, on 127.0.0.1. */
function free(port) {
  return new Promise((done) => {
    const probe = createServer();
    probe.once("error", () => done(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => done(true)));
  });
}

async function checkPort(port, what) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error(`${what} port ${port} is not a port from 1024 to 65535.`);
  if (LIVE_PORTS.has(port)) throw new Error(`Port ${port} is ${LIVE_PORTS.get(port)} on a real Ormma. The demo uses ${DEMO_PORT} and ${STUB_PORT}.`);
  if ((await answers(port)) || !(await free(port))) throw new Error(`Something is already listening on 127.0.0.1:${port}. Stop it, or choose another ${what} port.`);
}

/* Only what a Node program needs to run, and nothing of this shell's own:
 * no BRIDGE_URL, no ANTHROPIC_API_KEY, no ORMMA_* from a desktop install. */
function baseEnv() {
  const env = {};
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "SystemRoot"]) if (process.env[key]) env[key] = process.env[key];
  return env;
}

/* A child's output, line by line, to `print` (or nowhere). */
function follow(child, prefix, print) {
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => print?.(`${prefix}${line}`));
  }
}

function exited(child) {
  return child.exitCode !== null || child.signalCode !== null
    ? Promise.resolve()
    : new Promise((done) => child.once("exit", done));
}

async function stopChild(child) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
  const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
  await exited(child);
  clearTimeout(timer);
}

/* Starts the demo. → {url, password, bridgeUrl, dataDir, stop(), done}
 * `done` settles when either program stops on its own. `print` gets every
 * line both write (null: quiet). */
export async function startDemo({
  port = DEMO_PORT,
  stubPort = STUB_PORT,
  state = "open",
  dataDir = null,
  password = DEMO_PASSWORD,
  print = (line) => console.log(line),
} = {}) {
  if (!STATES.includes(state)) throw new Error(`--state must be one of ${STATES.join(", ")}.`);
  if (port === stubPort) throw new Error("The app and the stub need two different ports.");
  if (password.length < 8) throw new Error("The demo password needs at least 8 characters.");
  const bridgeUrl = `http://127.0.0.1:${stubPort}`;
  if (process.env.BRIDGE_URL && process.env.BRIDGE_URL.replace(/\/+$/, "") !== bridgeUrl) {
    throw new Error(`BRIDGE_URL is set in this shell (${process.env.BRIDGE_URL}). The demo talks to its own stub only, at ${bridgeUrl}: unset BRIDGE_URL first.`);
  }
  await checkPort(stubPort, "stub");
  await checkPort(port, "app");

  let dir;
  let temporary = false;
  if (dataDir) {
    dir = resolve(dataDir);
    if (/WishCalendar|Application Support\/Ormma/i.test(dir)) throw new Error(`${dir} looks like a real Ormma data folder. Give the demo a folder of its own.`);
    mkdirSync(dir, { recursive: true });
    if (readdirSync(dir).length) throw new Error(`${dir} is not empty. The demo starts from a new folder.`);
  } else {
    dir = mkdtempSync(join(tmpdir(), "ormma-demo-"));
    temporary = true;
  }

  const token = randomBytes(24).toString("hex");
  let stub = null;
  let app = null;
  let stopping = false;
  async function stop() {
    stopping = true;
    await stopChild(app);
    await stopChild(stub);
    if (temporary) rmSync(dir, { recursive: true, force: true });
  }

  try {
    // In a Node of its own, as the app runs, so node:sqlite's experimental
    // warning is off for it too.
    const seeded = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", join(HERE, "seed.mjs"), dir], { cwd: ROOT, env: baseEnv(), encoding: "utf8" });
    for (const line of `${seeded.stdout}${seeded.stderr}`.split("\n").filter(Boolean)) print?.(line);
    if (seeded.status !== 0) throw new Error("The demo data could not be written (see above).");

    stub = spawn(process.execPath, [join(HERE, "stub-bridge.mjs"), "--port", String(stubPort), "--state", state], {
      cwd: ROOT,
      env: { ...baseEnv(), BRIDGE_TOKEN: token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    follow(stub, "", print);
    await new Promise((ready, fail) => {
      const timer = setTimeout(() => fail(new Error("The stub bridge did not start within 10 seconds.")), 10_000);
      stub.stdout.on("data", (chunk) => {
        if (String(chunk).includes("listening on")) {
          clearTimeout(timer);
          ready();
        }
      });
      stub.once("exit", () => {
        clearTimeout(timer);
        fail(new Error("The stub bridge stopped as it started (see above)."));
      });
    });

    // The app's BRIDGE_URL answers as the stub, to this run's token — or
    // the app is not started.
    const status = await fetch(`${bridgeUrl}/status`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5_000) })
      .then((res) => res.json())
      .catch(() => null);
    if (status?.baileys_version !== "demo-stub" || status.state !== state) {
      throw new Error(`What answers at ${bridgeUrl} is not the demo's stub bridge, so the app was not started.`);
    }

    app = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(ROOT, "app", "src", "main.mjs")], {
      cwd: ROOT,
      env: {
        ...baseEnv(),
        DATA_DIR: dir,
        PORT: String(port),
        HOST: "127.0.0.1",
        BRIDGE_URL: bridgeUrl,
        BRIDGE_TOKEN: token,
        ADMIN_PASSWORD: password,
        SESSION_SECRET: randomBytes(32).toString("hex"),
        DEFAULT_TIMEZONE: DEMO_TIMEZONE,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    follow(app, "app: ", print);
    const url = `http://127.0.0.1:${port}`;
    for (let waited = 0; ; waited += 200) {
      if (app.exitCode !== null) throw new Error("The app stopped as it started (see above).");
      const up = await fetch(`${url}/healthz`, { signal: AbortSignal.timeout(1_000) }).then((res) => res.ok, () => false);
      if (up) break;
      if (waited > 15_000) throw new Error("The app did not answer within 15 seconds.");
      await new Promise((wait) => setTimeout(wait, 200));
    }

    const done = Promise.race([exited(stub).then(() => "the stub bridge"), exited(app).then(() => "the app")]).then((which) =>
      stopping ? null : which,
    );
    return { url, password, bridgeUrl, dataDir: dir, temporary, stop, done };
  } catch (err) {
    await stop();
    throw err;
  }
}

/* ------------------------------------------------------------------ CLI */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: String(DEMO_PORT) },
      "stub-port": { type: "string", default: String(STUB_PORT) },
      state: { type: "string", default: "open" },
      "data-dir": { type: "string" },
      password: { type: "string", default: DEMO_PASSWORD },
      quiet: { type: "boolean", default: false },
    },
  });
  let demo;
  try {
    demo = await startDemo({
      port: Number(values.port),
      stubPort: Number(values["stub-port"]),
      state: values.state,
      dataDir: values["data-dir"] ?? null,
      password: values.password,
      print: values.quiet ? null : (line) => console.log(line),
    });
  } catch (err) {
    console.error(`demo: ${err.message}`);
    process.exit(1);
  }
  console.log(`
Ormma demo — made-up people, and a fake WhatsApp that sends nothing.

  Open      ${demo.url}
  Password  ${demo.password}
  Data      ${demo.dataDir}${demo.temporary ? " (deleted when it stops)" : ""}
  WhatsApp  the stub at ${demo.bridgeUrl}, state ${values.state}

Ctrl+C stops it.
`);
  let closing = false;
  const close = async (code) => {
    if (closing) return;
    closing = true;
    await demo.stop();
    process.exit(code);
  };
  for (const signal of ["SIGINT", "SIGTERM"]) process.once(signal, () => close(0));
  demo.done.then((which) => {
    if (!which) return;
    console.error(`demo: ${which} stopped, so the demo stops too.`);
    close(1);
  });
}
