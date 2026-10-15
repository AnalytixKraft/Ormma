/* What the desktop app asks of the computer: to start Ormma when you sign
 * in, to show you a message, and to open a page in your browser.
 *
 * Start at sign-in:
 *   Mac      a launchd agent in ~/Library/LaunchAgents, as scripts/native
 *            installs — RunAtLoad, and kept alive while Ormma.app is there
 *            (so moving it to the Bin does not leave launchd retrying it
 *            forever)
 *   Windows  the Run key under HKEY_CURRENT_USER, which the installer also
 *            writes; Task Manager → Startup apps turns it off
 *   Linux    nothing: run it as a service of your own, or use Docker */

import { execFile, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------- launchd */

export const agentFile = (label, home = homedir()) => join(home, "Library", "LaunchAgents", `${label}.plist`);
const xml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/* `program` and `args` start Ormma's service; `keepAliveWhile` is the file
 * whose being there keeps it running (Ormma.app's own program). */
export function agentPlist({ label, program, args = [], env = {}, logs, keepAliveWhile = program, bundleId = null }) {
  const envEntries = Object.entries(env);
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${xml(label)}</string>
  <key>Comment</key><string>Ormma — your diary and reminders. Remove with: Ormma uninstall</string>
  <key>ProgramArguments</key>
  <array>
${[program, ...args].map((arg) => `    <string>${xml(arg)}</string>`).join("\n")}
  </array>
${envEntries.length
    ? `  <key>EnvironmentVariables</key>
  <dict>
${envEntries.map(([key, value]) => `    <key>${xml(key)}</key><string>${xml(value)}</string>`).join("\n")}
  </dict>
`
    : ""}${bundleId
    ? `  <key>AssociatedBundleIdentifiers</key>
  <array><string>${xml(bundleId)}</string></array>
`
    : ""}  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key>
  <dict>
    <key>PathState</key>
    <dict><key>${xml(keepAliveWhile)}</key><true/></dict>
  </dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ExitTimeOut</key><integer>30</integer>
  <key>StandardOutPath</key><string>${xml(join(logs, "launchd.log"))}</string>
  <key>StandardErrorPath</key><string>${xml(join(logs, "launchd.log"))}</string>
</dict>
</plist>
`;
}

const gui = () => `gui/${process.getuid()}`;

export async function agentLoaded(label) {
  try {
    await run("launchctl", ["print", `${gui()}/${label}`]);
    return true;
  } catch {
    return false;
  }
}

/* Unloaded, and waited for: launchd refuses to load a label that is still
 * on its way out ("Bootstrap failed: 5: Input/output error"). */
export async function stopAgent(label) {
  if (!(await agentLoaded(label))) return;
  await run("launchctl", ["bootout", `${gui()}/${label}`]).catch(() => {});
  for (let i = 0; i < 80; i++) {
    if (!(await agentLoaded(label))) return;
    await sleep(500);
  }
  throw new Error("launchd did not stop Ormma within 40 seconds");
}

export async function startAgent({ label, plist }) {
  const file = agentFile(label);
  await stopAgent(label);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, plist);
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      await run("launchctl", ["bootstrap", gui(), file]);
      return;
    } catch (err) {
      last = err;
      await sleep(2000);
    }
  }
  throw new Error(`launchd would not start Ormma: ${String(last?.stderr || last?.message).trim()}`);
}

export async function removeAgent(label) {
  await stopAgent(label);
  rmSync(agentFile(label), { force: true });
}

/* ------------------------------------------------------ Windows Run key */

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

export const setRunKey = (name, commandLine) =>
  run("reg.exe", ["add", RUN_KEY, "/v", name, "/t", "REG_SZ", "/d", commandLine, "/f"], { windowsHide: true });

export const removeRunKey = (name) => run("reg.exe", ["delete", RUN_KEY, "/v", name, "/f"], { windowsHide: true }).catch(() => {});

/* ------------------------------------------------------------ anywhere */

/* A process of its own that outlives this one, with no window. */
export function startDetached({ args, env = process.env }) {
  const child = spawn(process.execPath, args, { detached: true, stdio: "ignore", windowsHide: true, env });
  child.unref();
}

export function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

/* What answers /healthz on the port — an Ormma, the first-run page, or
 * something else — or null. */
export async function health(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/healthz`, { signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json().catch(() => ({})) : null;
  } catch {
    return null;
  }
}

export function openUrl(url, platform = process.platform) {
  const [command, args] =
    platform === "darwin" ? ["open", [url]] : platform === "win32" ? ["rundll32.exe", ["url.dll,FileProtocolHandler", url]] : ["xdg-open", [url]];
  return run(command, args, { windowsHide: true }).catch(() => {});
}

/* A message for the person: printed, and — when Ormma was opened from the
 * Dock, Finder or the Start menu, with no terminal to print to — shown. */
export async function tell(message, { error = false, platform = process.platform } = {}) {
  (error ? console.error : console.log)(message);
  if (process.stdout.isTTY) return;
  try {
    if (platform === "darwin") {
      await run("osascript", [
        "-e", "on run argv",
        "-e", "activate",
        "-e", `display dialog (item 1 of argv) with title "Ormma" buttons {"OK"} default button "OK" with icon ${error ? "caution" : "note"} giving up after 600`,
        "-e", "end run",
        message,
      ]);
    } else if (platform === "win32") {
      // The text goes through the environment, so nothing in it is ever
      // read as PowerShell.
      const script = [
        "Add-Type -AssemblyName System.Windows.Forms",
        "$owner = New-Object System.Windows.Forms.Form -Property @{ TopMost = $true }",
        `[void][System.Windows.Forms.MessageBox]::Show($owner, $env:ORMMA_MESSAGE, 'Ormma', 'OK', '${error ? "Warning" : "Information"}')`,
      ].join("; ");
      await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command", script], {
        windowsHide: true,
        env: { ...process.env, ORMMA_MESSAGE: message },
      });
    }
  } catch {
    // Nowhere to show it. It is in the log.
  }
}
