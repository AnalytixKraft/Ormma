/* 📅 messages: what is sent on WhatsApp to put on the calendar. The bridge
 * holds each message that starts with 📅 or 📆 in a chat chosen in Settings
 * → Calendar — a group, where anyone in it may send one, or Message yourself
 * (whatsapp/src/commands.mjs). This tells the bridge which chats those are,
 * takes the messages, turns each into an event or a task by simple rules,
 * and answers where calendar messages go.
 *
 *   📅 Dentist Tue 10am              an event, the coming Tuesday at 10:00
 *   📅 Trip to Munnar 10-13 Oct      an event, 10 to 13 October, all day
 *   📅 Call Mum 6:30pm               an event, that day at 18:30 (the next,
 *                                    when 18:30 had passed)
 *   📅 task Pay rent by Fri          a task, due Friday
 *   📅 Buy batteries                 a task: no day, no time
 *   a reply of 📅 to "Choir moves to Sat 6pm"
 *                                    an event "Choir moves", Saturday 18:00
 *   a reply of "delete" to "✅ Added to the calendar: *Doc* …"
 *                                    Doc taken off the calendar again
 *   remind me to call Renjith        a reminder: at the morning time
 *                                    (07:00 unless changed), the next morning
 *   📝 Coffee with Tom, he's well    a line on the day's journal page, with
 *                                    the time it was sent — the next one
 *                                    goes below it: the day's notes, merged
 *   Notes: Coffee with Tom           the same ("Note:", "Journal:" too: the
 *                                    bridge marks it as it does the 📝)
 *   show notes for yesterday         that page, read back (last week, this
 *                                    month, Monday, 5 Oct: those pages)
 *   delete all calendar for this week
 *                                    asked about first; done on a “yes”
 *
 * Days and times are read from the day the message was sent, in the app's
 * time zone — not the moment it is read, which can be hours later when this
 * computer was asleep. A timed event gets the reminder Settings gives new
 * events (5 minutes before, unless changed). The answer goes through the
 * scheduler (sendCalendarReply).
 *
 * Each message is taken once (db.captures, by WhatsApp's id), then the
 * bridge is told to let it go. Switched off in Settings, they are let go
 * unread. */

import { readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DAY_MINUTES, MAX_TITLE, REMINDER_DAYS, occurrencesBetween, reminderLabel, repeatLabel, shiftDay, timeRange } from "./calendar.mjs";
import { MONTHS, daysInMonth, formatShortDate, fromIsoDate, isoDate, parseTime, weekdayOf, zonedNow } from "./dates.mjs";

const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const MONTH_NUMBER = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const WEEKDAY = "(sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)";
const WEEKDAY_NUMBER = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
const ORD = "(?:st|nd|rd|th)?";
/* Words before a day that belong to it, and go with it from the title. */
const LEAD = "((?:(?:on|from|by|due|this|next|coming)\\s+)*)";
const TO = "\\s*(?:-|–|—|to|till|until)\\s*";
const MERIDIEM = "(am|pm|a\\.m\\.|p\\.m\\.)";

const monthOf = (name) => MONTH_NUMBER[name.slice(0, 3).toLowerCase()];
const pad = (n) => String(n).padStart(2, "0");

/* A day and month, of `year` if given — else the next time it comes, from
 * `today` on (29 February: the next leap year). Null when there is no such
 * day. */
function dayOf(day, month, year, today) {
  const fits = (y) => month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(y, month);
  if (year) {
    const y = Number(year) < 100 ? Number(year) + 2000 : Number(year);
    return fits(y) ? isoDate({ year: y, month, day }) : null;
  }
  for (let y = today.year; y <= today.year + 8; y++) {
    if (fits(y) && isoDate({ year: y, month, day }) >= isoDate(today)) return isoDate({ year: y, month, day });
  }
  return null;
}

/* The ways a day can be written, most particular first. Each → {day,
 * endDay} or null. */
const DAYS = [
  // 30 Dec - 2 Jan, 28 Oct to 3 November 2026
  [new RegExp(`\\b${LEAD}(\\d{1,2})${ORD}\\s+${MONTH}(?:\\s+(\\d{4}))?${TO}(\\d{1,2})${ORD}\\s+${MONTH}(?:,?\\s+(\\d{4}))?\\b`, "i"), (m, today) => {
    const start = dayOf(Number(m[2]), monthOf(m[3]), m[4], today);
    const end = start && dayOf(Number(m[5]), monthOf(m[6]), m[7], fromIsoDate(start));
    return start && end && end > start ? { day: start, endDay: end } : null;
  }],
  // 10-13 Oct, 10th to 13th October
  [new RegExp(`\\b${LEAD}(\\d{1,2})${ORD}${TO}(\\d{1,2})${ORD}\\s+${MONTH}(?:,?\\s+(\\d{4}))?\\b`, "i"), (m, today) => {
    const start = dayOf(Number(m[2]), monthOf(m[4]), m[5], today);
    const end = start && dayOf(Number(m[3]), monthOf(m[4]), m[5] ?? start.slice(0, 4), today);
    return start && end && end > start ? { day: start, endDay: end } : null;
  }],
  // 2026-10-15
  [/\b((?:(?:on|from|by|due)\s+)*)(\d{4})-(\d{1,2})-(\d{1,2})\b/i, (m, today) => ({ day: dayOf(Number(m[4]), Number(m[3]), m[2], today) })],
  // 15 Oct, 15th of October 2026
  [new RegExp(`\\b${LEAD}(\\d{1,2})${ORD}(?:\\s+of)?\\s+${MONTH}(?:,?\\s+(\\d{4}))?\\b`, "i"), (m, today) => ({ day: dayOf(Number(m[2]), monthOf(m[3]), m[4], today) })],
  // Oct 15, October 15th 2026
  [new RegExp(`\\b${LEAD}${MONTH}\\s+(\\d{1,2})${ORD}(?:,?\\s+(\\d{4}))?\\b`, "i"), (m, today) => ({ day: dayOf(Number(m[3]), monthOf(m[2]), m[4], today) })],
  // 15/10, 15/10/2026, 15-10-2026, 15.10.26 — the day first
  [/\b((?:(?:on|from|by|due)\s+)*)(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?\b|\b((?:(?:on|from|by|due)\s+)*)(\d{1,2})[-.](\d{1,2})[-.](\d{2}|\d{4})\b/i, (m, today) =>
    m[2] ? { day: dayOf(Number(m[2]), Number(m[3]), m[4], today), lead: m[1] } : { day: dayOf(Number(m[6]), Number(m[7]), m[8], today), lead: m[5] }],
  // today, tonight, tomorrow, day after tomorrow
  [/\b((?:(?:by|due)\s+)*)(day after tomorrow|today|tonight|tomorrow|tmrw|tmw)\b/i, (m, today) => ({
    day: shiftDay(isoDate(today), { today: 0, tonight: 0, tomorrow: 1, tmrw: 1, tmw: 1, "day after tomorrow": 2 }[m[2].toLowerCase()]),
  })],
  // Tue, next Friday — the coming one: today, if it is that day, unless "next"
  [new RegExp(`\\b${LEAD}${WEEKDAY}\\b`, "i"), (m, today) => {
    const ahead = (WEEKDAY_NUMBER[m[2].slice(0, 3).toLowerCase()] - weekdayOf(today) + 7) % 7;
    return { day: shiftDay(isoDate(today), ahead === 0 && /\bnext\b/i.test(m[1]) ? 7 : ahead) };
  }],
];

/* "6pm", "6:30 pm", "18:30" → 'HH:MM'; null when it is no time. */
function clock(h, m, meridiem) {
  let hour = Number(h);
  const minute = Number(m ?? 0);
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = meridiem.toLowerCase().startsWith("p");
    if (pm && hour !== 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
  }
  return hour <= 23 && minute <= 59 ? `${pad(hour)}:${pad(minute)}` : null;
}

const AT = "((?:(?:at|from|@)\\s*)?)";
const TIMES = [
  // 6-8pm, 10:30am to 12pm, 11-1pm (11am to 1pm)
  [new RegExp(`\\b${AT}(\\d{1,2})(?:[:.](\\d{2}))?\\s*${MERIDIEM}?${TO}(\\d{1,2})(?:[:.](\\d{2}))?\\s*${MERIDIEM}(?!\\w)`, "i"), (m) => {
    const end = clock(m[5], m[6], m[7]);
    let start = clock(m[2], m[3], m[4] ?? m[7]);
    if (!m[4] && start && end && start >= end) start = clock(m[2], m[3], "am");
    return start && end && end > start ? { time: start, endTime: end } : null;
  }],
  // 10:00-10:45, 18:30 to 20:00
  [/\b((?:(?:at|from|@)\s*)?)([01]?\d|2[0-3]):([0-5]\d)\s*(?:-|–|—|to|till|until)\s*([01]?\d|2[0-3]):([0-5]\d)\b/i, (m) => {
    const start = clock(m[2], m[3]);
    const end = clock(m[4], m[5]);
    return end > start ? { time: start, endTime: end } : null;
  }],
  // 6pm, 6.30 pm, 10am
  [new RegExp(`\\b${AT}(\\d{1,2})(?:[:.](\\d{2}))?\\s*${MERIDIEM}(?!\\w)`, "i"), (m) => ({ time: clock(m[2], m[3], m[4]) })],
  // 18:30
  [/\b((?:(?:at|from|@)\s*)?)([01]?\d|2[0-3]):([0-5]\d)\b/i, (m) => ({ time: clock(m[2], m[3]) })],
  // noon
  [/\b((?:(?:at|from|@)\s*)?)(noon|midday)\b/i, () => ({ time: "12:00" })],
];

/* The first way of writing `ways` that matches, and the text without it. */
function find(text, ways, today) {
  for (const [pattern, read] of ways) {
    const m = pattern.exec(text);
    if (!m) continue;
    const found = read(m, today);
    if (!found || Object.values(found).some((v) => v === null)) continue;
    const lead = found.lead ?? m[1] ?? "";
    return { found, lead, rest: `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}` };
  }
  return { found: null, lead: "", rest: text };
}

const EDGE_WORDS = "on|at|from|by|due|to|for|this|next|coming|and|till|until";
const LEADING = new RegExp(`^(?:(?:${EDGE_WORDS})\\b|[-–—:,;@.])\\s*`, "i");
const TRAILING = new RegExp(`\\s*(?:\\b(?:${EDGE_WORDS})|[-–—:,;@.])$`, "i");

/* What is left once the day and time are out: the title, without the
 * little words that went with them. */
function tidy(text) {
  let t = text.replace(/\s+/g, " ").trim();
  for (let before = ""; before !== t; ) {
    before = t;
    t = t.replace(LEADING, "").replace(TRAILING, "").trim();
  }
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1).trimEnd()}…` : t;
}

/* A day and a time out of some text, and the text that is left. */
function scan(text, today) {
  const day = find(text, DAYS, today);
  const time = find(day.rest, TIMES, today);
  return { ...day.found, ...time.found, by: /\b(?:by|due)\b/i.test(day.lead), rest: time.rest };
}

const TASK = /^(?:task|todo|to-do|to do)\b[\s:–-]*/i;

/* What an item from WhatsApp keeps in its notes: the message it replied
 * to, and where it came from — and from whom, in a group. */
export const notesFor = ({ quoted, sender }, where) =>
  [quoted, `From WhatsApp: ${where ?? "Message yourself"}${sender ? `, ${sender}` : ""}`].filter(Boolean).join("\n\n");

/* A 📅 message → what it puts on the calendar:
 *   {kind: 'event', title, day, endDay, time, endTime, notes, why}
 *   {kind: 'task', title, due, notes, why}
 * `where`: the group's name, or null for Message yourself. */
export function readCapture({ text, quoted, sent_at: sentAt, sender = null }, { timeZone, where = null }) {
  const now = zonedNow(new Date(sentAt), timeZone);
  const today = { year: now.year, month: now.month, day: now.day };
  const asTask = TASK.test(text);
  const own = scan(text.replace(TASK, ""), today);
  const theirs = quoted ? scan(quoted, today) : null;
  const firstLine = (s) => s.split("\n").map((line) => line.trim()).find(Boolean) ?? "";

  const day = own.day ? own : theirs?.day ? theirs : null;
  const time = own.time ? own : theirs?.time ? theirs : null;
  const title = tidy(own.rest) || (theirs ? tidy(firstLine(theirs.rest)) || tidy(firstLine(quoted)) : "") || "Untitled";
  const notes = notesFor({ quoted, sender }, where);

  if (asTask || (day && !time && (own.by || (!own.day && theirs?.by))) || (!day && !time)) {
    return {
      kind: "task",
      title,
      due: day?.day ?? null,
      notes,
      sender,
      why: asTask || day ? null : "There was no day or time in it, so it is a task.",
    };
  }
  let on = day?.day ?? isoDate(today);
  // A time and no day: that day, or the next when the time had passed.
  if (!day && time.time <= `${pad(now.hour)}:${pad(now.minute)}`) on = shiftDay(on, 1);
  return { kind: "event", title, day: on, endDay: day?.endDay ?? null, time: time?.time ?? "", endTime: time?.endTime ?? "", notes, sender, why: null };
}

/* The answer, where calendar messages go: what was added, and when — and
 * from whom, when someone in a group sent it. Never starts with 📅 or 📆,
 * so it can never be taken for one. */
export function renderCaptureReply(item) {
  const short = (day) => formatShortDate(fromIsoDate(day));
  const by = item.sender ? ` (from ${item.sender})` : "";
  if (item.reminder) {
    const daily = shiftDay(item.day, REMINDER_DAYS[2]);
    const last = shiftDay(item.day, REMINDER_DAYS.at(-1));
    return [
      `⏰ Reminder set: *${item.title}*${by}`,
      `${short(item.day)}, ${item.time} — then every day to ${short(daily)}, and every other day to ${short(last)}.`,
      "",
      "Reply “done” to any of them to stop it, or “delete” to this.",
    ].join("\n");
  }
  if (item.kind === "event") {
    const days = item.endDay ? `${short(item.day)} – ${short(item.endDay)}` : short(item.day);
    const when = `${days}, ${timeRange(item) || "all day"}`;
    const reminder = item.remind === null || item.remind === undefined ? [] : [`Reminder ${reminderLabel(item.remind).toLowerCase()}.`];
    return [`✅ Added to the calendar: *${item.title}*${by}`, when, ...reminder, "", "Not right? Change it in Ormma → Calendar."].join("\n");
  }
  return [
    `✅ Added a task: *${item.title}*${item.due ? ` — due ${short(item.due)}` : ""}${by}`,
    ...(item.why ? [item.why] : []),
    "",
    "Not right? Change it in Ormma → Calendar.",
  ].join("\n");
}

/* A reply that asks to take something off the calendar again. */
const DELETE = /^\s*(?:please\s+)?(?:delete|remove|cancel|del)\b|^\s*(?:\u274C|\u2716|\u{1F5D1})/iu;
export const isDelete = (text) => DELETE.test(text);
/* A reply that says a reminder's work is done. */
const DONE = /^\s*(?:done|did it|completed?|finished|called|paid|stop)\b|^\s*(?:\u2705|\u2714|\u{1F44D})/iu;
export const isDone = (text) => DONE.test(text);

/* What was deleted, in the answer: an event by its day and time. */
function deletedLine(kind, item) {
  if (kind === "task") return `🗑️ Deleted the task: *${item.title}*`;
  const short = (day) => formatShortDate(fromIsoDate(day));
  const days = item.endDay ? `${short(item.day)} – ${short(item.endDay)}` : short(item.day);
  return `🗑️ Deleted: *${item.title}* — ${days}, ${timeRange(item) || "all day"}`;
}

/* "delete all calendar for this week", "clear this month", "delete all":
 * which days, and what — events, tasks, or both. Only messages made of
 * these words, so "delete the doc one" or "delete all photos" is not one;
 * and a range or "all" is needed, so "delete" alone never is. → {range,
 * kinds} or null. */
const BULK_WORDS = /\b(?:all|everything|entire|whole|the|my|of|for|in|on|from|calendar|events?|schedules?|entries|appointments?|reminders?|tasks?|todos?|today|tomorrow|this|next|week|month)\b/g;
export function readBulkDelete(text) {
  const t = text.toLowerCase().replace(/['’]s\b/g, "").replace(/[.!]+$/, "").replace(/\s+/g, " ").trim();
  const m = /^(?:please )?(?:delete|remove|clear|wipe|cancel)\b(.*)$/.exec(t);
  if (!m || m[1].replace(BULK_WORDS, "").trim()) return null;
  const range = /\b(today|tomorrow|this week|next week|this month|next month)\b/.exec(m[1])?.[1] ?? null;
  if (!range && !/\b(?:all|everything|entire|whole)\b/.test(m[1])) return null;
  const tasks = /\b(?:tasks?|todos?)\b/.test(m[1]);
  const events = /\b(?:calendar|events?|schedules?|entries|appointments?|reminders?)\b/.test(m[1]);
  return { range: range ?? "all", kinds: tasks && !events ? "tasks" : events && !tasks && !/\bcalendar\b/.test(m[1]) ? "events" : "both" };
}

/* The days a range covers, seen from `day` ('YYYY-MM-DD'), and how to say
 * it: {from, to, label}; null for "all". Weeks run Sunday to Saturday, as
 * the calendar shows them. */
export function rangeOf(range, day) {
  const short = (d) => formatShortDate(fromIsoDate(d));
  const week = (start, name) => ({ from: start, to: shiftDay(start, 6), label: `${name} (${short(start)} – ${short(shiftDay(start, 6))})` });
  const month = (year, m, name) => {
    const from = isoDate({ year, month: m, day: 1 });
    return { from, to: isoDate({ year, month: m, day: daysInMonth(year, m) }), label: `${name} (${MONTHS[m - 1]} ${year})` };
  };
  const { year, month: m } = fromIsoDate(day);
  const sunday = shiftDay(day, -weekdayOf(fromIsoDate(day)));
  switch (range) {
    case "today":
      return { from: day, to: day, label: `today (${short(day)})` };
    case "tomorrow":
      return { from: shiftDay(day, 1), to: shiftDay(day, 1), label: `tomorrow (${short(shiftDay(day, 1))})` };
    case "this week":
      return week(sunday, "this week");
    case "next week":
      return week(shiftDay(sunday, 7), "next week");
    case "this month":
      return month(year, m, "this month");
    case "next month":
      return m === 12 ? month(year + 1, 1, "next month") : month(year, m + 1, "next month");
    default:
      return null;
  }
}

/* "remind me to call Renjith", "remind me at 5pm to call Renjith": a
 * reminder. → what it is about, the rest of the message; null when the
 * message is not one. */
export function readReminder(text) {
  const m = /^\s*(?:please\s+)?(?:set\s+a\s+)?remind(?:er)?(?:\s+me)?\b[\s,:]*(?:to\s+|about\s+|that\s+)?(.*)$/is.exec(text);
  return m && m[1].trim() ? m[1].trim() : null;
}

/* "note: …", "diary …", "journal: …": a line for the day's page said in
 * words rather than with the 📝 — in a group where every message counts.
 * → the line, or null. */
export function readNotePrefix(text) {
  const m = /^\s*(?:note|notes|diary|journal|memo)\b[\s:–—-]*(.*)$/is.exec(text);
  return m && m[1].trim() ? m[1].trim() : null;
}

const shortDay = (day) => formatShortDate(fromIsoDate(day));

/* Which days "yesterday", "last week", "Monday" or "5 Oct" were, seen from
 * `today` ('YYYY-MM-DD') — the pages to read back. A day or a month without
 * a year is the last time it came; a weekday, the last one, today included
 * ("last Monday": the one before today). → {from, to, label}, or null. */
export function pastRange(text, today) {
  const t = text
    .toLowerCase()
    .replace(/['’]s\b/g, "")
    .replace(/^(?:for|from|of|on|about|the)\s+/, "")
    .replace(/[.!?]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  const one = (day, name = null) => ({ from: day, to: day, label: name ? `${shortDay(day)}, ${name}` : shortDay(day) });
  const span = (from, to, name) => ({ from, to, label: `${name} (${shortDay(from)} – ${shortDay(to)})` });
  const sunday = shiftDay(today, -weekdayOf(fromIsoDate(today)));
  const { year, month } = fromIsoDate(today);
  const monthSpan = (y, m, name) => ({ from: isoDate({ year: y, month: m, day: 1 }), to: isoDate({ year: y, month: m, day: daysInMonth(y, m) }), label: `${name} (${MONTHS[m - 1]} ${y})` });
  if (t === "" || t === "today" || t === "tonight") return one(today, "today");
  if (t === "yesterday") return one(shiftDay(today, -1), "yesterday");
  if (t === "day before yesterday") return one(shiftDay(today, -2), "the day before yesterday");
  if (t === "this week") return span(sunday, today, "this week");
  if (t === "last week") return span(shiftDay(sunday, -7), shiftDay(sunday, -1), "last week");
  if (t === "past week" || t === "last 7 days" || t === "past 7 days") return span(shiftDay(today, -6), today, "the last 7 days");
  let m = /^(?:last|past) (\d{1,2}) days$/.exec(t);
  if (m && Number(m[1]) >= 2) return span(shiftDay(today, 1 - Number(m[1])), today, `the last ${m[1]} days`);
  if (t === "this month") return { ...monthSpan(year, month, "this month"), to: today };
  if (t === "last month") return month === 1 ? monthSpan(year - 1, 12, "last month") : monthSpan(year, month - 1, "last month");
  m = new RegExp(`^(?:(last|this) )?${WEEKDAY}$`).exec(t);
  if (m) {
    let back = (weekdayOf(fromIsoDate(today)) - WEEKDAY_NUMBER[m[2].slice(0, 3)] + 7) % 7;
    if (m[1] === "last" && back === 0) back = 7;
    return one(shiftDay(today, -back));
  }
  // A day: the last time it came, so without a year one still to come this
  // year is last year's.
  const past = (d, mo, y) => {
    const fits = (yy) => mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(yy, mo);
    if (y) {
      const yy = y < 100 ? y + 2000 : y;
      return fits(yy) ? one(isoDate({ year: yy, month: mo, day: d })) : null;
    }
    for (let yy = year; yy >= year - 8; yy--) {
      if (fits(yy) && isoDate({ year: yy, month: mo, day: d }) <= today) return one(isoDate({ year: yy, month: mo, day: d }));
    }
    return null;
  };
  m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${MONTH}(?: (\\d{4}))?$`).exec(t);
  if (m) return past(Number(m[1]), monthOf(m[2]), m[3] && Number(m[3]));
  m = new RegExp(`^${MONTH} (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{4}))?$`).exec(t);
  if (m) return past(Number(m[2]), monthOf(m[1]), m[3] && Number(m[3]));
  m = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(t);
  if (m) return past(Number(m[1]), Number(m[2]), m[3] && Number(m[3]));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return past(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

/* "show notes for yesterday", "read last week's journal", "what did I write
 * on Monday", "today's page": a request to read pages back. → {range} —
 * the days, from pastRange() — or {range: null, period} when the words say
 * when but that could not be read; null when it is no such request. */
export function readShowNotes(text, today) {
  const t = text.replace(/\s+/g, " ").trim();
  const PAGE = "(?:notes?|journal|diary|pages?|entries|entry)";
  const forms = [
    new RegExp(`^(?:please )?(?:show|read|list|open|see|display|get|pull up)(?: me)?(?: (?:my|the))?(?: (.+?))? ${PAGE}\\b(?: (?:for|from|of|on|about))?(?: (.*))?$`, "i"),
    new RegExp(`^(?:please )?what(?:'s|’s| is| are) (?:in|on) (?:my |the )?(?:(.+?) )?${PAGE}\\b(?: (?:for|from|of|on|about))?(?: (.*))?$`, "i"),
    new RegExp(`^(?:please )?what did i (?:write|note|say|put)(?: (?:in|on) (?:my |the )?${PAGE})?(?: (?:for|from|on|about))?(?: (.*))?()$`, "i"),
    new RegExp(`^(?:my |the )?(.+?)(?:'s|’s) ${PAGE}()$`, "i"),
  ];
  for (const form of forms) {
    const m = form.exec(t);
    if (!m) continue;
    const period = [m[1], m[2]].filter(Boolean).join(" ").trim();
    const range = pastRange(period, today);
    if (range) return { range };
    // "Read pages 10-20 of the report" is a task: only a diary word with no
    // readable days in the rest is asked about.
    return /\b(?:notes?|journal|diary)\b/i.test(t) ? { range: null, period } : null;
  }
  return null;
}

/* How long an answer with pages in it may be: WhatsApp takes far more,
 * but a page on a phone is read in the app. */
const MAX_SHOW = 3_500;
function clipMessage(text) {
  if (text.length <= MAX_SHOW) return text;
  const cut = text.lastIndexOf("\n", MAX_SHOW);
  return `${text.slice(0, cut > MAX_SHOW / 2 ? cut : MAX_SHOW).trimEnd()}\n\n… shortened — the rest is in Ormma → Notes → Journal.`;
}

/* The reminder a new event gets, as Settings says — when it can have it: an
 * all-day event only one a day or more ahead. */
export function reminderFor(event, minutes) {
  if (minutes === null || minutes === undefined) return null;
  return event.time || minutes >= DAY_MINUTES ? minutes : null;
}

export const POLL_MS = 15_000;
const KEEP_DAYS = 31;
/* "delete all …" waits this long for its "yes". */
const CONFIRM_MS = 10 * 60_000;
const YES = /^\s*(?:yes|y|yeah|yep|ok|okay|sure|confirm|do it|go ahead)\b|^\s*(?:\u{1F44D}|\u2705|\u2714)/iu;
/* Copies of the database kept before "delete all …": the latest few. */
const KEEP_COPIES = 10;
const counted = (events, tasks) =>
  [events ? `${events} ${events === 1 ? "event" : "events"}` : "", tasks ? `${tasks} ${tasks === 1 ? "task" : "tasks"}` : ""].filter(Boolean).join(" and ");
/* A message with no 📅, in a group where every message counts, waits for
 * Claude while it cannot be reached — this long, then it is let go. */
const WAIT_FOR_CLAUDE_MS = 6 * 60 * 60_000;
/* After a failed call, Claude is not asked again for this long: a busy or
 * unreachable API, or a refused key (an hour — someone has to fix it). */
const CLAUDE_PAUSE_MS = { retry: 2 * 60_000, refused: 60 * 60_000 };
const LATER = Symbol("later");

/* `claude`: claude.mjs's reader, when there is an API key; else null, and
 * 📅 messages are read by the rules above, and no group can have every
 * message count. */
export function createCapture({ db, bridge, scheduler, log, claude = null, dataDir = null, clock = () => new Date() }) {
  let busy = false;
  let timer = null;
  let lastProblem = null;
  let claudeAfter = 0;

  /* Where a 📅 message was sent, by name: a group as WhatsApp last listed
   * it, or null for Message yourself. */
  const whereOf = (command) => (command.chat === "group" ? db.chats.names().get(command.chat_id) || "a group" : null);

  /* The chats messages count in now (none while switched off), and the
   * groups where every message does (only with Claude to read them). */
  const chosen = (settings) => (settings.capture ? [...new Set([...settings.captureChats, ...everyOf(settings)])].sort() : []);
  const everyOf = (settings) => (settings.capture && claude ? [...new Set(settings.captureEvery)].sort() : []);
  const keyOf = (command) => (command.chat === "self" ? "self" : command.chat_id);

  /* Claude's reading of a message: {reading}; {later} when Claude cannot
   * be had now (none, paused, or the call failed); {unusable} when it
   * answered, but not with something to use. */
  async function askClaude(command, settings) {
    if (!claude || clock().getTime() < claudeAfter) return { later: true };
    try {
      return { reading: await claude.read(command, { timeZone: settings.timezone }) };
    } catch (err) {
      if (err.refused) {
        claudeAfter = clock().getTime() + CLAUDE_PAUSE_MS.refused;
        log.error({ err: err.message }, "📅 messages: Claude could not be used; trying again in an hour");
        return { later: true };
      }
      if (err.retry) {
        claudeAfter = clock().getTime() + CLAUDE_PAUSE_MS.retry;
        log.warn({ err: err.message }, "📅 messages: Claude did not answer; asking again in a while");
        return { later: true };
      }
      log.warn({ message_id: command.id, err: err.message }, "📅 messages: Claude's reading would not do");
      return { unusable: true };
    }
  }

  /* The day a message was sent, and its minute of that day, in the app's
   * time zone. */
  function sentOn(command, settings) {
    const t = zonedNow(new Date(command.sent_at), settings.timezone);
    return { day: isoDate(t), minute: t.hour * 60 + t.minute };
  }

  /* "delete all …": counted, and asked about. Only where the owner alone
   * — or with a phone of their own — writes: Message yourself, or a group
   * where every message counts. Repeating events are kept in a range: one
   * week's or month's of them is all of them. */
  function askBulk(command, bulk, settings) {
    if (!(command.chat === "self" || everyOf(settings).includes(command.chat_id))) {
      return { title: "Delete all", text: "“Delete all …” works in Message yourself, and in a group where every message counts — not here." };
    }
    const span = rangeOf(bulk.range, sentOn(command, settings).day);
    const inRange = span ? db.events.between(span.from, span.to) : db.events.all();
    const inSpan = (e) => (e.reminder ? occurrencesBetween(e, span.from, span.to).length > 0 : e.day >= span.from && e.day <= span.to);
    const events = bulk.kinds === "tasks" ? [] : span ? inRange.filter((e) => !e.repeat && inSpan(e)) : inRange;
    const kept = bulk.kinds === "tasks" || !span ? [] : inRange.filter((e) => e.repeat && occurrencesBetween(e, span.from, span.to).length);
    const tasks = bulk.kinds === "events" ? [] : span ? db.tasks.dueBetween(span.from, span.to) : db.tasks.all();
    const label = span ? span.label : "everything on the calendar";
    const keptLine = kept.length ? [`Repeating events are kept: ${kept.map((e) => e.title).join(", ")} — delete them in Ormma → Calendar.`] : [];
    if (!events.length && !tasks.length) return { title: "Delete all", text: [`Nothing to delete — ${label}.`, ...keptLine].join("\n") };
    db.bulkDeletes.create({ messageId: command.id, label, events: events.map((e) => e.id), tasks: tasks.map((t) => t.id) }, clock().toISOString());
    return {
      title: "Delete all",
      text: [`⚠️ Delete ${counted(events.length, tasks.length)} — ${label}?`, "Reply *yes* to this message within 10 minutes to delete them.", ...keptLine].join("\n"),
    };
  }

  /* A copy of the database before "delete all …", next to it — the latest
   * KEEP_COPIES of them. → its name, or null. */
  function keepCopy() {
    if (!dataDir) return null;
    const name = `before-delete-${clock().toISOString().replace(/[:.]/g, "-")}.db`;
    try {
      db.snapshot(join(dataDir, name));
      const copies = readdirSync(dataDir).filter((f) => /^before-delete-.*\.db$/.test(f)).sort();
      for (const old of copies.slice(0, -KEEP_COPIES)) rmSync(join(dataDir, old), { force: true });
      return name;
    } catch (err) {
      log.warn({ err: err.message }, "📅 messages: no copy could be kept before deleting");
      return null;
    }
  }

  /* The answer to "⚠️ Delete …?": "yes" within the ten minutes deletes
   * what was counted then; anything else, nothing. */
  function confirmBulk(command, bulk) {
    const at = clock().toISOString();
    if (bulk.done_at) return { title: "Delete all", text: bulk.outcome === "deleted" ? "Those were deleted already." : "Nothing was deleted then — send it again to start over." };
    if (!YES.test(command.text)) {
      db.bulkDeletes.finish(bulk.message_id, "cancelled", at);
      return { title: "Delete all", text: "Nothing was deleted." };
    }
    if (clock().getTime() - Date.parse(bulk.created_at) > CONFIRM_MS) {
      db.bulkDeletes.finish(bulk.message_id, "expired", at);
      return { title: "Delete all", text: "That was more than 10 minutes ago, so nothing was deleted. Send it again to start over." };
    }
    const copy = keepCopy();
    const done = db.transaction(() => {
      const events = bulk.events.filter((id) => db.events.remove(id)).length;
      const tasks = bulk.tasks.filter((id) => db.tasks.remove(id)).length;
      db.bulkDeletes.finish(bulk.message_id, "deleted", at);
      return { events, tasks };
    });
    log.info({ message_id: command.id, ...done, copy }, "📅 messages: deleted all asked for");
    return { title: "Delete all", text: `🗑️ Deleted ${counted(done.events, done.tasks) || "nothing — they were gone already"} — ${bulk.label}.` };
  }

  /* "today’s", or "Wed 8 Oct’s": a page, named from today. */
  const pageOf = (day) => (day === isoDate(scheduler.today().date) ? "today’s" : `${formatShortDate(fromIsoDate(day))}’s`);

  /* A 📝 message, written on the page of the day it was sent, under what
   * is there: the time it was sent and its words — and, for a reply, the
   * message it replied to, quoted. The day's notes end up on one page, in
   * the order they came. → the answer */
  function addNote(command, text, settings) {
    const { day, minute } = sentOn(command, settings);
    const at = `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
    const words = [text.trim(), command.quoted?.trim() ? `“${command.quoted.trim()}”` : ""].filter(Boolean).join("\n");
    const line = `${at} — ${words}`;
    const page = db.transaction(() => {
      const id = db.journal.append(day, line);
      db.captures.record(command, "note", id, line);
      return id;
    });
    log.info({ message_id: command.id, page }, "📝 message written on the day's page"); // never its words
    return { answer: { title: "Note", text: `📓 Noted on ${pageOf(day)} page (${at}).\nReply “delete” to take it off.` } };
  }

  /* "show notes for yesterday": the pages read back, oldest first. The
   * answer goes where calendar messages go, whoever asked — so, as with
   * "delete all", only the owner's chats may ask: Message yourself, or a
   * group where every message counts. Not a shared group's 📝. */
  function showNotes(command, request, settings) {
    db.captures.record(command);
    const title = "Notes";
    if (!(command.chat === "self" || everyOf(settings).includes(command.chat_id))) {
      return { answer: { title, text: "Pages are read back when asked in Message yourself, or in a group where every message counts — not from here." } };
    }
    if (!request.range) {
      return { answer: { title, text: `I don’t know which days “${request.period}” are. Try today, yesterday, last week, this month, Monday, or a day like 5 Oct.` } };
    }
    const { from, to, label } = request.range;
    const pages = db.journal.pagesBetween(from, to);
    log.info({ message_id: command.id, pages: pages.length }, "📝 messages: pages read back"); // never their words
    if (!pages.length) return { answer: { title, text: from === to ? `📓 Nothing on the page for ${label}.` : `📓 No pages for ${label}.` } };
    const lines =
      from === to
        ? [`📓 *${label}*`, "", pages[0].body]
        : [`📓 *${label}* — ${pages.length === 1 ? "1 page" : `${pages.length} pages`}`, ...pages.flatMap((page) => ["", `*${shortDay(page.day)}*`, page.body])];
    return { answer: { title, text: clipMessage(lines.join("\n")) } };
  }

  /* "remind me to call Renjith": an event at the morning time (07:00 unless
   * changed) — the next morning, without a day — with its reminder at the
   * time. A day or a time in it, read by Claude or the rules, wins. */
  async function remindItem(command, about, settings) {
    const where = whereOf(command);
    const asked = await askClaude(command, settings);
    const reading = asked.reading && !["none", "note"].includes(asked.reading.kind) ? asked.reading : readCapture({ ...command, text: about }, { timeZone: settings.timezone, where });
    const morning = settings.morningTime;
    const sent = sentOn(command, settings);
    const day = reading.kind === "event" ? reading.day : reading.due ?? (sent.minute < parseTime(morning) ? sent.day : shiftDay(sent.day, 1));
    const time = reading.kind === "event" && reading.time ? reading.time : morning;
    const raw = reading.title && reading.title !== "Untitled" ? reading.title : about;
    const title = raw.charAt(0).toUpperCase() + raw.slice(1);
    return { kind: "event", reminder: true, title, day, endDay: null, time, endTime: "", remind: 0, notes: notesFor(command, where), sender: command.sender ?? null, why: null };
  }

  /* A reply to an event's "⏰ …" reminder: "done" or "delete" takes a
   * reminder ("remind me to …") off the calendar, with all its days to
   * come; "delete", a one-off event. A repeating event is deleted in
   * Calendar, not from one of its weeks. Anything else: let go. */
  function answerReminder(command, reminded) {
    db.captures.record(command);
    const id = Number(reminded.key.split(":")[1]);
    const found = db.events.get(id);
    const event = found && (!reminded.title || found.title === reminded.title) ? found : null;
    const title = reminded.title ?? "it";
    const stop = isDelete(command.text) || (isDone(command.text) && event?.reminder);
    if (!stop) return null;
    if (!event) return { title, text: `*${title}* was deleted already.` };
    if (event.repeat) return { title, text: `*${title}* repeats ${repeatLabel(event.repeat).toLowerCase()} — delete it in Ormma → Calendar.` };
    db.events.remove(event.id);
    log.info({ message_id: command.id, reminder: event.reminder }, "📅 message: a reminder answered"); // never its text
    return { title, text: event.reminder ? `✅ Done: *${title}* — no more reminders.` : `🗑️ Deleted: *${title}*` };
  }

  /* A reply to one of the app's own "✅ Added …": "delete" takes that off
   * the calendar again; anything else is not read as something new. A
   * reply to its "⚠️ Delete …?" is the answer to that. The answer, or null
   * to let it go unanswered. */
  function answerReply(command, answered, settings) {
    db.captures.record(command);
    const bulk = db.bulkDeletes.get(answered.key.replace(/^capture:/, ""));
    if (bulk) return confirmBulk(command, bulk);
    const added = db.captures.get(answered.key.replace(/^capture:/, ""));
    if (!added?.kind) return null; // an answer to a delete, say
    const title = answered.title ?? "it";
    if (added.kind === "note") {
      // A line on a page: "delete" takes it off, if it is still there as
      // it was written.
      if (!isDelete(command.text)) return { title, text: "Only “delete” works as a reply to that. To change the page, open Ormma → Notes → Journal." };
      const { day } = sentOn(added, settings);
      const gone = Boolean(added.added) && db.journal.removeChunk(day, added.added);
      log.info({ message_id: command.id, gone }, "📝 message: a line taken off by a reply");
      return { title, text: gone ? `🗑️ Taken off ${pageOf(day)} page.` : `That line is no longer on ${pageOf(day)} page as it was written — change the page in Ormma → Notes → Journal.` };
    }
    if (!isDelete(command.text) && !isDone(command.text)) {
      return { title, text: `Only “delete” works as a reply to that. To change *${title}*, open Ormma → Calendar.` };
    }
    // Deleted, its item is forgotten (db.mjs, migration 10); and an id is
    // used again, so the title must still be the one that was added.
    const found = added.item_id && (added.kind === "event" ? db.events.get(added.item_id) : db.tasks.get(added.item_id));
    const item = found && (!answered.title || found.title === answered.title) ? found : null;
    if (!item) return { title, text: `*${title}* was deleted already.` };
    if (added.kind === "event") db.events.remove(item.id);
    else db.tasks.remove(item.id);
    log.info({ message_id: command.id, kind: added.kind }, "📅 message: deleted by a reply"); // never its text
    return { title: item.title, text: deletedLine(added.kind, item) };
  }

  /* Puts one message on the calendar. → what it became; {answer} for a
   * reply to the app's own "✅ Added …"; null when it was let go without
   * adding anything; LATER to leave it with the bridge. */
  async function take(command, settings) {
    if (!chosen(settings).includes(keyOf(command))) {
      // Held by the bridge before the chat was let go of: not added.
      db.captures.record(command);
      return null;
    }
    // "show notes for yesterday": pages read back, not written on.
    const show = readShowNotes(command.text, sentOn(command, settings).day);
    if (show) return showNotes(command, show, settings);
    // 📝: for the diary, whatever else it says — a reply of 📝 to a message
    // keeps that message on the page.
    if (command.mark === "note") return addNote(command, command.text, settings);
    const answered = command.quoted_id ? db.deliveries.captureAnswer(command.quoted_id) : null;
    if (answered) return { answer: answerReply(command, answered, settings) };
    const reminded = command.quoted_id ? db.deliveries.eventReminder(command.quoted_id) : null;
    if (reminded) return { answer: answerReminder(command, reminded) };
    const everyMessage = command.marked === false && everyOf(settings).includes(command.chat_id);
    const noted = everyMessage ? readNotePrefix(command.text) : null;
    if (noted !== null) return addNote(command, noted, settings);
    const bulk = readBulkDelete(command.text);
    if (bulk) {
      db.captures.record(command);
      return { answer: askBulk(command, bulk, settings) };
    }
    const about = readReminder(command.text);
    if (about) return addItem(command, await remindItem(command, about, settings));
    const marked = command.marked !== false;
    const where = whereOf(command);
    const asked = await askClaude(command, settings);
    let item = asked.reading ?? null;
    // Not an appointment or a to-do, but something to keep: the diary.
    if (!marked && item?.kind === "note") return addNote(command, command.text, settings);
    if (!marked && (asked.unusable || item?.kind === "none")) {
      // Nothing for the calendar — or nothing Claude could make of it.
      db.captures.record(command);
      return null;
    }
    if (!item || item.kind === "none" || item.kind === "note") {
      if (!marked) {
        // Nothing reads a message without the 📅 but Claude: wait for it.
        if (clock().getTime() - Date.parse(command.sent_at) < WAIT_FOR_CLAUDE_MS) return LATER;
        db.captures.record(command);
        return null;
      }
      item = readCapture(command, { timeZone: settings.timezone, where });
    } else {
      item = { ...item, notes: notesFor(command, where), sender: command.sender ?? null, why: null };
    }
    if (item.kind === "event") item = { ...item, remind: reminderFor(item, settings.defaultRemind) };
    return addItem(command, item);
  }

  /* An item on the calendar, and the message it came from marked as taken
   * — both or neither. */
  function addItem(command, item) {
    return db.transaction(() => {
      const id =
        item.kind === "event"
          ? db.events.create({ title: item.title, day: item.day, endDay: item.endDay, time: item.time, endTime: item.endTime, remind: item.remind, notes: item.notes, reminder: Boolean(item.reminder) })
          : db.tasks.create({ title: item.title, due: item.due, notes: item.notes });
      db.captures.record(command, item.kind, id);
      return item;
    });
  }

  /* The bridge acts on the chats it was last told of — none after it
   * starts. Told again whenever that is not what Settings says. */
  async function tellChats(held, settings) {
    const chats = chosen(settings);
    const every = everyOf(settings);
    if (!Array.isArray(held.chats)) return; // a bridge from before chosen chats
    if ([...held.chats].sort().join(" ") === chats.join(" ") && [...(held.every ?? [])].sort().join(" ") === every.join(" ")) return;
    await bridge.setCommandChats(chats, every);
    log.info({ self: chats.includes("self"), groups: chats.filter((c) => c !== "self").length, every_message: every.length }, "📅 messages: told the bridge where they count");
  }

  /* Takes what the bridge holds, answers each, and tells it to let them go.
   * → how many were put on the calendar */
  async function poll() {
    if (busy) return 0;
    busy = true;
    try {
      let commands;
      const settings = db.settings.get();
      try {
        const held = await bridge.commands();
        commands = held.commands ?? [];
        await tellChats(held, settings);
      } catch (err) {
        // Not linked, not running, or a bridge from before 📅 messages: the
        // next poll asks again. Said once, not every 15 s.
        if (err.code !== lastProblem) log.info({ code: err.code }, "📅 messages: the bridge has none to give");
        lastProblem = err.code;
        return 0;
      }
      lastProblem = null;
      if (!commands.length) return 0;
      let added = 0;
      const taken = [];
      for (const command of [...commands].sort((a, b) => a.sent_at.localeCompare(b.sent_at))) {
        if (!db.captures.has(command.id)) {
          const item = await take(command, settings);
          if (item === LATER) continue;
          if (item?.answer) {
            try {
              await scheduler.sendCalendarReply({ key: `capture:${command.id}`, ...item.answer });
            } catch (err) {
              log.warn({ message_id: command.id, err: err.message }, "📅 message: a reply's answer was not sent");
            }
          } else if (item && !("answer" in item)) {
            added++;
            log.info({ message_id: command.id, kind: item.kind }, "📅 message put on the calendar"); // never its text
            try {
              await scheduler.sendCalendarReply({ key: `capture:${command.id}`, title: item.title, text: renderCaptureReply(item) });
            } catch (err) {
              log.warn({ message_id: command.id, err: err.message }, "📅 message added, but its answer was not sent");
            }
          }
        }
        taken.push(command.id);
      }
      if (taken.length) {
        await bridge.ackCommands(taken).catch((err) => log.warn({ code: err.code }, "📅 messages: the bridge was not told; they are taken once all the same"));
      }
      db.captures.prune(new Date(clock().getTime() - KEEP_DAYS * 86_400_000).toISOString().replace(/\.\d{3}Z$/, "Z"));
      return added;
    } finally {
      busy = false;
    }
  }

  return {
    poll,
    start() {
      const tick = () => poll().catch((err) => log.error({ err: err?.stack || String(err) }, "📅 messages: a poll failed"));
      timer = setInterval(tick, POLL_MS);
    },
    stop: () => clearInterval(timer),
  };
}
