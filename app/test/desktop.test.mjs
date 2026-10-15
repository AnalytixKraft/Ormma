import assert from "node:assert/strict";
import { test } from "node:test";
import { explain } from "../src/bridge.mjs";
import { desktopHints, stepText } from "../src/desktop.mjs";

test("desktop hints: none from the repo; the desktop app's own steps on a Mac and on Windows", () => {
  assert.equal(desktopHints({}), null);

  const mac = desktopHints({
    ORMMA_DESKTOP: "mac",
    ORMMA_COMMAND: "/Applications/Ormma.app/Contents/MacOS/Ormma",
    ORMMA_CONFIG: "/Users/anu/Library/Application Support/Ormma/ormma.env",
    ORMMA_LOGS: "/Users/anu/Library/Logs/Ormma",
  });
  assert.equal(stepText(mac.reset), "run '/Applications/Ormma.app/Contents/MacOS/Ormma' reset-password in Terminal");
  assert.equal(mac.config, "/Users/anu/Library/Application Support/Ormma/ormma.env");

  const windows = desktopHints({ ORMMA_DESKTOP: "windows", ORMMA_COMMAND: "C:\\Program Files\\Ormma\\Ormma.exe" });
  assert.equal(stepText(windows.reset), "choose Start menu → Ormma → Reset Ormma password");
  assert.match(windows.config, /ormma\.env/);
});

test("desktop hints: a bridge that is not answering says what to do in the desktop app, not docker compose", () => {
  const mac = desktopHints({ ORMMA_DESKTOP: "mac", ORMMA_COMMAND: "/Applications/Ormma.app/Contents/MacOS/Ormma" });
  assert.match(explain("unreachable", null, null, mac), /starts it again on its own.*restart in Terminal/);
  assert.doesNotMatch(explain("unreachable", null, null, mac), /docker/);
  assert.match(explain("unreachable", null, null, null), /docker compose ps/);
});

test("desktop hints: the sign-in page tells a desktop user how to reset the password", async () => {
  process.env.ORMMA_DESKTOP = "mac";
  process.env.ORMMA_COMMAND = "/Applications/Ormma.app/Contents/MacOS/Ormma";
  try {
    const { signInPage } = await import("../src/views/layout.mjs");
    const page = String(signInPage({ today: { year: 2026, month: 10, day: 15 }, assets: { css: "/s.css", js: "/a.js" } }));
    assert.match(page, /run <code>&#39;\/Applications\/Ormma\.app\/Contents\/MacOS\/Ormma&#39; reset-password<\/code> in Terminal/);
    assert.doesNotMatch(page, /scripts\/reset-password\.sh|\.env/);
  } finally {
    delete process.env.ORMMA_DESKTOP;
    delete process.env.ORMMA_COMMAND;
  }
});
