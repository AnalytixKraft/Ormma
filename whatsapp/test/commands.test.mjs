import assert from "node:assert/strict";
import { test } from "node:test";
import { HOLD_MS, HeldCommands, MAX_HELD, PER_CHAT_HOUR, readMessage } from "../src/commands.mjs";
import { ignoresSender } from "../src/session.mjs";

// Made-up JIDs: two groups, the linked account (its number — Ofcom's drama
// range — and its LID), and someone else.
const GROUP = "120363000000000001@g.us";
const OTHER_GROUP = "120363000000000002@g.us";
const ME = "447700900077@s.whatsapp.net";
const MY_LID = "123456789012345@lid";
const OTHER = "447700900001@s.whatsapp.net";
const mine = new Set([ME, MY_LID]);
const chosen = new Set(["self", GROUP]);
const NOW = Date.parse("2026-10-08T10:00:00Z");
const sent = (minutesAgo = 1) => Math.floor((NOW - minutesAgo * 60_000) / 1000);

const message = ({ fromMe = true, chat = GROUP, text = "📅 Dentist Tue 10am", at = sent(), id = "3EB0A1", name, content } = {}) => ({
  key: { id, fromMe, remoteJid: chat },
  messageTimestamp: at,
  pushName: name,
  message: content ?? { conversation: text },
});
const read = (fields, chats = chosen, every = new Set()) => readMessage(message(fields), mine, chats, every, NOW);
const command = (fields, chats) => read(fields, chats)?.command ?? null;

test("a 📅 message in a chosen group — from anyone in it — or in Message yourself is held for the app", () => {
  assert.deepEqual(command(), {
    id: "3EB0A1",
    chat: "group",
    chat_id: GROUP,
    sent_at: "2026-10-08T09:59:00.000Z",
    text: "Dentist Tue 10am",
    quoted: null,
    quoted_id: null,
    marked: true,
    mark: "calendar",
    from_me: true,
    sender: null,
  });
  const theirs = command({ fromMe: false, name: "Anu\n*Joseph*‮" });
  assert.deepEqual([theirs.from_me, theirs.sender], [false, "Anu *Joseph*"], "named as they call themselves, on one line");
  assert.equal(command({ chat: ME }).chat, "self");
  assert.equal(command({ chat: MY_LID }).chat, "self", "its own chat under its LID too");
  assert.equal(command({ chat: "447700900077:12@s.whatsapp.net" }).chat, "self", "from one of its devices");
  assert.equal(command({ text: "📆Pay rent Fri" }).text, "Pay rent Fri");
  assert.equal(command({ text: "  📅️  Lunch 1pm " }).text, "Lunch 1pm");
});

test("nothing is taken from a chat not chosen, nor without the mark", () => {
  assert.equal(read({ chat: OTHER_GROUP }), null, "a group not ticked");
  assert.equal(read({ chat: ME }, new Set([GROUP])), null, "Message yourself, not ticked");
  assert.equal(read({ chat: GROUP }, new Set()), null, "nothing chosen yet");
  assert.equal(read({ fromMe: false, chat: ME }), null, "only the account writes in its own chat");
  assert.equal(read({ chat: OTHER }), null, "a chat with someone");
  assert.equal(read({ fromMe: false, chat: OTHER }), null);
  assert.equal(read({ text: "Dentist on Tue 10am" }), null, "no mark: nothing, not even in the log");
  assert.equal(read({ chat: "status@broadcast" }), null);
  assert.equal(read({ content: { reactionMessage: { text: "📅" } } }), null);
  assert.equal(readMessage({ key: { fromMe: true, remoteJid: GROUP } }, mine, chosen, new Set(), NOW), null, "no content");
});

test("a calendar emoji that does not make a 📅 message is said so in the log, without the message", () => {
  assert.deepEqual(read({ text: "Dentist on Tue 📅" }), { skipped: "the 📅 or 📝 is not at the start" });
  assert.deepEqual(read({ text: "Coffee with Tom 📝" }), { skipped: "the 📅 or 📝 is not at the start" });
  assert.deepEqual(read({ text: "🗓️ Dentist Tue 10am" }), { skipped: "it starts with 🗓️, which is not 📅 or 📆" });
  assert.deepEqual(read({ at: sent(3 * 24 * 60) }), { skipped: "it arrived more than 2 days after it was sent" });
  assert.equal(read({ chat: OTHER_GROUP, text: "Dentist 📅" }), null, "nor anything from a chat not chosen");
});

test("in a group where every message counts, each one with text is held — marked or not — and no other", () => {
  const every = new Set([GROUP]);
  const plain = read({ fromMe: false, name: "Spare", text: "Doctor tue 10 am" }, chosen, every)?.command;
  assert.deepEqual([plain.text, plain.marked, plain.sender], ["Doctor tue 10 am", false, "Spare"]);
  assert.equal(read({ text: "📅 Lunch 1pm" }, chosen, every).command.marked, true);
  assert.equal(read({ text: "   " }, chosen, every), null, "no words");
  assert.equal(read({ content: { stickerMessage: {} } }, chosen, every), null, "no text");
  assert.equal(read({ chat: OTHER_GROUP, text: "Doctor tue 10 am" }, new Set(["self", OTHER_GROUP]), every), null, "only where every message counts");
  assert.equal(read({ chat: ME, text: "Doctor tue 10 am" }, chosen, every), null, "Message yourself still needs the 📅");
});

test("a 📝 message is held like a 📅 one, and says which mark it had", () => {
  const note = command({ text: "📝 Coffee with Tom, he’s doing well" });
  assert.deepEqual([note.mark, note.marked, note.text], ["note", true, "Coffee with Tom, he’s doing well"]);
  assert.deepEqual([command({ text: "📝️Lunch was good" }).mark, command({ text: "📆 Pay rent Fri" }).mark], ["note", "calendar"]);
  assert.equal(read({ chat: ME, text: "📝 to myself" }).command.chat, "self");
  const plain = read({ fromMe: false, text: "Doctor tue 10 am" }, chosen, new Set([GROUP])).command;
  assert.deepEqual([plain.marked, plain.mark], [false, null]);
});

test("“Note:”, “Notes:” or “Journal:” at the start does what the 📝 does — any case, the colon needed", () => {
  for (const text of ["Notes: Coffee with Tom", "note:Coffee with Tom", "  NOTES : Coffee with Tom", "Journal: Coffee with Tom"]) {
    const note = command({ text });
    assert.deepEqual([note.mark, note.marked, note.text], ["note", true, "Coffee with Tom"], text);
  }
  assert.equal(read({ chat: ME, text: "Notes: to myself" }).command.mark, "note", "in Message yourself too");
  assert.equal(command({ text: "Note:" }).text, "", "a reply of just “Note:” keeps the message it replies to");
  assert.equal(read({ text: "Notes from the meeting" }), null, "no colon: not a note");
  assert.equal(read({ text: "Footnote: page 3" }), null, "only at the start of the message");
  assert.equal(read({ text: "See notes: page 3" }), null);
  const plain = read({ fromMe: false, text: "Notebook: buy one" }, chosen, new Set([GROUP])).command;
  assert.deepEqual([plain.marked, plain.mark], [false, null], "where every message counts, other words stay unmarked");
});

test("a reply of 📅 carries the line it replies to; wrapped and captioned messages count", () => {
  const reply = command({
    content: {
      ephemeralMessage: {
        message: { extendedTextMessage: { text: "📅", contextInfo: { quotedMessage: { conversation: "Choir moves to Sat 6pm" } } } },
      },
    },
  });
  assert.deepEqual([reply.text, reply.quoted, reply.quoted_id], ["", "Choir moves to Sat 6pm", null]);
  const toTheApp = command({
    chat: GROUP,
    fromMe: false,
    content: { extendedTextMessage: { text: "📅 delete", contextInfo: { stanzaId: "3EB0ADDED", quotedMessage: { conversation: "✅ Added to the calendar: *Doc*" } } } },
  });
  assert.deepEqual([toTheApp.text, toTheApp.quoted_id], ["delete", "3EB0ADDED"], "which message it replies to, so the app can find it");
  assert.equal(command({ content: { imageMessage: { caption: "📅 Concert 12 Dec 7pm" } } }).text, "Concert 12 Dec 7pm");
  assert.equal(command({ text: `📅 ${"x".repeat(5000)}` }).text.length, 2000);
});

test("the owner's reply to a message the bridge sent is held, mark or not — anyone else's, or a reply to something else, is not", () => {
  const ours = new Set(["3EB0NOTE"]);
  const reply = (fields = {}, quotedId = "3EB0NOTE", text = "delete") =>
    readMessage(
      message({ chat: ME, content: { extendedTextMessage: { text, contextInfo: { stanzaId: quotedId, quotedMessage: { conversation: "🎉 *Today's wish* · Thu 8 Oct" } } } }, ...fields }),
      mine,
      chosen,
      new Set(),
      NOW,
      ours,
    );
  const held = reply().command;
  assert.deepEqual([held.chat, held.text, held.quoted_id, held.marked, held.mark], ["self", "delete", "3EB0NOTE", false, "reply"]);
  assert.equal(reply({ chat: GROUP }).command.mark, "reply", "the owner's, in a chosen group");
  assert.equal(reply({ chat: GROUP, fromMe: false }), null, "not someone else's");
  assert.equal(reply({}, "3EB0OTHER"), null, "not a reply to another message");
  assert.equal(reply({ chat: OTHER_GROUP }), null, "not in a chat not chosen");
  assert.equal(readMessage(message({ chat: ME, text: "delete" }), mine, chosen, new Set(), NOW, ours), null, "not without a reply");
  assert.equal(reply({}, "3EB0NOTE", "📅 delete").command.mark, "calendar", "marked, it is what its mark says");
  assert.equal(
    readMessage(message({ chat: ME, content: { extendedTextMessage: { text: "delete", contextInfo: { stanzaId: "3EB0NOTE" } } } }), mine, chosen, new Set(), NOW),
    null,
    "the bridge's own messages unknown (restarted): not held",
  );
});

test("held until the app takes them: each once, thirty an hour a chat, a hundred at most, for three days", () => {
  const held = new HeldCommands();
  const c = (id, chat = GROUP) => ({ id, chat: "group", chat_id: chat, sent_at: "", text: id, quoted: null });
  assert.equal(held.add(c("a"), NOW), "held");
  assert.equal(held.add(c("a"), NOW), "again", "delivered twice, held once");
  held.add(c("b"), NOW);
  assert.deepEqual(held.list(NOW).map((x) => x.id), ["a", "b"]);
  assert.equal(held.ack(["a", "zzz"]), 1);
  assert.deepEqual(held.list(NOW).map((x) => x.id), ["b"]);
  assert.deepEqual(held.list(NOW + HOLD_MS), [], "let go after three days");

  const busy = new HeldCommands();
  for (let i = 0; i < PER_CHAT_HOUR; i++) assert.equal(busy.add(c(`g${i}`), NOW), "held");
  assert.equal(busy.add(c("one-too-many"), NOW), "too_many");
  assert.equal(busy.add(c("elsewhere", OTHER_GROUP), NOW), "held", "another chat has its own thirty");
  assert.equal(busy.add(c("next-hour"), NOW + 60 * 60_000 + 1), "held");

  const full = new HeldCommands();
  for (let i = 0; i < MAX_HELD + 5; i++) full.add(c(`n${i}`, `1203630000000${i}@g.us`), NOW);
  assert.equal(full.list(NOW).length, MAX_HELD);
  assert.equal(full.list(NOW)[0].id, "n5", "the oldest go first");

  full.keepOnly(new Set(["120363000000099@g.us"]));
  assert.deepEqual(full.list(NOW).map((x) => x.id), ["n99"], "a chat no longer chosen: what it sent goes");
});

test("what reaches the bridge at all: chosen groups, groups and people just written to, and itself", () => {
  const me = { id: "447700900077:4@s.whatsapp.net", lid: "123456789012345:4@lid" };
  const groups = new Set([GROUP]);
  const peers = new Set(["447700900001@s.whatsapp.net"]);
  const ignored = (jid) => ignoresSender(jid, me, { groups, peers });
  assert.equal(ignored(GROUP), false, "a chosen group, or one just posted in");
  assert.equal(ignored(OTHER_GROUP), true, "every other group: dropped undecrypted");
  assert.equal(ignored("447700900001@s.whatsapp.net"), false, "someone just written to");
  assert.equal(ignored("447700900002@s.whatsapp.net"), true, "a stranger");
  assert.equal(ignored("447700900077@s.whatsapp.net"), false, "itself");
  assert.equal(ignored("123456789012345:9@lid"), false, "itself, by its LID");
  assert.equal(ignored("447700900077@lid"), true, "the same digits as a LID are someone else");
  assert.equal(ignored("status@broadcast"), true);
  assert.equal(ignoresSender(GROUP, me), true, "with nothing chosen or written to, no group");
});
