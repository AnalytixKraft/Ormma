/* ormma.env: the desktop app's .env. Made on the first run with secrets
 * made up for this computer, and read on every start. Someone may edit it —
 * to add a Claude API key, or move a port — so it is read the way .env is
 * read, and a value already long enough is never replaced.
 *
 * The password is not in it. The one you sign in with is chosen on the
 * first page Ormma opens (first-run.mjs) and kept, hashed, in the app's
 * database, exactly as Settings → Password keeps it. ADMIN_PASSWORD here is
 * only the fallback the app insists on having: made up, and never shown,
 * because the launcher never starts the app without a password of yours. */

import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DEFAULT_APP_PORT = 3210;
// Not 3000, the bridge's port everywhere else: that is every web
// developer's port too, and a Mac running Ormma from the repo already has
// its bridge there.
export const DEFAULT_BRIDGE_PORT = 3211;

/* Each made the way scripts/setup.sh makes it, and as long. */
const SECRETS = {
  SESSION_SECRET: { min: 32, make: () => randomBytes(32).toString("hex") },
  WHATSAPP_BRIDGE_TOKEN: { min: 32, make: () => randomBytes(32).toString("hex") },
  ADMIN_PASSWORD: { min: 8, make: () => randomBytes(24).toString("base64url") },
};

export function template({ timezone, secrets }) {
  return `# Ormma's settings: the desktop app's .env. Made on the first run, with
# secrets made up for this computer — keep this file private. After changing
# anything here, restart Ormma.

# Signs the sign-in cookie. Changing it signs everyone out.
SESSION_SECRET=${secrets.SESSION_SECRET}

# Shared by the app and its WhatsApp bridge.
WHATSAPP_BRIDGE_TOKEN=${secrets.WHATSAPP_BRIDGE_TOKEN}

# Not the password you sign in with: that is the one you chose when Ormma
# first opened, kept (hashed) in its database. This is a fallback the app
# needs to have, made up and never used.
ADMIN_PASSWORD=${secrets.ADMIN_PASSWORD}

# The time zone the first run starts with. Change it on the Settings page.
DEFAULT_TIMEZONE=${timezone}

# Ormma answers on http://localhost:<APP_PORT>, on this computer only. Its
# WhatsApp bridge listens on BRIDGE_PORT, also on this computer only.
APP_PORT=${DEFAULT_APP_PORT}
BRIDGE_PORT=${DEFAULT_BRIDGE_PORT}

# Optional: a Claude API key (https://console.anthropic.com). With it, Claude
# reads 📅 messages — free-form wording too — and a group can have every
# message count (Settings → Calendar). Each message read goes to Anthropic.
ANTHROPIC_API_KEY=
# Only for a key that belongs to no one workspace (the API says so).
ANTHROPIC_WORKSPACE_ID=
`;
}

/* KEY=value lines, as Docker Compose and the scripts read .env: # starts a
 * comment line, and one pair of surrounding quotes is taken off. */
export function parse(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    if (value.length >= 2 && (value[0] === "'" || value[0] === '"') && value.at(-1) === value[0]) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

/* Replace KEY=… in place, or add it at the end: the rest of the file —
 * comments, someone's own lines — stays as it was. */
function put(text, key, value) {
  const line = new RegExp(`^\\s*${key}\\s*=.*$`, "m");
  return line.test(text) ? text.replace(line, () => `${key}=${value}`) : `${text.replace(/\n*$/, "\n")}${key}=${value}\n`;
}

/* The settings, after making whatever is missing: the whole file on the
 * first run, a secret that is missing or too short after that. */
export function ensureSettings(file, { timezone = localTimeZone() } = {}) {
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  let text;
  if (!existsSync(file)) {
    const secrets = Object.fromEntries(Object.entries(SECRETS).map(([key, { make }]) => [key, make()]));
    text = template({ timezone, secrets });
    writeFileSync(file, text, { mode: 0o600 });
  } else {
    text = readFileSync(file, "utf8");
    const values = parse(text);
    let changed = false;
    for (const [key, { min, make }] of Object.entries(SECRETS)) {
      if ((values[key] || "").length < min) {
        text = put(text, key, make());
        changed = true;
      }
    }
    if (changed) writeFileSync(file, text, { mode: 0o600 });
  }
  try {
    chmodSync(file, 0o600);
  } catch {
    // Windows: the folder under %LOCALAPPDATA% is already this user's alone.
  }
  return withDefaults(parse(text));
}

export function withDefaults(values) {
  const port = (value, fallback) => {
    const n = Number(value);
    return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback;
  };
  return {
    ...values,
    appPort: port(values.APP_PORT, DEFAULT_APP_PORT),
    bridgePort: port(values.BRIDGE_PORT, DEFAULT_BRIDGE_PORT),
    timezone: values.DEFAULT_TIMEZONE || localTimeZone(),
  };
}

/* This computer's time zone, as the first run's guess. */
export function localTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata";
  } catch {
    return "Asia/Kolkata";
  }
}
