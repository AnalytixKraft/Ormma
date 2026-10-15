/* Ormma itself, as the desktop app runs it: the long-running process that
 * launchd (Mac) or the Run key (Windows) starts when you sign in. It does
 * what scripts/native/run.sh and launchd do for the Mac install from the
 * repo, on any computer:
 *
 *   - makes sure it runs once (control.mjs);
 *   - makes the settings file on the first run (settings.mjs), and shows the
 *     choose-a-password page until there is a password (first-run.mjs);
 *   - starts the WhatsApp bridge, then the app, each with only the settings
 *     it needs, on 127.0.0.1 — and starts either again if it stops;
 *   - keeps each one's output in its own log, about 5 MB, one old copy kept;
 *   - on stop, stops the app (so it sends nothing more), then the bridge (so
 *     it saves the WhatsApp link), and waits for both.
 *
 * Both run on this same Node: process.execPath is the copy bundled with the
 * desktop app. */

import { spawn } from "node:child_process";
import { createWriteStream, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { openDb } from "../../app/src/db.mjs";
import { desktopHints } from "../../app/src/desktop.mjs";
import { AlreadyRunning, openControl } from "./control.mjs";
import { startFirstRun } from "./first-run.mjs";
import { ensureSettings } from "./settings.mjs";

const LOG_LIMIT = 5 * 1024 * 1024;
const FIRST_RETRY_MS = 10_000;
const LONGEST_RETRY_MS = 5 * 60_000;
const STOP_GRACE_MS = 12_000;

export function rotate(file, limit = LOG_LIMIT) {
  try {
    if (statSync(file).size > limit) renameSync(file, `${file}.1`);
  } catch {
    // No log yet.
  }
}

/* Where it runs, as the app's own hints say it (app/src/desktop.mjs). */
export const platformName = (platform) => ({ darwin: "mac", win32: "windows" })[platform] ?? "linux";

/* The settings each part gets: the bridge only its token, the app the rest.
 * Nothing from the environment Ormma was started in may stand in for them —
 * an ANTHROPIC_API_KEY in someone's shell is not one they chose for Ormma. */
const OWN = ["ADMIN_PASSWORD", "SESSION_SECRET", "WHATSAPP_BRIDGE_TOKEN", "BRIDGE_TOKEN", "BRIDGE_URL", "ANTHROPIC_API_KEY", "ANTHROPIC_WORKSPACE_ID", "DATA_DIR", "PORT", "HOST", "DEFAULT_TIMEZONE"];
export function partEnvironments({ settings, places, platform, command, base = process.env }) {
  const clean = Object.fromEntries(Object.entries(base).filter(([key]) => !OWN.includes(key) && !key.startsWith("ORMMA_")));
  const shared = { ...clean, NODE_ENV: "production", HOST: "127.0.0.1", BRIDGE_TOKEN: settings.WHATSAPP_BRIDGE_TOKEN || "" };
  const desktop = {
    ORMMA_DESKTOP: platformName(platform),
    ORMMA_COMMAND: command,
    ORMMA_CONFIG: places.config,
    ORMMA_LOGS: places.logs,
  };
  return {
    whatsapp: { ...shared, PORT: String(settings.bridgePort), DATA_DIR: places.bridgeData },
    app: {
      ...shared,
      ...desktop,
      PORT: String(settings.appPort),
      DATA_DIR: places.appData,
      BRIDGE_URL: `http://127.0.0.1:${settings.bridgePort}`,
      ADMIN_PASSWORD: settings.ADMIN_PASSWORD || "",
      SESSION_SECRET: settings.SESSION_SECRET || "",
      DEFAULT_TIMEZONE: settings.timezone,
      ANTHROPIC_API_KEY: settings.ANTHROPIC_API_KEY || "",
      ANTHROPIC_WORKSPACE_ID: settings.ANTHROPIC_WORKSPACE_ID || "",
    },
    desktop,
  };
}

/* One part, kept running: started again after it stops — 10 s later, then
 * longer each time it stops again soon, up to 5 minutes — until stop(). */
function supervise({ name, cwd, env, logFile, log }) {
  let child = null;
  let timer = null;
  let stopping = false;
  let retry = FIRST_RETRY_MS;

  function start() {
    rotate(logFile);
    const out = createWriteStream(logFile, { flags: "a", mode: 0o600 });
    const started = Date.now();
    // Pipes, not the log file's descriptor: on Windows a part given a file
    // to inherit would be given a console window too.
    child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", "src/main.mjs"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      windowsHide: true,
    });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    child.on("error", (err) => log(`${name} could not start: ${err.message}`));
    child.once("close", (code, signal) => {
      out.end();
      child = null;
      if (stopping) return;
      if (Date.now() - started > 60_000) retry = FIRST_RETRY_MS;
      log(`${name} stopped (${signal || `exit ${code}`}); starting it again in ${Math.round(retry / 1000)} s — its log: ${logFile}`);
      timer = setTimeout(start, retry);
      retry = Math.min(retry * 2, LONGEST_RETRY_MS);
    });
    log(`${name} started (pid ${child.pid})`);
  }

  async function stop() {
    stopping = true;
    clearTimeout(timer);
    const running = child;
    if (!running) return;
    const closed = new Promise((resolve) => running.once("close", resolve));
    // Asked over IPC (main.mjs listens), which works on Windows too; a
    // signal only where there is no channel left to ask on.
    if (running.connected) running.send("stop");
    else running.kill("SIGTERM");
    const kill = setTimeout(() => running.kill("SIGKILL"), STOP_GRACE_MS);
    await closed;
    clearTimeout(kill);
    log(`${name} stopped`);
  }

  return { start, stop, pid: () => child?.pid ?? null };
}

/* → the exit code, once stopped. `command` is how to run Ormma from a
 * terminal, for the app's hints. */
export async function serve({ root, places, version, platform = process.platform, command, log }) {
  process.umask(0o077);
  mkdirSync(places.home, { recursive: true, mode: 0o700 });
  mkdirSync(places.logs, { recursive: true, mode: 0o700 });

  let state = "starting";
  let settings = null;
  let requestStop;
  const stopRequested = new Promise((resolve) => (requestStop = resolve));

  let control;
  try {
    control = await openControl(places.control, {
      status: () => ({ ok: true, version, pid: process.pid, state, port: settings?.appPort ?? null, home: places.home }),
      stop: () => {
        setImmediate(() => requestStop("asked to"));
        return { ok: true };
      },
    });
  } catch (err) {
    if (err instanceof AlreadyRunning) {
      log(err.message);
      return 0;
    }
    throw err;
  }
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP", "SIGBREAK"]) {
    try {
      process.once(signal, () => requestStop(signal));
    } catch {
      // Not a signal on this platform.
    }
  }

  settings = ensureSettings(places.config);
  const envs = partEnvironments({ settings, places, platform, command });
  const hints = desktopHints(envs.desktop);
  log(`Ormma ${version} — data in ${places.home}, http://localhost:${settings.appPort}`);

  // The password: there must be one before the app starts.
  const dbFile = join(places.appData, "birthdays.db");
  mkdirSync(places.appData, { recursive: true, mode: 0o700 });
  const store = {
    hash() {
      const db = openDb(dbFile, { defaultTimezone: settings.timezone });
      try {
        return db.password.hash();
      } finally {
        db.close();
      }
    },
    set(hash) {
      const db = openDb(dbFile, { defaultTimezone: settings.timezone });
      try {
        db.password.set(hash);
      } finally {
        db.close();
      }
    },
  };

  let stopReason = null;
  stopRequested.then((why) => (stopReason = why));

  while (!store.hash() && !stopReason) {
    state = "setup";
    const page = startFirstRun({
      port: settings.appPort,
      timezone: settings.timezone,
      store,
      secret: settings.SESSION_SECRET,
      fallbackPassword: settings.ADMIN_PASSWORD,
      hints,
      log,
    });
    try {
      await page.listening;
    } catch (err) {
      // Something else has the port. Wait for it, as the app would.
      state = "waiting";
      log(`port ${settings.appPort} is taken (${err.code || err.message}); trying again in 10 s`);
      await Promise.race([stopRequested, new Promise((resolve) => setTimeout(resolve, 10_000))]);
      continue;
    }
    log(`waiting for a password: http://localhost:${settings.appPort}`);
    await Promise.race([page.chosen, stopRequested]);
    await page.close();
  }

  const parts = [];
  if (!stopReason) {
    mkdirSync(places.bridgeData, { recursive: true, mode: 0o700 });
    for (const name of ["whatsapp", "app"]) {
      const part = supervise({ name, cwd: join(root, name), env: envs[name], logFile: join(places.logs, `${name}.log`), log });
      part.start();
      parts.push(part);
    }
    state = "running";
  }

  const why = await stopRequested;
  state = "stopping";
  log(`stopping (${why})`);
  // The app first, so nothing more is sent; then the bridge.
  for (const part of parts.reverse()) await part.stop();
  // Closing it removes the socket file too.
  await new Promise((resolve) => control.close(() => resolve()));
  log("stopped");
  return 0;
}
