/* The desktop app: what the Ormma icon runs, on a Mac or on Windows. It
 * runs on the Node bundled with the download (desktop/build.mjs puts the
 * two together), started by the small native program the icon opens
 * (desktop/shim). From a clone of the repo it runs as well:
 * `node desktop/launcher.mjs`.
 *
 *   Ormma                  start Ormma if it is not running, and open it in
 *                          the browser — what the icon does
 *   Ormma serve            Ormma itself, in the foreground: what starts when
 *                          you sign in (lib/service.mjs)
 *   Ormma stop             stop it, until it is next opened or you next sign in
 *   Ormma restart          stop it and start it again
 *   Ormma status           whether it runs, and where its things are
 *   Ormma reset-password   forget the password: the next page asks for a new one
 *   Ormma backup [folder]  a copy of the database, in Documents/Ormma backups
 *   Ormma restore <file>   put a backup (or a before-delete copy) back
 *   Ormma uninstall        stop it, and stop it starting when you sign in;
 *                          your data stays
 *   Ormma version
 *
 * --quiet prints what it would otherwise show in a window (the Windows
 * uninstaller says it its own way).
 *
 * Opening a newer Ormma while an older one runs stops the old one and starts
 * the new: replacing the app and opening it is the whole of an update. */

import { DatabaseSync } from "node:sqlite";
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "../app/src/db.mjs";
import { ask } from "./lib/control.mjs";
import { serve } from "./lib/service.mjs";
import { ensureSettings } from "./lib/settings.mjs";
import {
  agentLoaded,
  agentPlist,
  health,
  openUrl,
  portFree,
  removeAgent,
  removeRunKey,
  setRunKey,
  startAgent,
  startDetached,
  stopAgent,
  tell as show,
} from "./lib/system.mjs";
import { DEFAULT_LABEL, where } from "./lib/where.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const VERSION = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).version;
const BUNDLE_ID = "tech.analytixkraft.ormma";
const platform = process.platform;
const places = where();
// The native program that started us — Ormma.app's, or Ormma.exe — when
// this is the desktop app, not a clone of the repo.
const shim = process.env.ORMMA_SHIM || null;
// How to run Ormma from a terminal, for the app's hints.
const command = shim || `${process.execPath} ${join(HERE, "launcher.mjs")}`;
// The Run key's name — another for a test copy, as the launchd label is.
const runValue = places.label === DEFAULT_LABEL ? "Ormma" : places.label;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Shown in a window, unless --quiet; printed either way. */
function tell(message, options = {}) {
  if (!quiet) return show(message, options);
  (options.error ? console.error : console.log)(message);
}

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}\n`;
  try {
    mkdirSync(places.logs, { recursive: true, mode: 0o700 });
    appendFileSync(join(places.logs, "ormma.log"), stamped, { mode: 0o600 });
  } catch {
    // Logging must never be why Ormma does not start.
  }
  if (process.stdout.isTTY) process.stdout.write(stamped);
}

/* What starts the service: Ormma's own program when there is one, so the
 * Mac's Login Items and Windows' Startup apps both list it as Ormma. */
function serviceCommand() {
  return shim ? { program: shim, args: ["serve"] } : { program: process.execPath, args: ["--disable-warning=ExperimentalWarning", join(HERE, "launcher.mjs"), "serve"] };
}

/* A test copy's places travel with it into launchd. */
const placeOverrides = () => Object.fromEntries(["ORMMA_HOME", "ORMMA_LOGS", "ORMMA_LABEL"].filter((k) => process.env[k]).map((k) => [k, process.env[k]]));

async function startService() {
  const { program, args } = serviceCommand();
  if (platform === "darwin" && shim) {
    const plist = agentPlist({ label: places.label, program, args, env: placeOverrides(), logs: places.logs, bundleId: BUNDLE_ID });
    await startAgent({ label: places.label, plist });
    return;
  }
  if (platform === "win32" && shim) await setRunKey(runValue, `"${program}" ${args.join(" ")}`);
  // Started on this Node directly; ORMMA_SHIM goes along in the environment.
  startDetached({ args: ["--disable-warning=ExperimentalWarning", join(HERE, "launcher.mjs"), "serve"] });
}

async function stopService() {
  if (platform === "darwin" && (await agentLoaded(places.label))) await stopAgent(places.label);
  // Running some other way: from a terminal, or on Windows.
  if (await ask(places.control, "status")) {
    await ask(places.control, "stop");
    for (let i = 0; i < 90 && (await ask(places.control, "status")); i++) await sleep(500);
  }
}

/* Answering on its port — the app, or the first-run page — within 45 s. */
async function started(port) {
  for (let i = 0; i < 90; i++) {
    const status = await ask(places.control, "status", { timeoutMs: 1000 });
    if (status && ["setup", "running"].includes(status.state) && (await health(port))) return status;
    await sleep(500);
  }
  return null;
}

/* A Mac app run from the disk image, or from Downloads before it was moved
 * (macOS then runs it from a hidden read-only copy), would leave launchd
 * pointing at a place that goes away. */
function misplaced() {
  if (platform !== "darwin" || !shim) return false;
  return shim.startsWith("/Volumes/") || shim.includes("/AppTranslocation/");
}

async function open({ browser = true } = {}) {
  if (misplaced()) {
    await tell("Move Ormma to your Applications folder first: drag it there from this window (or from Downloads), then open it from Applications.", { error: true });
    return 1;
  }
  const settings = ensureSettings(places.config);
  const url = `http://localhost:${settings.appPort}/`;
  let status = await ask(places.control, "status");
  if (status && status.version !== VERSION) {
    log(`Ormma ${status.version} is running; switching to ${VERSION}`);
    await stopService();
    status = null;
  }
  if (!status) {
    if (await health(settings.appPort)) {
      await tell(
        `Another Ormma already answers at ${url} — installed another way, perhaps (Docker, or scripts/native from the repo). Use that one, or stop it and open this one again. Or give this one another port: APP_PORT in ${places.config}.`,
        { error: true },
      );
      return 1;
    }
    if (!(await portFree(settings.appPort))) {
      await tell(`Another program on this computer is using port ${settings.appPort}, so Ormma cannot answer there. Close it and open Ormma again — or give Ormma another port: APP_PORT in ${places.config}.`, { error: true });
      return 1;
    }
    log(`starting Ormma ${VERSION}`);
    await startService();
    status = await started(settings.appPort);
    if (!status) {
      await tell(`Ormma did not start. What went wrong is in its logs, in ${places.logs}.`, { error: true });
      return 1;
    }
  }
  // ORMMA_NO_BROWSER: for the build's own checks, on a computer with no one at it.
  if (browser && !process.env.ORMMA_NO_BROWSER) await openUrl(url);
  else console.log(`Ormma is running: ${url}`);
  return 0;
}

async function status() {
  const settings = ensureSettings(places.config);
  const running = await ask(places.control, "status");
  console.log(running ? `Ormma ${running.version} is running (${running.state}): http://localhost:${settings.appPort}/` : "Ormma is not running.");
  console.log(`This is Ormma ${VERSION}.`);
  console.log(`Data:     ${places.home}`);
  console.log(`Settings: ${places.config}`);
  console.log(`Logs:     ${places.logs}`);
  return 0;
}

function withDb(fn) {
  const settings = ensureSettings(places.config);
  const db = openDb(join(places.appData, "birthdays.db"), { defaultTimezone: settings.timezone });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

async function resetPassword() {
  await stopService();
  mkdirSync(places.appData, { recursive: true, mode: 0o700 });
  withDb((db) => db.password.clear());
  log("the password was reset");
  return open();
}

async function backup(folder) {
  const file = join(places.appData, "birthdays.db");
  if (!existsSync(file)) {
    await tell("Ormma has no database yet — there is nothing to back up.", { error: true });
    return 1;
  }
  const dir = folder || join(homedir(), "Documents", "Ormma backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 19);
  const to = join(dir, `ormma-${stamp}.db`);
  // A consistent copy (VACUUM INTO), safe while Ormma runs — as scripts/backup.sh makes.
  const db = new DatabaseSync(file);
  try {
    db.prepare("VACUUM INTO ?").run(to);
  } finally {
    db.close();
  }
  log(`backed up to ${to}`);
  await tell(`Saved a copy of Ormma's database:\n${to}\n\nIt holds your people, calendar, notes and settings — not the WhatsApp link. Keep it as private as your notes.`);
  return 0;
}

/* As scripts/restore.sh does: stopped, the copy put in place, started
 * again. Everything since the copy was made is replaced by what it holds —
 * so the database it replaces is kept beside it first. */
async function restore(from) {
  if (!from || !existsSync(from)) {
    await tell(`Which backup? Ormma restore <file> — there is no file ${from ?? ""}`.trim(), { error: true });
    return 2;
  }
  try {
    const db = new DatabaseSync(from, { readOnly: true });
    const people = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'people'").get();
    db.close();
    if (!people) throw new Error("no people table");
  } catch {
    await tell(`${from} is not a copy of Ormma's database.`, { error: true });
    return 1;
  }
  await stopService();
  const file = join(places.appData, "birthdays.db");
  mkdirSync(places.appData, { recursive: true, mode: 0o700 });
  if (existsSync(file)) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    copyFileSync(file, join(places.appData, `before-restore-${stamp}.db`));
  }
  // The -wal and -shm files belong to the database being replaced; left
  // behind, SQLite would replay them onto the restored copy.
  rmSync(`${file}-wal`, { force: true });
  rmSync(`${file}-shm`, { force: true });
  copyFileSync(from, file);
  log(`restored ${from}`);
  return open({ browser: false });
}

async function uninstall() {
  await stopService();
  if (platform === "darwin") await removeAgent(places.label);
  if (platform === "win32") await removeRunKey(runValue);
  log("uninstalled: stopped, and no longer starts at sign-in");
  await tell(`Ormma is stopped, and will not start when you sign in. Your list, notes and WhatsApp link are still in ${places.home} — delete that folder to remove them too.`);
  return 0;
}

const COMMANDS = {
  open: () => open(),
  serve: () => serve({ root: ROOT, places, version: VERSION, command, log }),
  stop: async () => {
    await stopService();
    console.log("Ormma is stopped.");
    return 0;
  },
  restart: async () => {
    await stopService();
    return open({ browser: false });
  },
  status,
  "reset-password": resetPassword,
  backup: (folder) => backup(folder),
  restore: (file) => restore(file),
  uninstall,
  version: () => {
    console.log(VERSION);
    return 0;
  },
};

// Finder once passed a -psn_… argument to apps it opened; it means nothing.
const argv = process.argv.slice(2).filter((arg) => !arg.startsWith("-psn_"));
const quiet = argv.includes("--quiet");
const [name = "open", ...rest] = argv.filter((arg) => arg !== "--quiet");
if (!Object.hasOwn(COMMANDS, name)) {
  console.error(`Ormma ${VERSION}: unknown command "${name}". Commands: ${Object.keys(COMMANDS).join(", ")}.`);
  process.exit(2);
}
try {
  process.exit(await COMMANDS[name](...rest));
} catch (err) {
  log(`${name} failed: ${err?.stack || err}`);
  await tell(`Ormma could not ${name === "open" ? "start" : name}: ${err?.message || err}\n\nMore in its logs, in ${places.logs}.`, { error: true });
  process.exit(1);
}
