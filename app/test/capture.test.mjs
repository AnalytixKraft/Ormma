import assert from "node:assert/strict";
import { test } from "node:test";
import { createCapture, readCapture, renderCaptureReply } from "../src/capture.mjs";
import { ClaudeFailed } from "../src/claude.mjs";
import { openDb } from "../src/db.mjs";
import { silentLog } from "../src/log.mjs";
import { createScheduler } from "../src/scheduler.mjs";

// Thursday 8 October 2026, 10:00 in India.
const SENT = "2026-10-08T04:30:00.000Z";
const IST = { timeZone: "Asia/Kolkata" };
const read = (text, quoted = null, sentAt = SENT) => {
  const { notes, sender, ...item } = readCapture({ text, quoted, sent_at: sentAt }, IST);
  return item;
};
const event = (title, day, time = "", extra = {}) => ({ kind: "event", title, day, endDay: null, time, endTime: "", why: null, ...extra });
const task = (title, due = null, why = null) => ({ kind: "task", title, due, why });

test("a 📅 message becomes an event: a day, a time, and the rest is its title", () => {
  const cases = [
    ["Dentist Tue 10am", event("Dentist", "2026-10-13", "10:00")],
    ["Dentist on Tuesday at 10am.", event("Dentist", "2026-10-13", "10:00")],
    ["Dinner Thu 8pm", event("Dinner", "2026-10-08", "20:00"), "today is Thursday"],
    ["Dinner at Ravi’s next Thu 8pm", event("Dinner at Ravi’s", "2026-10-15", "20:00"), "next: not today"],
    ["Team lunch tomorrow 1pm", event("Team lunch", "2026-10-09", "13:00")],
    ["Movie tonight 9.30pm", event("Movie", "2026-10-08", "21:30")],
    ["Lunch at noon", event("Lunch", "2026-10-08", "12:00")],
    ["Concert 12 Dec 7pm", event("Concert", "2026-12-12", "19:00")],
    ["Visit Oct 2", event("Visit", "2027-10-02"), "a day gone by this year is next year's"],
    ["Wedding 5 Jan 2027", event("Wedding", "2027-01-05")],
    ["Leap 29 Feb", event("Leap", "2028-02-29")],
    ["Flight 2026-11-02 06:15", event("Flight", "2026-11-02", "06:15")],
    ["Exam 20/10", event("Exam", "2026-10-20"), "day first"],
    ["Meeting 10:00-10:45 on Monday", event("Meeting", "2026-10-12", "10:00", { endTime: "10:45" })],
    ["Choir Sat 6-8pm", event("Choir", "2026-10-10", "18:00", { endTime: "20:00" })],
    ["Doctor 11-1pm Fri", event("Doctor", "2026-10-09", "11:00", { endTime: "13:00" })],
    ["Trip to Munnar 10-13 Oct", event("Trip to Munnar", "2026-10-10", "", { endDay: "2026-10-13" })],
    ["Holiday 3rd to 7th November", event("Holiday", "2026-11-03", "", { endDay: "2026-11-07" })],
    ["Trip 30 Dec - 2 Jan", event("Trip", "2026-12-30", "", { endDay: "2027-01-02" })],
    ["Call Mum 6:30pm", event("Call Mum", "2026-10-08", "18:30"), "a time and no day: that day"],
    ["Call Mum 9am", event("Call Mum", "2026-10-09", "09:00"), "…or the next, when it had passed"],
    ["Tue 10am", event("Untitled", "2026-10-13", "10:00")],
  ];
  for (const [text, expected, why] of cases) assert.deepEqual(read(text), expected, `${text}${why ? ` (${why})` : ""}`);
});

test("…or a task: when it says so, when it is due by a day, or when it has no day or time", () => {
  assert.deepEqual(read("task Pay rent by Fri"), task("Pay rent", "2026-10-09"));
  assert.deepEqual(read("todo: renew the car insurance"), task("renew the car insurance"));
  assert.deepEqual(read("Pay bill by 15/10"), task("Pay bill", "2026-10-15"));
  assert.deepEqual(read("Renew passport due 20 Oct"), task("Renew passport", "2026-10-20"));
  assert.deepEqual(read("Buy batteries"), task("Buy batteries", null, "There was no day or time in it, so it is a task."));
  assert.deepEqual(read("Bad 31/02"), task("Bad 31/02", null, "There was no day or time in it, so it is a task."), "no such day");
});

test("a reply of 📅 takes the day, time and title from the message it replies to — and keeps that message", () => {
  assert.deepEqual(read("", "Choir moves to Sat 6pm"), event("Choir moves", "2026-10-10", "18:00"));
  assert.deepEqual(read("choir practice", "We meet Sat 6-8pm at the hall"), event("choir practice", "2026-10-10", "18:00", { endTime: "20:00" }), "your words are the title");
  assert.deepEqual(read("Sun 5pm", "Shall we do the clean-up?"), event("Shall we do the clean-up?", "2026-10-11", "17:00"), "your day, their words");
  const full = readCapture({ text: "", quoted: "Choir moves to Sat 6pm\nBring the new music", sent_at: SENT }, { ...IST, where: "St. Mary's Choir" });
  assert.equal(full.notes, "Choir moves to Sat 6pm\nBring the new music\n\nFrom WhatsApp: St. Mary's Choir");
  assert.equal(readCapture({ text: "Lunch 1pm", quoted: null, sent_at: SENT }, IST).notes, "From WhatsApp: Message yourself");
  assert.equal(readCapture({ text: "Lunch 1pm", quoted: null, sent_at: SENT, sender: "Anu" }, { ...IST, where: "Family" }).notes, "From WhatsApp: Family, Anu");
});

test("days are read from when it was sent, not from when it is read", () => {
  // Sent Wednesday evening, read Thursday: "tomorrow" is Thursday.
  assert.equal(read("Lunch tomorrow 1pm", null, "2026-10-07T14:00:00.000Z").day, "2026-10-08");
});

test("the answer says what was added, and can never be taken for a 📅 message", () => {
  const trip = readCapture({ text: "Trip to Munnar 10-13 Oct", quoted: null, sent_at: SENT }, IST);
  assert.equal(renderCaptureReply(trip), "✅ Added to the calendar: *Trip to Munnar*\nSat 10 Oct – Tue 13 Oct, all day\n\nNot right? Change it in Wish Calendar → Calendar.");
  const dentist = { ...readCapture({ text: "Dentist Tue 10am", quoted: null, sent_at: SENT, sender: "Anu" }, IST), remind: 5 };
  assert.equal(renderCaptureReply(dentist), "✅ Added to the calendar: *Dentist* (from Anu)\nTue 13 Oct, 10:00\nReminder 5 minutes before.\n\nNot right? Change it in Wish Calendar → Calendar.");
  const batteries = readCapture({ text: "Buy batteries", quoted: null, sent_at: SENT }, IST);
  assert.match(renderCaptureReply(batteries), /^✅ Added a task: \*Buy batteries\*\nThere was no day or time in it, so it is a task\./);
  for (const reply of [renderCaptureReply(trip), renderCaptureReply(batteries)]) assert.doesNotMatch(reply, /^\s*[📅📆]/u);
});

/* Stands in for the bridge, 📅 messages and all. Nothing reaches WhatsApp. */
function fakeBridge(held) {
  return {
    held,
    chats: [],
    chatsEvery: [],
    told: [],
    sent: [],
    acked: [],
    async status() {
      return { state: "open", me: { id: "447700900077:4@s.whatsapp.net", name: "Linked" } };
    },
    async send({ chatId, text, key }) {
      this.sent.push({ chatId, text, key });
      return { message_id: `M${this.sent.length}`, chat_id: chatId, deduplicated: false };
    },
    async commands() {
      return { commands: this.held, chats: this.chats, every: this.chatsEvery };
    },
    async setCommandChats(chats, every = []) {
      this.told.push(chats);
      this.chats = chats;
      this.chatsEvery = every;
      return { chats, every };
    },
    async ackCommands(ids) {
      this.acked.push(...ids);
      this.held = this.held.filter((c) => !ids.includes(c.id));
      return { acked: ids.length };
    },
  };
}

const FAMILY = "120363000000000001@g.us";
const SELF_JID = "447700900077@s.whatsapp.net";

function setup(held, settings = {}, claude = null) {
  const db = openDb(":memory:");
  const bridge = fakeBridge(held);
  let now = new Date("2026-10-08T05:00:00Z");
  const clock = () => now;
  const scheduler = createScheduler({ db, bridge, log: silentLog, clock, pause: async () => {}, gap: () => 0 });
  db.settings.save({ enabled: true, timezone: "Asia/Kolkata", captureChats: ["self", FAMILY], ...settings });
  db.chats.remember([{ id: FAMILY, subject: "Family" }]);
  return { db, bridge, capture: createCapture({ db, bridge, scheduler, log: silentLog, clock, claude }), at: (iso) => (now = new Date(iso)) };
}

/* Stands in for claude.mjs's reader: answers by the message's words. */
function fakeClaude(answers) {
  return {
    model: "claude-haiku-5-5",
    asked: [],
    async read(command) {
      this.asked.push(command.id);
      const answer = answers[command.text];
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
}

const command = (id, text, extra = {}) => ({ id, chat: "self", chat_id: SELF_JID, sent_at: SENT, text, quoted: null, from_me: true, sender: null, ...extra });
const inFamily = (id, text, extra = {}) => command(id, text, { chat: "group", chat_id: FAMILY, from_me: false, sender: "Anu", ...extra });

test("the bridge is told which chats 📅 messages count in — again only when that changes", async () => {
  const { db, bridge, capture } = setup([]);
  await capture.poll();
  assert.deepEqual(bridge.told, [[FAMILY, "self"]]);
  await capture.poll();
  assert.equal(bridge.told.length, 1, "already so");
  db.settings.save({ captureChats: ["self"] });
  await capture.poll();
  assert.deepEqual(bridge.told.at(-1), ["self"]);
  db.settings.save({ capture: false });
  await capture.poll();
  assert.deepEqual(bridge.told.at(-1), [], "switched off: none");
  bridge.chats = null; // a bridge from before chosen chats: it is not asked
  await capture.poll();
  assert.equal(bridge.told.length, 3);
});

test("each 📅 message goes on the calendar once — with the reminder new events get — is answered where calendar messages go, and let go", async () => {
  const { db, bridge, capture } = setup([
    command("A", "Dentist Tue 10am"),
    inFamily("B", "", { quoted: "Choir moves to Sat 6pm" }),
    command("C", "Buy batteries"),
    command("D", "Trip 10-13 Oct"),
  ]);
  assert.equal(await capture.poll(), 4);
  const dentist = db.events.between("2026-10-13", "2026-10-13").find((e) => e.title === "Dentist");
  assert.deepEqual([dentist.time, dentist.remind, dentist.notes], ["10:00", 5, "From WhatsApp: Message yourself"]);
  const choir = db.events.between("2026-10-10", "2026-10-10").find((e) => e.title === "Choir moves");
  assert.match(choir.notes, /From WhatsApp: Family, Anu$/);
  assert.equal(db.events.between("2026-10-10", "2026-10-13").find((e) => e.title === "Trip").remind, null, "all day: no reminder minutes before");
  assert.equal(db.tasks.open()[0].title, "Buy batteries");
  assert.deepEqual(
    bridge.sent.map((s) => [s.key, s.chatId]),
    ["A", "B", "C", "D"].map((id) => [`capture:${id}`, SELF_JID]),
    "to where calendar messages go: the linked phone, unless changed",
  );
  assert.match(bridge.sent[1].text, /^✅ Added to the calendar: \*Choir moves\* \(from Anu\)\nSat 10 Oct, 18:00\nReminder 5 minutes before\./);
  assert.equal(db.deliveries.get("capture:A").title, "Dentist");
  assert.deepEqual(bridge.acked, ["A", "B", "C", "D"]);

  // Held again (the ack did not land): taken once all the same.
  bridge.held = [command("A", "Dentist Tue 10am")];
  assert.equal(await capture.poll(), 0);
  assert.equal(db.events.between("2026-10-13", "2026-10-13").filter((e) => e.title === "Dentist").length, 1);
  assert.equal(bridge.sent.length, 4);
});

test("answers go to the group calendar messages go to; a chat no longer chosen adds nothing", async () => {
  const { db, bridge, capture } = setup([inFamily("A", "Lunch Sat 1pm"), inFamily("B", "Dinner Sat 8pm", { chat_id: "120363000000000002@g.us" })], {
    calendarTo: FAMILY,
    defaultRemind: null,
  });
  assert.equal(await capture.poll(), 1);
  assert.deepEqual(bridge.sent.map((s) => [s.key, s.chatId]), [["capture:A", FAMILY]]);
  assert.equal(db.events.between("2026-10-10", "2026-10-10")[0].remind, null, "no reminder when Settings gives none");
  assert.deepEqual(bridge.acked, ["A", "B"], "both let go");
});

test("switched off, 📅 messages are let go and nothing is added; paused, they are still answered", async () => {
  const off = setup([command("A", "Dentist Tue 10am")], { capture: false });
  assert.equal(await off.capture.poll(), 0);
  assert.deepEqual([off.db.events.count(), off.bridge.sent.length, off.bridge.acked], [0, 0, ["A"]]);

  const paused = setup([command("A", "Dentist Tue 10am")], { enabled: false });
  assert.equal(await paused.capture.poll(), 1);
  assert.equal(paused.bridge.sent.length, 1, "it answers something someone just did");
});

test("a bridge without 📅 messages (or not there at all) is no error", async () => {
  const { capture, bridge } = setup([]);
  bridge.commands = async () => {
    throw Object.assign(new Error("no"), { code: "not_found" });
  };
  assert.equal(await capture.poll(), 0);
  assert.equal(await capture.poll(), 0);
});

test("with Claude, a group can have every message count: what is an event or a task is added, the rest let go quietly", async () => {
  const claude = fakeClaude({
    "Doctor tue 10 am": { kind: "event", title: "Doctor", day: "2026-10-13", endDay: null, time: "10:00", endTime: "" },
    "Thanks all!": { kind: "none" },
    "dinner at Ravi's next Friday after 8": { kind: "event", title: "Dinner at Ravi's", day: "2026-10-16", endDay: null, time: "20:00", endTime: "" },
  });
  const { db, bridge, capture } = setup(
    [
      inFamily("A", "Doctor tue 10 am", { marked: false }),
      inFamily("B", "Thanks all!", { marked: false }),
      command("C", "dinner at Ravi's next Friday after 8"),
    ],
    { captureChats: ["self"], captureEvery: [FAMILY], calendarTo: FAMILY },
    claude,
  );
  assert.equal(await capture.poll(), 2);
  assert.deepEqual(bridge.told.at(-1), [FAMILY, "self"]);
  assert.deepEqual(bridge.chatsEvery, [FAMILY], "the bridge is told which group has every message count");
  const doctor = db.events.between("2026-10-13", "2026-10-13")[0];
  assert.deepEqual([doctor.title, doctor.time, doctor.remind, doctor.notes], ["Doctor", "10:00", 5, "From WhatsApp: Family, Anu"]);
  assert.equal(db.events.between("2026-10-16", "2026-10-16")[0].title, "Dinner at Ravi's", "free-form, read by Claude");
  assert.deepEqual(bridge.sent.map((s) => [s.key, s.chatId]), [["capture:A", FAMILY], ["capture:C", FAMILY]], "no answer to chat");
  assert.deepEqual(bridge.acked, ["A", "B", "C"]);
});

test("when Claude cannot be had, a 📅 message is read by the rules; one without the 📅 waits for it — six hours at most", async () => {
  const claude = fakeClaude({ "Dentist Tue 10am": new ClaudeFailed("down", { retry: true }), "Doctor tue 10 am": new ClaudeFailed("down", { retry: true }) });
  const { db, bridge, capture, at } = setup([command("A", "Dentist Tue 10am"), inFamily("B", "Doctor tue 10 am", { marked: false })], { captureEvery: [FAMILY] }, claude);
  assert.equal(await capture.poll(), 1);
  assert.equal(db.events.between("2026-10-13", "2026-10-13")[0].title, "Dentist", "the rules read it");
  assert.deepEqual(bridge.acked, ["A"], "B stays with the bridge");
  assert.equal(claude.asked.length, 1, "after a failed call, Claude is left alone for a while");

  at("2026-10-08T05:03:00Z");
  claude.read = async () => ({ kind: "event", title: "Doctor", day: "2026-10-13", endDay: null, time: "10:00", endTime: "" });
  assert.equal(await capture.poll(), 1, "back: B is read");
  assert.deepEqual(bridge.acked, ["A", "B"]);

  const late = setup([inFamily("B", "Doctor tue 10 am", { marked: false })], { captureEvery: [FAMILY] }, fakeClaude({ "Doctor tue 10 am": new ClaudeFailed("down", { retry: true }) }));
  late.at("2026-10-08T10:31:00Z"); // six hours after it was sent
  assert.equal(await late.capture.poll(), 0);
  assert.deepEqual([late.bridge.acked, late.db.events.count()], [["B"], 0], "let go, unread");
});

test("a 📅 message is always added — the rules read it when Claude finds nothing in it", async () => {
  const { db, capture } = setup([command("A", "Buy batteries")], {}, fakeClaude({ "Buy batteries": { kind: "none" } }));
  assert.equal(await capture.poll(), 1);
  assert.equal(db.tasks.open()[0].title, "Buy batteries");
});

test("without Claude, no group has every message count", async () => {
  const { bridge, capture } = setup([], { captureChats: ["self"], captureEvery: [FAMILY] });
  await capture.poll();
  assert.deepEqual([bridge.told.at(-1), bridge.chatsEvery], [["self"], []]);
});

test("a call Claude refuses pauses it for an hour — no asking again every poll; an answer it cannot make sense of lets a message without the 📅 go", async () => {
  const claude = fakeClaude({ "Doctor tue 10 am": new ClaudeFailed("not scoped to a workspace", { refused: true }) });
  const { bridge, capture, at } = setup([inFamily("B", "Doctor tue 10 am", { marked: false })], { captureEvery: [FAMILY] }, claude);
  await capture.poll();
  await capture.poll();
  at("2026-10-08T05:50:00Z");
  await capture.poll();
  assert.deepEqual([claude.asked.length, bridge.acked], [1, []], "asked once in the hour; the message waits");

  const muddled = setup([inFamily("C", "🙂", { marked: false })], { captureEvery: [FAMILY] }, fakeClaude({ "🙂": new ClaudeFailed("not JSON") }));
  assert.equal(await muddled.capture.poll(), 0);
  assert.deepEqual([muddled.bridge.acked, muddled.bridge.sent], [["C"], []]);
});
