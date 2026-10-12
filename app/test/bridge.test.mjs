import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createApi } from "../../whatsapp/src/api.mjs";
import { createBridge } from "../src/bridge.mjs";
import { createCapture } from "../src/capture.mjs";
import { openDb } from "../src/db.mjs";
import { silentLog } from "../src/log.mjs";
import { createScheduler } from "../src/scheduler.mjs";

/* The app's client and poller against the bridge's own HTTP API — the
 * contract between them — with a stand-in session behind it: nothing here
 * reaches WhatsApp, and nothing is sent. */
const TOKEN = "t".repeat(40);
const GROUP = "120363000000000001@g.us";
const session = {
  chats: new Set(),
  every: new Set(),
  status: () => ({ state: "open", me: { id: "447700900077:4@s.whatsapp.net" } }),
  commands: () => [],
  commandChats() {
    return { chats: [...this.chats].sort(), every: [...this.every].sort() };
  },
  setCommandChats(chats, every = []) {
    this.every = new Set(every);
    this.chats = new Set([...chats, ...every]);
    return this.commandChats();
  },
  ackCommands: (ids) => ids.length,
};

let server;
let bridge;
before(async () => {
  server = createApi({ token: TOKEN, session });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  bridge = createBridge({ url: `http://127.0.0.1:${server.address().port}`, token: TOKEN });
});
after(() => server.close());

test("the chats 📅 messages count in, and the groups where every message does, reach the bridge as sent", async () => {
  assert.deepEqual(await bridge.setCommandChats(["self"], [GROUP]), { chats: [GROUP, "self"], every: [GROUP] });
  const held = await bridge.commands();
  assert.deepEqual([held.chats, held.every, held.commands], [[GROUP, "self"], [GROUP], []]);
  assert.deepEqual(await bridge.setCommandChats(["self"]), { chats: ["self"], every: [] }, "no every: none");
});

test("the poller tells the bridge once, and the bridge then has what Settings says", async () => {
  const db = openDb(":memory:");
  db.settings.save({ captureChats: ["self"], captureEvery: [GROUP] });
  const claude = { model: "claude-haiku-5-5", read: async () => ({ kind: "none" }), status: () => ({}) };
  const told = [];
  const counting = { ...bridge, setCommandChats: (chats, every) => (told.push([chats, every]), bridge.setCommandChats(chats, every)) };
  const capture = createCapture({ db, bridge: counting, scheduler: createScheduler({ db, bridge: counting, log: silentLog }), log: silentLog, claude });
  await capture.poll();
  await capture.poll();
  await capture.poll();
  assert.equal(told.length, 1, "once — not again every poll");
  assert.deepEqual(session.commandChats(), { chats: [GROUP, "self"], every: [GROUP] });
});
