/* Where the desktop app keeps things on this computer. Nothing here is
 * created — only named — so a test can ask for any platform's answer.
 *
 *   Mac      ~/Library/Application Support/Ormma, logs in ~/Library/Logs/Ormma
 *   Windows  %LOCALAPPDATA%\Ormma — Local, not Roaming: the WhatsApp link
 *            must never follow the account to a second computer, where a
 *            second bridge would take it from the first
 *   Linux    $XDG_DATA_HOME/ormma (~/.local/share/ormma)
 *
 * ORMMA_HOME, ORMMA_LOGS and ORMMA_LABEL move all of it: for trying a build
 * beside a copy that is already running, on other ports and other data. */

import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_LABEL = "tech.analytixkraft.ormma";

export function where({ env = process.env, platform = process.platform, home = homedir(), tmp = tmpdir() } = {}) {
  const base =
    env.ORMMA_HOME ||
    (platform === "darwin"
      ? join(home, "Library", "Application Support", "Ormma")
      : platform === "win32"
        ? join(env.LOCALAPPDATA || join(home, "AppData", "Local"), "Ormma")
        : join(env.XDG_DATA_HOME || join(home, ".local", "share"), "ormma"));
  return {
    home: base,
    logs: env.ORMMA_LOGS || (platform === "darwin" ? join(home, "Library", "Logs", "Ormma") : join(base, "logs")),
    config: join(base, "ormma.env"),
    appData: join(base, "app"),
    bridgeData: join(base, "whatsapp"),
    label: env.ORMMA_LABEL || DEFAULT_LABEL,
    control: controlPath(base, platform, tmp),
  };
}

/* How a second launcher reaches the running one: a named pipe on Windows,
 * a Unix socket elsewhere — in the data folder, which only this user can
 * open, unless that path is too long for a socket (104 bytes on a Mac). */
function controlPath(base, platform, tmp) {
  const id = createHash("sha256").update(base).digest("hex").slice(0, 12);
  if (platform === "win32") return `\\\\.\\pipe\\ormma-${id}`;
  const inHome = join(base, "control.sock");
  return Buffer.byteLength(inHome) < 100 ? inHome : join(tmp, `ormma-${id}.sock`);
}
