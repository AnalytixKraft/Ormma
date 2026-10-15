/* A stand-in for the WhatsApp bridge, for the demo (run.mjs) and the
 * screenshots: it answers the app exactly as whatsapp/ does — the same
 * paths, the same Bearer token check, the same JSON, the same refusals
 * (whatsapp/README.md, "API") — but it is no WhatsApp account and talks to
 * no one. A message posted to /send is kept in this process's memory and
 * goes nowhere; it is forgotten when the process stops.
 *
 *   BRIDGE_TOKEN=<32+ characters> node scripts/demo/stub-bridge.mjs [--port 3291] [--state open|pairing|idle]
 *
 * It listens on 127.0.0.1 only. `open` (the default) is a linked number,
 * "Ormma demo", in four made-up groups. `pairing` offers a QR code that is
 * nonsense text, not a WhatsApp code, and stays there — for a screenshot of
 * Settings → WhatsApp while linking. From `idle`, Link a phone shows that
 * code and, a few seconds later (--scan-after), the stub "scans" it itself
 * and is `open` again, so Unlink and Link can be tried in the demo.
 *
 * Nothing it holds is real: the linked number and the groups are made up,
 * and every phone number in the demo is in Ofcom's range for drama,
 * +44 7700 900000–900999, which belongs to no one. */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const STUB_PORT = 3291;
export const STUB_ME = Object.freeze({ id: "447700900123@s.whatsapp.net", name: "Ormma demo" });
export const STUB_GROUPS = Object.freeze([
  { id: "120363000000000104@g.us", subject: "Book club", participants: 9, announce: false, is_admin: true },
  { id: "120363000000000103@g.us", subject: "Choir", participants: 23, announce: false, is_admin: false },
  { id: "120363000000000102@g.us", subject: "Family", participants: 14, announce: false, is_admin: true },
  { id: "120363000000000101@g.us", subject: "St. Mary's Youth", participants: 46, announce: false, is_admin: false },
]);
const STATES = ["open", "pairing", "idle"];

/* The real bridge's limits, so the app meets the same answers here. */
const GROUP_JID = /^\d+(-\d+)?@g\.us$/;
const DIRECT_JID = /^[1-9]\d{7,14}@s\.whatsapp\.net$/;
const MAX_TEXT = 20_000;
const MAX_KEY = 200;
const MAX_BODY_BYTES = 256 * 1024;
const MAX_ACK = 500;
const DIRECT_PER_HOUR = 30;
const IDEMPOTENCY_MS = 24 * 60 * 60_000;
/* What /send kept, newest last — for anyone curious, in memory only. */
const MAX_KEPT = 500;
const QR_EVERY_MS = 20_000;

const ROUTES = {
  "/status": "GET",
  "/pair": "POST",
  "/logout": "POST",
  "/groups": "GET",
  "/send": "POST",
  "/commands": "GET",
  "/commands/ack": "POST",
  "/commands/chats": "POST",
};

class StubError extends Error {
  constructor(status, code, message = null, extra = {}) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }

  body() {
    return { error: this.code, ...(this.message !== this.code ? { message: this.message } : {}), ...this.extra };
  }
}

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest();

function reply(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new StubError(413, "payload_too_large", `the body must be under ${MAX_BODY_BYTES} bytes`);
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new StubError(400, "invalid_json", "the body must be a JSON object");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new StubError(400, "invalid_json", "the body must be a JSON object");
  return body;
}

const codePoints = (s) => [...s].length;

/* A QR payload that is plainly not WhatsApp's: scanned, it reads as these
 * words and a string of random letters, and links nothing. Long enough to
 * draw a code as dense as the real one. */
const fakeQr = () => `ormma-demo,not-a-whatsapp-code,nothing-to-link,${randomBytes(72).toString("base64url")}`;

/* A message id shaped like WhatsApp's. */
const messageId = () => `3EB0${randomBytes(8).toString("hex").toUpperCase()}`;

const lastFour = (chatId) => (chatId.endsWith("@g.us") ? chatId : `…${chatId.split("@")[0].slice(-4)}`);

/* The stub's HTTP server, not yet listening. token: the shared secret (32+
 * characters, or the stub answers 503 as an unconfigured bridge does);
 * state: where it starts; scanAfterMs: how long after Link a phone the
 * stub links itself. log(line): where it reports — method, path and status,
 * never a message's text. */
export function createStubBridge({ token = "", state = "open", scanAfterMs = 12_000, log = (line) => console.log(line) } = {}) {
  if (!STATES.includes(state)) throw new Error(`--state must be one of ${STATES.join(", ")}`);
  const configured = token.length >= 32;
  const expected = configured ? sha256(token) : null;
  const s = { state, since: new Date().toISOString(), me: state === "open" ? STUB_ME : null, qr: null, qrExpiresAt: null, lastError: null };
  let scanTimer = null;
  const sent = new Map(); // idempotency key → {result, at}
  const kept = [];
  const directAt = [];
  let commandChats = [];
  let everyMessage = [];

  /* A QR that "rotates" as the real one does: the same nonsense, a new
   * expiry every 20 seconds, so the page's polling sees a live code. */
  function offerQr() {
    s.qr = s.qr ?? fakeQr();
    s.qrExpiresAt = new Date(Math.ceil((Date.now() + 1) / QR_EVERY_MS) * QR_EVERY_MS).toISOString();
  }

  function setState(next, patch = {}) {
    if (next !== s.state) s.since = new Date().toISOString();
    Object.assign(s, { state: next }, patch);
    if (next !== "pairing") {
      s.qr = null;
      s.qrExpiresAt = null;
      clearTimeout(scanTimer);
      scanTimer = null;
    }
    if (next !== "open") s.me = null;
    log(`stub bridge: state ${next}`);
  }
  if (state === "pairing") offerQr();

  function status() {
    if (s.state === "pairing" && Date.parse(s.qrExpiresAt) <= Date.now()) offerQr();
    return {
      state: s.state,
      me: s.me,
      qr: s.qr,
      qr_expires_at: s.qrExpiresAt,
      since: s.since,
      last_error: s.lastError,
      baileys_version: "demo-stub",
      wa_version: null,
      features: ["text", "commands"],
    };
  }

  function requireOpen() {
    if (s.state !== "open") throw new StubError(409, "not_connected", null, { state: s.state });
  }

  function parseSend(body) {
    const { chat_id: chatId, text, idempotency_key: key } = body;
    if (typeof chatId !== "string" || !(GROUP_JID.test(chatId) || DIRECT_JID.test(chatId))) throw new StubError(400, "invalid_chat_id");
    if (typeof text !== "string" || text.trim() === "" || codePoints(text) > MAX_TEXT) throw new StubError(400, "invalid_text");
    if (typeof key !== "string" || key.trim() === "" || key.length > MAX_KEY) throw new StubError(400, "missing_idempotency_key");
    return { chatId, text, key };
  }

  /* Accepted, kept here, sent nowhere. */
  function send({ chatId, text, key }) {
    const now = Date.now();
    for (const [k, v] of sent) if (v.at <= now - IDEMPOTENCY_MS) sent.delete(k);
    const done = sent.get(key);
    if (done) return { ...done.result, deduplicated: true };
    requireOpen();
    if (GROUP_JID.test(chatId)) {
      const group = STUB_GROUPS.find((g) => g.id === chatId);
      if (!group) throw new StubError(403, "not_a_member");
      if (group.announce && !group.is_admin) throw new StubError(403, "admins_only");
    } else {
      while (directAt.length && directAt[0] <= now - 60 * 60_000) directAt.shift();
      if (directAt.length >= DIRECT_PER_HOUR) throw new StubError(429, "rate_limited", `at most ${DIRECT_PER_HOUR} direct messages an hour`);
      directAt.push(now);
    }
    const result = { message_id: messageId(), chat_id: chatId };
    sent.set(key, { result, at: now });
    kept.push({ ...result, key, text, at: new Date(now).toISOString() });
    if (kept.length > MAX_KEPT) kept.shift();
    log(`stub bridge: kept a message for ${lastFour(chatId)} (${result.message_id}) — sent nowhere`);
    return { ...result, deduplicated: false };
  }

  function pair() {
    if (s.state !== "idle") return status();
    setState("pairing", { lastError: null });
    offerQr();
    scanTimer = setTimeout(() => setState("open", { me: STUB_ME, lastError: null }), scanAfterMs);
    return status();
  }

  function parseChats(body) {
    const { chats, every = [] } = body;
    const group = (c) => typeof c === "string" && GROUP_JID.test(c);
    if (!Array.isArray(chats) || chats.length > MAX_ACK || !chats.every((c) => c === "self" || group(c))) throw new StubError(400, "invalid_chats");
    if (!Array.isArray(every) || every.length > MAX_ACK || !every.every(group)) throw new StubError(400, "invalid_chats");
    return { chats, every };
  }

  function parseAck(body) {
    const { ids } = body;
    if (!Array.isArray(ids) || ids.length > MAX_ACK || !ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= MAX_KEY)) {
      throw new StubError(400, "invalid_ids");
    }
    return ids;
  }

  function authorized(req) {
    const match = /^Bearer +(.+)$/i.exec(req.headers.authorization || "");
    return Boolean(match) && timingSafeEqual(sha256(match[1]), expected);
  }

  async function route(req, res, path) {
    if (path === "/healthz") {
      if (req.method !== "GET" && req.method !== "HEAD") throw new StubError(405, "method_not_allowed");
      return reply(res, 200, { ok: true });
    }
    if (!configured) throw new StubError(503, "bridge_token_not_configured", null, { state: "unconfigured" });
    if (!authorized(req)) throw new StubError(401, "unauthorized");
    const method = ROUTES[path];
    if (!method) throw new StubError(404, "not_found");
    if (req.method !== method) {
      res.setHeader("allow", method);
      throw new StubError(405, "method_not_allowed");
    }
    switch (path) {
      case "/status":
        return reply(res, 200, status());
      case "/pair":
        return reply(res, 200, pair());
      case "/logout":
        setState("idle", { lastError: null });
        return reply(res, 200, status());
      case "/groups":
        requireOpen();
        return reply(res, 200, { groups: STUB_GROUPS.map((g) => ({ ...g })) });
      case "/send":
        return reply(res, 200, send(parseSend(await readJson(req))));
      case "/commands":
        // No one can send the stub a 📅 message: it holds none.
        return reply(res, 200, { commands: [], chats: commandChats, every: everyMessage });
      case "/commands/chats": {
        const { chats, every } = parseChats(await readJson(req));
        everyMessage = [...new Set(every)].sort();
        commandChats = [...new Set([...chats, ...everyMessage])].sort();
        return reply(res, 200, { chats: commandChats, every: everyMessage });
      }
      case "/commands/ack":
        parseAck(await readJson(req));
        return reply(res, 200, { acked: 0 });
    }
  }

  const server = createServer(async (req, res) => {
    let path = null;
    try {
      try {
        path = new URL(req.url || "/", "http://bridge").pathname;
      } catch {
        throw new StubError(400, "bad_request", "the request target is not a valid URL");
      }
      await route(req, res, path);
    } catch (err) {
      if (res.headersSent) res.end();
      else if (err instanceof StubError) reply(res, err.status, err.body());
      else reply(res, 500, { error: "internal_error" });
    }
    if (path !== "/healthz" && (req.method !== "GET" || res.statusCode >= 400)) log(`stub bridge: ${req.method} ${path} → ${res.statusCode}`);
  });
  server.on("close", () => clearTimeout(scanTimer));
  return server;
}

/* ------------------------------------------------------------------ CLI */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      port: { type: "string", default: String(STUB_PORT) },
      state: { type: "string", default: "open" },
      "scan-after": { type: "string", default: "12" },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`stub bridge: --port ${values.port} is not a port.`);
    process.exit(2);
  }
  // The live bridge's port: never stand in front of it, nor confuse the two.
  if (port === 3000) {
    console.error("stub bridge: port 3000 is the real bridge's. Choose another (the demo uses 3291).");
    process.exit(2);
  }
  if (!STATES.includes(values.state)) {
    console.error(`stub bridge: --state must be one of ${STATES.join(", ")}.`);
    process.exit(2);
  }
  const token = (process.env.BRIDGE_TOKEN || "").trim();
  if (token.length < 32) console.error("stub bridge: BRIDGE_TOKEN is missing or under 32 characters, so every call but /healthz answers 503, as the real bridge does.");
  const server = createStubBridge({ token, state: values.state, scanAfterMs: Number(values["scan-after"]) * 1000 });
  server.on("error", (err) => {
    console.error(`stub bridge: cannot listen on 127.0.0.1:${port}: ${err.code === "EADDRINUSE" ? "something is already listening there" : err.message}`);
    process.exit(1);
  });
  server.listen(port, "127.0.0.1", () => console.log(`stub bridge: listening on http://127.0.0.1:${port} (state ${values.state}) — a fake WhatsApp; nothing it is given is sent`));
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.once(signal, () => {
      server.close();
      process.exit(0);
    });
  }
}
