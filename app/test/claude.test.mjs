import assert from "node:assert/strict";
import { test } from "node:test";
import Anthropic from "@anthropic-ai/sdk";
import { ClaudeFailed, MODEL, checkReading, createClaudeReader } from "../src/claude.mjs";
import { silentLog } from "../src/log.mjs";

// No test here reaches Anthropic: every client is a stand-in.
const SENT = "2026-10-08T04:30:00.000Z"; // Thursday, 10:00 in India
const IST = { timeZone: "Asia/Kolkata" };
const command = (text, extra = {}) => ({ id: "M1", chat: "group", chat_id: "120363000000000001@g.us", sent_at: SENT, text, quoted: null, marked: true, ...extra });

/* A client that answers with `answer` (or throws it), and keeps what it was asked. */
function fakeClient(answer) {
  const asked = [];
  return {
    asked,
    messages: {
      async create(params) {
        asked.push(params);
        if (answer instanceof Error) throw answer;
        return answer;
      },
    },
  };
}
const reply = (json, extra = {}) => ({
  stop_reason: "end_turn",
  usage: { input_tokens: 400, output_tokens: 60 },
  content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text: JSON.stringify(json) }],
  ...extra,
});
const answer = (fields) => ({ kind: "event", title: "", day: "", end_day: "", time: "", end_time: "", ...fields });

test("Claude Haiku 5.5 is asked for strict JSON, with the message and when it was sent — and no sampling settings", async () => {
  const client = fakeClient(reply(answer({ title: "Doctor", day: "2026-10-13", time: "10:00" })));
  const reader = createClaudeReader({ apiKey: "test", log: silentLog, client });
  assert.deepEqual(await reader.read(command("Doctor tue 10 am", { marked: false, quoted: "When is your appointment?" }), IST), {
    kind: "event",
    title: "Doctor",
    day: "2026-10-13",
    endDay: null,
    time: "10:00",
    endTime: "",
  });
  const [params] = client.asked;
  assert.equal(params.model, MODEL);
  assert.equal(MODEL, "claude-haiku-5-5");
  assert.equal(params.output_config.effort, "low");
  assert.equal(params.output_config.format.type, "json_schema");
  assert.deepEqual(params.output_config.format.schema.required, ["kind", "title", "day", "end_day", "time", "end_time"]);
  assert.deepEqual(params.output_config.format.schema.properties.kind.enum, ["event", "task", "note", "none"]);
  for (const sampling of ["temperature", "top_p", "top_k"]) assert.equal(sampling in params, false, sampling);
  assert.equal(params.messages.at(-1).role, "user", "no prefill");
  const sent = params.messages[0].content;
  assert.match(sent, /^Sent: Thursday 8 October 2026, 10:00 \(Asia\/Kolkata\)\./);
  assert.match(sent, /Marked with 📅: no\./);
  assert.match(sent, /<message>\nDoctor tue 10 am\n<\/message>/);
  assert.match(sent, /<replied_to>\nWhen is your appointment\?\n<\/replied_to>/);
  assert.doesNotMatch(JSON.stringify(params), /120363000000000001/, "not the group");
});

test("what Claude says is checked before it is used", () => {
  const ok = (fields) => checkReading(answer(fields), "2026-10-08");
  assert.deepEqual(ok({ kind: "none" }), { kind: "none" });
  assert.deepEqual(ok({ kind: "note", title: "ignored", day: "2026-02-30" }), { kind: "note" }, "a note is the message itself: nothing else of the answer is used");
  assert.deepEqual(ok({ kind: "task", title: " Pay   rent ", day: "2026-10-09" }), { kind: "task", title: "Pay rent", due: "2026-10-09" });
  assert.deepEqual(ok({ kind: "task", title: "", day: "" }), { kind: "task", title: "Untitled", due: null });
  assert.deepEqual(ok({ title: "Trip", day: "2026-10-10", end_day: "2026-10-13" }), { kind: "event", title: "Trip", day: "2026-10-10", endDay: "2026-10-13", time: "", endTime: "" });
  assert.deepEqual(ok({ title: "Choir", day: "2026-10-10", time: "18:00", end_time: "17:00", end_day: "2026-10-09" }).endTime, "", "an end before the start is dropped");
  assert.equal(ok({ title: "x".repeat(500), day: "2026-10-10" }).title.length, 200);
  for (const bad of [{ kind: "meeting" }, { day: "" }, { day: "2026-02-30" }, { day: "10/13/2026" }, { day: "2026-10-07" }, { day: "2035-01-01" }]) {
    assert.throws(() => ok(bad), ClaudeFailed, JSON.stringify(bad));
  }
});

test("a refusal, a cut-short or broken answer, or a failed call is ClaudeFailed — retried only when that can help", async () => {
  const fails = async (outcome) => {
    const reader = createClaudeReader({ apiKey: "test", log: silentLog, client: fakeClient(outcome) });
    try {
      await reader.read(command("Lunch 1pm"), IST);
    } catch (err) {
      assert.ok(err instanceof ClaudeFailed, err.message);
      return { retry: err.retry, refused: err.refused };
    }
    assert.fail("it did not fail");
  };
  const body = { type: "error", error: { type: "x", message: "m" } };
  assert.deepEqual(await fails(reply({}, { stop_reason: "refusal" })), { retry: false, refused: false });
  assert.deepEqual(await fails(reply({}, { stop_reason: "max_tokens" })), { retry: false, refused: false });
  assert.deepEqual(await fails({ stop_reason: "end_turn", content: [{ type: "text", text: "not json" }] }), { retry: false, refused: false });
  assert.deepEqual(await fails(new Anthropic.AuthenticationError(401, body, "no", new Headers())), { retry: false, refused: true });
  assert.deepEqual(await fails(new Anthropic.BadRequestError(400, body, "no", new Headers())), { retry: false, refused: true });
  assert.deepEqual(await fails(new Anthropic.RateLimitError(429, body, "busy", new Headers())), { retry: true, refused: false });
  assert.deepEqual(await fails(new Anthropic.InternalServerError(500, body, "down", new Headers())), { retry: true, refused: false });
  assert.deepEqual(await fails(new Anthropic.APIConnectionError({ message: "offline" })), { retry: true, refused: false });
});

test("a key that belongs to no one workspace: ANTHROPIC_WORKSPACE_ID goes with every call — and Settings hears how the last call went", async () => {
  const seen = [];
  // Stands in for the network: nothing leaves this computer.
  const fetch = async (url, init) => {
    seen.push(new Headers(init.headers).get("anthropic-workspace-id"));
    return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: MODEL, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(answer({ kind: "none" })) }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const reader = createClaudeReader({ apiKey: "test", workspaceId: "wrkspc_test", log: silentLog, fetch });
  assert.equal(reader.status().ok, null, "not used yet");
  assert.deepEqual(await reader.read(command("Thanks!", { marked: false }), IST), { kind: "none" });
  assert.deepEqual(seen, ["wrkspc_test"]);
  assert.equal(reader.status().ok, true);

  const refusing = createClaudeReader({
    apiKey: "test",
    log: silentLog,
    client: fakeClient(new Anthropic.BadRequestError(400, { type: "error", error: { type: "invalid_request_error", message: "This API key is not scoped to a workspace" } }, "400", new Headers())),
  });
  await assert.rejects(refusing.read(command("Lunch 1pm"), IST), ClaudeFailed);
  assert.deepEqual([refusing.status().ok, refusing.status().error], [false, "the API refused the request: This API key is not scoped to a workspace"]);
});
