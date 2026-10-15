import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { COOKIE, createAuth } from "../../app/src/auth.mjs";
import { AlreadyRunning, ask, openControl } from "../lib/control.mjs";
import { isLocalHost, passwordProblem, startFirstRun } from "../lib/first-run.mjs";
import { partEnvironments, rotate } from "../lib/service.mjs";
import { DEFAULT_APP_PORT, DEFAULT_BRIDGE_PORT, ensureSettings, parse, withDefaults } from "../lib/settings.mjs";
import { agentPlist } from "../lib/system.mjs";
import { where } from "../lib/where.mjs";

const scratch = () => mkdtempSync(join(tmpdir(), "ormma-desktop-test-"));

function freePort() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

test("where: each platform's own place, Local (not Roaming) on Windows, and overrides for a test copy", () => {
  const mac = where({ env: {}, platform: "darwin", home: "/Users/anu", tmp: "/tmp" });
  assert.equal(mac.home, "/Users/anu/Library/Application Support/Ormma");
  assert.equal(mac.logs, "/Users/anu/Library/Logs/Ormma");
  assert.equal(mac.config, "/Users/anu/Library/Application Support/Ormma/ormma.env");
  assert.equal(mac.control, "/Users/anu/Library/Application Support/Ormma/control.sock");
  assert.equal(mac.label, "tech.analytixkraft.ormma");

  const win = where({ env: { LOCALAPPDATA: "C:\\Users\\anu\\AppData\\Local" }, platform: "win32", home: "C:\\Users\\anu" });
  assert.match(win.home, /AppData[\\/]Local[\\/]Ormma$/);
  assert.match(win.control, /^\\\\\.\\pipe\\ormma-[0-9a-f]{12}$/);

  const linux = where({ env: {}, platform: "linux", home: "/home/anu" });
  assert.equal(linux.home, "/home/anu/.local/share/ormma");
  assert.equal(linux.logs, "/home/anu/.local/share/ormma/logs");

  const test = where({ env: { ORMMA_HOME: "/x/home", ORMMA_LOGS: "/x/logs", ORMMA_LABEL: "tech.example.test" }, platform: "darwin", home: "/Users/anu" });
  assert.deepEqual([test.home, test.logs, test.label], ["/x/home", "/x/logs", "tech.example.test"]);

  // A socket path longer than a Mac allows moves to the temporary folder.
  const deep = where({ env: { ORMMA_HOME: `/${"d".repeat(120)}` }, platform: "darwin", tmp: "/tmp" });
  assert.match(deep.control, /^\/tmp\/ormma-[0-9a-f]{12}\.sock$/);
});

test("settings: the first run makes the file with long secrets, private; later runs keep what is there", () => {
  const dir = scratch();
  const file = join(dir, "sub", "ormma.env");
  const first = ensureSettings(file, { timezone: "Asia/Kolkata" });
  assert.ok(first.SESSION_SECRET.length >= 32);
  assert.ok(first.WHATSAPP_BRIDGE_TOKEN.length >= 32);
  assert.ok(first.ADMIN_PASSWORD.length >= 8);
  assert.equal(first.timezone, "Asia/Kolkata");
  assert.deepEqual([first.appPort, first.bridgePort], [DEFAULT_APP_PORT, DEFAULT_BRIDGE_PORT]);
  if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);

  const again = ensureSettings(file);
  assert.equal(again.SESSION_SECRET, first.SESSION_SECRET);
  assert.equal(again.WHATSAPP_BRIDGE_TOKEN, first.WHATSAPP_BRIDGE_TOKEN);

  // Someone's own file: their lines and ports stay; a short secret is made long.
  writeFileSync(file, "# mine\nAPP_PORT=3300\nSESSION_SECRET=short\nANTHROPIC_API_KEY='sk-ant-test'\n");
  const edited = ensureSettings(file);
  assert.equal(edited.appPort, 3300);
  assert.equal(edited.ANTHROPIC_API_KEY, "sk-ant-test");
  assert.ok(edited.SESSION_SECRET.length >= 32);
  const text = readFileSync(file, "utf8");
  assert.match(text, /^# mine$/m);
  assert.equal(text.match(/^SESSION_SECRET=/gm).length, 1);
});

test("settings: read as .env is read, and a bad port falls back", () => {
  assert.deepEqual(parse("A=1\n# B=2\n  C = 'x y' \nD=\"q\"\nnot a line\n"), { A: "1", C: "x y", D: "q" });
  assert.equal(withDefaults({ APP_PORT: "70000" }).appPort, DEFAULT_APP_PORT);
  assert.equal(withDefaults({ BRIDGE_PORT: "abc" }).bridgePort, DEFAULT_BRIDGE_PORT);
});

test("each part gets only its own settings, and nothing from the shell stands in for them", () => {
  const settings = withDefaults({
    SESSION_SECRET: "s".repeat(40),
    WHATSAPP_BRIDGE_TOKEN: "t".repeat(40),
    ADMIN_PASSWORD: "p".repeat(20),
    ANTHROPIC_API_KEY: "",
    DEFAULT_TIMEZONE: "Europe/London",
  });
  const places = where({ env: { ORMMA_HOME: "/data" }, platform: "darwin", home: "/Users/anu" });
  const envs = partEnvironments({
    settings,
    places,
    platform: "win32",
    command: "C:\\Ormma\\Ormma.exe",
    base: { PATH: "/bin", ANTHROPIC_API_KEY: "sk-from-shell", ADMIN_PASSWORD: "shell", ORMMA_HOME: "/elsewhere" },
  });
  assert.equal(envs.whatsapp.BRIDGE_TOKEN, "t".repeat(40));
  assert.equal(envs.whatsapp.HOST, "127.0.0.1");
  assert.equal(envs.whatsapp.PORT, String(DEFAULT_BRIDGE_PORT));
  assert.equal(envs.whatsapp.DATA_DIR, places.bridgeData);
  for (const secret of ["ADMIN_PASSWORD", "SESSION_SECRET", "ANTHROPIC_API_KEY", "ORMMA_HOME"]) assert.ok(!(secret in envs.whatsapp), secret);
  assert.equal(envs.whatsapp.PATH, "/bin");

  assert.equal(envs.app.ANTHROPIC_API_KEY, "");
  assert.equal(envs.app.ADMIN_PASSWORD, "p".repeat(20));
  assert.equal(envs.app.BRIDGE_URL, `http://127.0.0.1:${DEFAULT_BRIDGE_PORT}`);
  assert.equal(envs.app.DEFAULT_TIMEZONE, "Europe/London");
  assert.equal(envs.app.ORMMA_DESKTOP, "windows");
  assert.equal(envs.app.ORMMA_COMMAND, "C:\\Ormma\\Ormma.exe");
  assert.equal(envs.app.ORMMA_CONFIG, places.config);
});

test("logs are kept to about 5 MB: the one before is kept as .1", () => {
  const dir = scratch();
  const file = join(dir, "app.log");
  writeFileSync(file, "x".repeat(20));
  rotate(file, 10);
  assert.equal(readFileSync(`${file}.1`, "utf8").length, 20);
  rotate(join(dir, "none.log"), 10); // no log yet: nothing to do
});

test("the control door: answers a second launcher, and lets only one Ormma run", async () => {
  const path = process.platform === "win32" ? `\\\\.\\pipe\\ormma-test-${process.pid}` : join(scratch(), "control.sock");
  assert.equal(await ask(path, "status"), null);
  let stopped = false;
  const server = await openControl(path, {
    status: () => ({ ok: true, version: "9.9.9" }),
    stop: () => {
      stopped = true;
      return { ok: true };
    },
  });
  assert.deepEqual(await ask(path, "status"), { ok: true, version: "9.9.9" });
  assert.deepEqual(await ask(path, "nonsense"), { error: "unknown_command" });
  await assert.rejects(openControl(path, {}), AlreadyRunning);
  assert.deepEqual(await ask(path, "stop"), { ok: true });
  assert.ok(stopped);
  await new Promise((resolve) => server.close(resolve));
  assert.equal(await ask(path, "status"), null);
});

test("the control door: a socket file left by an Ormma that died is replaced", { skip: process.platform === "win32" }, async () => {
  const path = join(scratch(), "control.sock");
  writeFileSync(path, "");
  const server = await openControl(path, { status: () => ({ ok: true }) });
  assert.deepEqual(await ask(path, "status"), { ok: true });
  await new Promise((resolve) => server.close(resolve));
});

test("first run: what a password must be, and which hosts may ask", () => {
  assert.match(passwordProblem("short", "short"), /at least 8/);
  assert.match(passwordProblem("x".repeat(201), "x".repeat(201)), /at most 200/);
  assert.match(passwordProblem("abcdefgh", "abcdefgi"), /not the same/);
  assert.equal(passwordProblem("abcdefgh", "abcdefgh"), null);
  assert.ok(isLocalHost("localhost:3210", 3210));
  assert.ok(isLocalHost("127.0.0.1:3210", 3210));
  assert.ok(!isLocalHost("localhost:3211", 3210));
  assert.ok(!isLocalHost("ormma.attacker.example:3210", 3210)); // DNS rebinding
});

test("first run: the page, a cross-site post refused, a mismatch, then a password — and the app's own cookie", async () => {
  const port = await freePort();
  let hash = null;
  const store = { hash: () => hash, set: (h) => (hash = h) };
  const secret = "s".repeat(40);
  const page = startFirstRun({ port, timezone: "Asia/Kolkata", store, secret, fallbackPassword: "f".repeat(20) });
  await page.listening;
  const url = `http://localhost:${port}/`;
  try {
    const health = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json();
    assert.deepEqual(health, { ok: true, setup: true });

    const get = await fetch(`${url}people`);
    assert.equal(get.status, 200);
    const body = await get.text();
    assert.match(body, /Choose a password for Ormma/);
    assert.match(get.headers.get("content-security-policy"), /script-src 'self'/);
    assert.equal((await fetch(`${url}static/style.css`)).status, 200);
    assert.equal((await fetch(`${url}static/first-run.js`)).status, 200);
    assert.equal((await fetch(`${url}static/../../.env`)).status, 200); // normalised to /.env: the page, never a file

    const form = (password, again, headers = {}) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", origin: `http://localhost:${port}`, ...headers },
        body: new URLSearchParams({ password, again }),
        redirect: "manual",
      });
    assert.equal((await form("abcdefgh1", "abcdefgh1", { origin: "https://evil.example", "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal(hash, null);
    const mismatch = await form("abcdefgh1", "abcdefgh2");
    assert.equal(mismatch.status, 400);
    assert.match(await mismatch.text(), /not the same/);
    assert.equal(hash, null);

    const ok = await form("our-secret-1", "our-secret-1");
    assert.equal(ok.status, 200);
    assert.match(await ok.text(), /Ormma is starting/);
    await page.chosen;
    assert.match(hash, /^scrypt:/);
    const cookie = /bdr_session=([^;]+)/.exec(ok.headers.get("set-cookie"))[1];
    // The app, with the same secret and the password now stored, takes it.
    const auth = createAuth({ password: "f".repeat(20), secret, store });
    assert.ok(auth.verify(decodeURIComponent(cookie)));
    assert.ok(auth.checkPassword("our-secret-1"));
    assert.equal(COOKIE, "bdr_session");
  } finally {
    await page.close();
  }
});

test("the launchd agent: a valid plist that runs Ormma's own program, kept alive while the app is there", (t) => {
  const plist = agentPlist({
    label: "tech.analytixkraft.ormma",
    program: "/Applications/Ormma & Co.app/Contents/MacOS/Ormma",
    args: ["serve"],
    env: { ORMMA_HOME: "/tmp/x<y>" },
    logs: "/Users/anu/Library/Logs/Ormma",
    bundleId: "tech.analytixkraft.ormma",
  });
  assert.match(plist, /<string>\/Applications\/Ormma &amp; Co\.app\/Contents\/MacOS\/Ormma<\/string>\s*<string>serve<\/string>/);
  assert.match(plist, /<key>PathState<\/key>\s*<dict><key>\/Applications\/Ormma &amp; Co\.app\/Contents\/MacOS\/Ormma<\/key><true\/><\/dict>/);
  assert.match(plist, /<key>ORMMA_HOME<\/key><string>\/tmp\/x&lt;y&gt;<\/string>/);
  assert.match(plist, /<key>RunAtLoad<\/key><true\/>/);
  if (process.platform !== "darwin") return t.skip("plutil is a Mac's");
  const file = join(scratch(), "agent.plist");
  writeFileSync(file, plist);
  execFileSync("plutil", ["-lint", file]);
});
