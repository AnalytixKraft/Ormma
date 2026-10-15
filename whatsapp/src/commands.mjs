/* The one kind of inbound message the bridge acts on: a "📅 message" — one
 * that starts with 📅 or 📆 (for the calendar) or 📝 (for the diary — or
 * the words "Note:", "Notes:" or "Journal:", which do the same), in a chat
 * the owner chose for them in the app's Settings → Calendar: a group they
 * ticked, where ANYONE in it may send one (the owner's choice: a
 * family's or a team's shared calendar), or the linked account's own chat
 * (Message yourself, "self"), where only it writes. The app turns each into
 * an event, a task, or a line on the day's journal page (`mark` says which
 * mark it had).
 *
 * A chosen group can also be one where EVERY message counts, mark or not —
 * the owner's choice, for a group kept for the calendar: then each message
 * with text in it is held, and the app has Claude read it and add what is
 * an event or a task (`marked` says whether it had the 📅).
 *
 * And in any chosen chat, the owner's own reply, mark or not, to a message
 * this bridge sent in the last day (`ours`, by WhatsApp's id; memory only)
 * — "delete" in reply to the morning reminder of a wish stops that wish, in
 * reply to "✅ Added …" takes that off the calendar. Held as `mark:
 * "reply"`: the app answers it as a reply to that message and does nothing
 * else with it.
 *
 * Which chats those are, the app says (POST /commands/chats); until it has,
 * after the bridge starts, there are none. A group not chosen is not even
 * decrypted (session.mjs, ignoresSender) — but for a quarter of an hour after
 * the bridge posts in it, so its members' phones can ask for a wish again;
 * then, as for everything else here, nothing is read.
 *
 * Everything that arrives is let go of as it arrives, unread beyond the
 * checks below and never kept, unless it is a 📅 message: every message in
 * a chat not chosen, and every message without the mark that is not such a
 * reply. At most PER_CHAT_HOUR are taken from one chat an hour, so a group
 * cannot flood the calendar — or the chat its answers go to.
 *
 * A 📅 message is held in memory, never on disk, until the app takes it
 * (GET /commands) and says it has it (POST /commands/ack): at most MAX_HELD
 * of them, for at most HOLD_MS. A bridge restart forgets them.
 *
 * Its text, and the text of the message it replies to — so a reply of just
 * 📅 to someone's "Choir moves to Sat 6pm" carries that line — goes to the
 * app and nowhere else: never into the log. So does the id of the message
 * it replies to: a reply of "delete" to the app's own "✅ Added …" takes
 * that event off the calendar.
 *
 * The bridge's own messages (the morning "🗓️ Your day", alerts…) never come
 * back here: the socket is made with emitOwnEvents off (session.mjs). And
 * neither 🗓️ nor anything the app sends starts with 📅 or 📆, should that
 * ever change. */

import { isJidGroup, jidNormalizedUser, normalizeMessageContent, toNumber } from "@whiskeysockets/baileys";

/* 📅 (calendar) or 📆 (tear-off calendar) for the calendar, 📝 (memo) for
 * the diary — with or without the emoji variation selector. Not 🗓️ (spiral
 * calendar): "Your day" starts with it; nor 📓, which the app's own answer
 * to a note starts with. For the diary, the words "Note:", "Notes:" or
 * "Journal:" (any case, the colon needed) do what the 📝 does — easier to
 * type than an emoji. */
export const MARK = /^\s*(?:([\u{1F4C5}\u{1F4C6}]|\u{1F4DD})\uFE0F?|(?:notes?|journal)\s*:)\s*/iu;
const markOf = (text) => (/[\u{1F4C5}\u{1F4C6}]/u.test(MARK.exec(text)?.[1] ?? "") ? "calendar" : "note");
/* Any such emoji, anywhere: a message meant as a marked one that is not,
 * said so in the log (never the message). */
const CALENDARS = /[\u{1F4C5}\u{1F4C6}\u{1F5D3}\u{1F4DD}]/u;

const MAX_TEXT = 2_000;
/* A 📅 message delivered later than this after it was sent (the bridge was
 * down for days) is not acted on: whatever it was about may be long past. */
const MAX_AGE_MS = 2 * 24 * 60 * 60_000;
export const MAX_HELD = 100;
export const HOLD_MS = 3 * 24 * 60 * 60_000;
export const PER_CHAT_HOUR = 30;

const clip = (text) => (text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text);
/* Who sent it, as they call themselves on WhatsApp — on one line, short. */
const nameOf = (name) => (typeof name === "string" ? name.replace(/[\p{Cc}\p{Cf}\s]+/gu, " ").trim().slice(0, 50) : "") || null;

/* The text a message carries — typed, or as a caption — or null. */
function textOf(message) {
  const m = normalizeMessageContent(message);
  if (!m) return null;
  const text = m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ?? m.documentMessage?.caption;
  return typeof text === "string" ? text : null;
}

function contextOf(message) {
  const m = normalizeMessageContent(message);
  return m?.extendedTextMessage?.contextInfo ?? m?.imageMessage?.contextInfo ?? m?.videoMessage?.contextInfo ?? null;
}

/* A chat as the app names it when choosing: "self", or the group's id. */
export const chatKey = (chat, chatId) => (chat === "self" ? "self" : chatId);

const NONE = { has: () => false };

/* A message as Baileys hands it over →
 *   {command}   a 📅 message, to hold for the app;
 *   {skipped}   a message in a chosen chat with a calendar emoji in it that
 *               is not one — why, in words, for the log;
 *   null        anything else.
 * `mine`: the linked account's own JIDs, normalised (its phone number and its
 * LID) — its own chat is either. `chats`: the chats chosen, as chatKey()
 * names them; `every`: the groups among them where every message counts;
 * `ours`: the ids of the messages this bridge sent lately (has(id)). */
export function readMessage(msg, mine, chats, every = new Set(), now = Date.now(), ours = NONE) {
  if (!msg?.key || !msg.message) return null;
  const chatId = msg.key.remoteJid ? jidNormalizedUser(msg.key.remoteJid) : "";
  const chat = isJidGroup(chatId) ? "group" : mine.has(chatId) ? "self" : null;
  if (!chat || !chats.has(chatKey(chat, chatId))) return null;
  const fromMe = msg.key.fromMe === true;
  if (chat === "self" && !fromMe) return null;
  const text = textOf(msg.message);
  if (text === null || !text.trim()) return null;
  const marked = MARK.test(text);
  const context = contextOf(msg.message);
  const quotedId = typeof context?.stanzaId === "string" && context.stanzaId ? context.stanzaId.slice(0, 128) : null;
  const reply = !marked && !every.has(chatId) && fromMe && quotedId !== null && ours.has(quotedId);
  if (!marked && !every.has(chatId) && !reply) {
    if (!CALENDARS.test(text)) return null;
    return { skipped: /^\s*\u{1F5D3}/u.test(text) ? "it starts with 🗓️, which is not 📅 or 📆" : "the 📅 or 📝 is not at the start" };
  }
  const sentAt = toNumber(msg.messageTimestamp) * 1000;
  if (!Number.isFinite(sentAt) || sentAt <= 0) return null;
  if (now - sentAt > MAX_AGE_MS) return { skipped: "it arrived more than 2 days after it was sent" };
  const quoted = context?.quotedMessage;
  const quotedText = quoted ? textOf(quoted) : null;
  return {
    command: {
      id: String(msg.key.id),
      chat,
      chat_id: chatId,
      sent_at: new Date(sentAt).toISOString(),
      text: clip(text.replace(MARK, "").trim()),
      quoted: quotedText?.trim() ? clip(quotedText.trim()) : null,
      quoted_id: quotedId,
      marked,
      mark: marked ? markOf(text) : reply ? "reply" : null,
      from_me: fromMe,
      sender: fromMe ? null : nameOf(msg.pushName),
    },
  };
}

/* The 📅 messages waiting for the app, oldest first. */
export class HeldCommands {
  #held = new Map(); // id → {command, until}
  #taken = new Map(); // chat id → when its messages were taken, this last hour

  #sweep(now) {
    for (const [id, { until }] of this.#held) if (until <= now) this.#held.delete(id);
  }

  /* → "held"; "again" when it was held already (WhatsApp can deliver a
   * message twice); "too_many" past PER_CHAT_HOUR from its chat. */
  add(command, now = Date.now()) {
    this.#sweep(now);
    if (this.#held.has(command.id)) return "again";
    const recent = (this.#taken.get(command.chat_id) ?? []).filter((at) => at > now - 60 * 60_000);
    if (recent.length >= PER_CHAT_HOUR) return "too_many";
    this.#taken.set(command.chat_id, [...recent, now]);
    this.#held.set(command.id, { command, until: now + HOLD_MS });
    while (this.#held.size > MAX_HELD) this.#held.delete(this.#held.keys().next().value);
    return "held";
  }

  list(now = Date.now()) {
    this.#sweep(now);
    return [...this.#held.values()].map(({ command }) => command);
  }

  /* The app has these: let them go. → how many were still held */
  ack(ids) {
    let n = 0;
    for (const id of ids) if (this.#held.delete(id)) n++;
    return n;
  }

  /* A chat no longer chosen: what came from it goes too. */
  keepOnly(chats) {
    for (const [id, { command }] of this.#held) if (!chats.has(chatKey(command.chat, command.chat_id))) this.#held.delete(id);
  }
}
