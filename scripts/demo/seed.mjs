/* Fills a fresh database with a made-up life, for the demo (run.mjs) and the
 * screenshots: people with birthdays and anniversaries — three of them
 * today — a week of the calendar, tasks, notes and journal pages, Settings
 * filled in, and the record of the messages the app would have sent today
 * and yesterday. Every date is counted from today, in the demo's time zone,
 * so the diary looks lived in whenever this is run.
 *
 *   node scripts/demo/seed.mjs <data dir>
 *
 * Only a database that does not exist yet is filled: this never adds to
 * one that holds anything. It is written with the app's own code (db.mjs),
 * and what was "sent" is planned by the scheduler's own planDay, so the keys
 * match the ones the running app uses and none is sent twice.
 *
 * Everyone here is made up. The phone numbers are in Ofcom's range for
 * drama, +44 7700 900000–900999, which belongs to no one; the groups are the
 * stub bridge's (stub-bridge.mjs). Sending is turned on in Settings: safe
 * only because the demo's app talks to that stub, never to WhatsApp. */

import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { addDays, isoDate, parseTime, weekdayOf, WEEKDAYS, zonedNow } from "../../app/src/dates.mjs";
import { openDb } from "../../app/src/db.mjs";
import { planDay } from "../../app/src/scheduler.mjs";
import { STUB_GROUPS, STUB_ME } from "./stub-bridge.mjs";

export const DEMO_TIMEZONE = "Asia/Kolkata";

const GROUP = Object.fromEntries(STUB_GROUPS.map((g) => [g.subject, g.id]));
const LINKED = STUB_ME.id.split("@")[0];
const MY_NUMBER = "447700900100";
const SELF = { id: STUB_ME.id, label: "the linked phone" };

/* The instant a wall-clock time on a day is, in `timeZone`. */
function instant(day, time, timeZone) {
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const seen = zonedNow(new Date(guess), timeZone);
  return new Date(2 * guess - Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute));
}

/* SQLite's own timestamp format, which db.mjs writes: no milliseconds. */
const sqliteTime = (date) => date.toISOString().replace(/\.\d{3}Z$/, "Z");
const messageId = () => `3EB0${randomBytes(8).toString("hex").toUpperCase()}`;

/* file: where the database goes (it must not exist). now: the moment the
 * demo is "now". → what was added, counted */
export function seedDemo(file, { now = new Date(), timeZone = DEMO_TIMEZONE } = {}) {
  if (existsSync(file)) throw new Error(`${file} exists already. The demo seeds a new database only.`);
  const clock = zonedNow(now, timeZone);
  const today = { year: clock.year, month: clock.month, day: clock.day };
  const minute = clock.hour * 60 + clock.minute;
  const day = (n) => isoDate(addDays(today, n));
  const at = (n, time) => instant(day(n), time, timeZone);
  const weekday = (n) => WEEKDAYS[weekdayOf(addDays(today, n))].slice(0, 3);

  const db = openDb(file, { defaultTimezone: timeZone });
  const ids = { notes: [], journal: [], tasks: {}, events: {} };
  const written = []; // [note id, when it was last written]
  let people;
  try {
    db.settings.save({
      enabled: true,
      wishTime: "08:00",
      reminderTime: "06:00",
      timezone: timeZone,
      daysAhead: 3,
      reminderTo: "self",
      alertTo: "direct",
      calendarTo: "self",
      capture: true,
      captureChats: ["self", GROUP.Family],
      captureEvery: [],
      defaultRemind: 5,
      morningTime: "07:00",
      myPhone: MY_NUMBER,
      countryCode: "91",
    });
    // The groups' names, as the app keeps them from the bridge's /groups.
    db.chats.remember(STUB_GROUPS);

    /* ------------------------------------------------------------ people */

    // [days from today, name, kind, years (the age they turn, or the years
    // married; null: not known), send to, number, time, message, notes]
    const PEOPLE = [
      [0, "Anu Joseph", "birthday", 30, "direct", "447700900101", "19:30", "Happy birthday, *Anu*! 🎂\n\nThirty looks good on you. Have a wonderful day — and save me a slice of the cake! 🥳", ""],
      [0, "Joseph & Mary", "anniversary", 25, GROUP.Family, "", "", "", "Silver jubilee — the family is planning a lunch on Sunday."],
      [0, "Biju Thomas", "birthday", null, GROUP["St. Mary's Youth"], "", "", "", ""],
      [1, "Meera Nair", "birthday", 38, "direct", "447700900102", "09:00", "Happy birthday, Meera! 🌼\n\nWishing you a year as warm as your filter coffee. Lots of love from all of us.", "Met at the Onam sadya, 2019."],
      [2, "Thomas Kurian", "birthday", null, GROUP.Choir, "", "", "", ""],
      [3, "Renjith & Divya", "anniversary", 10, GROUP.Family, "", "07:30", "", ""],
      [5, "Lakshmi Menon", "birthday", 67, "direct", "447700900103", "", "Happy birthday, Lakshmi aunty! 🌸\n\nWishing you good health, happiness, and many more years of your wonderful payasam.", ""],
      [9, "Arjun Pillai", "birthday", null, GROUP["Book club"], "", "", "", ""],
      [12, "Sneha George", "birthday", 23, GROUP["St. Mary's Youth"], "", "", "", ""],
      [18, "Paul & Teresa", "anniversary", 40, GROUP.Family, "", "", "💍 Happy ruby anniversary, *Paul & Teresa*! ❤️\n\nForty years together — thank you for showing us all how it’s done.", ""],
      [26, "Kavya Ramesh", "birthday", 14, GROUP.Family, "", "", "", ""],
      [34, "Jose Varghese", "birthday", null, GROUP.Choir, "", "", "", ""],
      [45, "Rahul Krishnan", "birthday", 35, "direct", "447700900104", "", "", ""],
      [70, "Annamma Chacko", "birthday", 78, GROUP.Family, "", "08:30", "", ""],
      [-5, "Neethu Abraham", "birthday", 29, GROUP["Book club"], "", "", "", ""],
      [-40, "Sunil Das", "birthday", null, "direct", "447700900105", "", "", "Moved to Dubai — paused for now."],
    ];
    const joined = sqliteTime(new Date(now.getTime() - 40 * 86_400_000));
    people = db.transaction(() =>
      Object.fromEntries(
        PEOPLE.map(([n, name, kind, years, sendTo, phone, sendTime, message, notes]) => {
          let date = addDays(today, n);
          if (date.month === 2 && date.day === 29) date = addDays(date, -1); // keep clear of leap days
          // The next time it comes round: this year, or — passed already — next.
          const next = n >= 0 ? date.year : date.year + 1;
          const id = db.people.create({
            name,
            kind,
            day: date.day,
            month: date.month,
            year: years ? next - years : null,
            phone,
            sendTo,
            sendTime,
            message,
            notes,
            active: name !== "Sunil Das",
            createdAt: joined,
          });
          return [name, id];
        }),
      ),
    );

    /* ---------------------------------------------------------- calendar */

    const EVENTS = [
      // A weekly one, on today's weekday, so it is in "Your day".
      ["Choir practice", { day: day(-14), time: "18:30", endTime: "20:00", repeat: "weekly", remind: 60, notes: "St. Mary's church hall. Bring the new carol sheets." }],
      ["Team lunch", { day: day(0), time: "13:00", endTime: "14:00", remind: 30, notes: "The new Kerala place near the office — Renjith is booking." }],
      ["Dentist", { day: day(1), time: "10:00", endTime: "10:45", remind: 60, notes: "From WhatsApp: Message yourself" }],
      ["Parent–teacher meeting", { day: day(3), time: "16:00", endTime: "17:00", remind: 60, notes: "Kavya's class teacher. Ask about the maths olympiad." }],
      ["Trip to Munnar", { day: day(6), endDay: day(9), remind: 1440, notes: "Homestay booked. Leave by 6 am to beat the ghat-road traffic." }],
      ["Kavya's school annual day", { day: day(12), time: "17:00", endTime: "19:30", remind: 120 }],
      ["Amma — eye check-up", { day: day(15), time: "11:30", remind: 1440, notes: "Take the old prescription and her glasses." }],
      ["Book club", { day: day(-3), time: "19:00", endTime: "21:00", notes: "At Arjun's. The God of Small Things." }],
      ["Haircut", { day: day(-6), time: "17:30" }],
    ];
    for (const [title, fields] of EVENTS) ids.events[title] = db.events.create({ title, ...fields });

    const TASKS = [
      ["Call the plumber about the kitchen tap", day(-2)],
      ["Pay the electricity bill", day(0)],
      ["Pick up Anu's cake", day(0)],
      ["Book train tickets to Kottayam", day(4)],
      ["Renew the car insurance", day(10)],
      ["Return the library books", null],
      ["Send Joseph & Mary a card", day(-1)],
    ];
    for (const [title, due] of TASKS) ids.tasks[title] = db.tasks.create({ title, due });
    db.tasks.setDone(ids.tasks["Send Joseph & Mary a card"], true);

    /* ------------------------------------------------------------- notes */

    const paulYear = addDays(today, 18).year - 40;
    const NOTES = [
      [
        { title: "Gift ideas", pinned: true, body: `For the next few birthdays — cross them off once they're bought. #gifts\n\n- Meera: the new Benyamin novel, and a proper filter-coffee set #books\n- Lakshmi aunty: a kasavu shawl from the handloom shop\n- Kavya: watercolour paints and a big sketchbook\n- Paul & Teresa (40 years!): frame the wedding photo from ${paulYear}` },
        [-2, "21:15"],
      ],
      [
        { title: "", personId: people["Meera Nair"], body: "Catch up with Meera\n\nShe started at the new school in June — ask how her Class 4 lot are treating her. Training for a half marathon in December, so maybe good running socks with the book. #gifts" },
        [-6, "19:40"],
      ],
      [{ title: "Munnar packing list", body: "#travel\n\n- warm jacket — it gets cold at night\n- walking shoes\n- charger and the power bank\n- umbrella (always)\n- tickets for the tea museum" }, [-1, "22:30"]],
      [{ title: "Choir — Christmas carols", body: "Silent Night — all three verses\nJoy to the World\nO Holy Night — Thomas has the solo\n\nExtra practice every Thursday from November. #choir" }, [-4, "21:05"]],
      [{ title: "Books to read", body: "- The God of Small Things (again, for book club)\n- Aadujeevitham\n- Chemmeen — for next month\n- Ente Katha\n\n#books" }, [-9, "23:00"]],
      [{ title: "After the check-up", body: "Dr. Sunitha: walk 30 minutes every morning, less sugar in the tea, blood pressure again in December. Drink more water! #health" }, [-12, "18:20"]],
      [{ title: "Amma's fish curry", body: "Kudampuli soaked in warm water. Shallots, ginger, garlic, curry leaves; Kashmiri chilli for the colour, a pinch of turmeric. Coconut oil at the very end, never before. Better the next day. #recipes" }, [-20, "20:10"]],
    ];
    for (const [note, [n, time]] of NOTES) {
      const id = db.notes.create(note);
      written.push([id, at(n, time)]);
      ids.notes.push(id);
    }

    /* ----------------------------------------------------------- journal */

    const JOURNAL = [
      [-6, "20:45", "Walked 4 km before work and felt good all day. #health\n\nBooked the homestay for Munnar. 🌿"],
      [-5, "23:05", "Neethu's birthday. Dinner at her place — appam and stew, and far too much payasam. She loved the book. 🎂"],
      [-3, "23:10", "Book club at Arjun's. A long argument about the ending of The God of Small Things — Neethu won, as usual. Next month: Chemmeen. #books"],
      [-2, "21:30", "Rain all afternoon. Kavya and I made banana chips and burnt the first batch.\n\nThe plumber never came. Call again tomorrow."],
      [-1, "22:05", "A quiet day at home. Halfway through Aadujeevitham — hard to put down. #books\n\nCalled Amma in the evening: her knee is much better, and she walked to the temple and back. #health"],
    ];
    // Today's page as far as the day has gone: the morning's line, and the
    // note sent from WhatsApp once its time has passed.
    const noteLine = "08:40 — Biju's wishes went out in the youth group — lots of replies already 🎉";
    if (minute >= 7 * 60 + 10) JOURNAL.push([0, minute >= 8 * 60 + 45 ? "08:40" : "07:05", `Up early — filter coffee on the balcony while it rained. ☕${minute >= 8 * 60 + 45 ? `\n\n${noteLine}` : ""}`]);
    for (const [n, time, body] of JOURNAL) {
      db.journal.save(day(n), body);
      const id = db.journal.get(day(n)).id;
      written.push([id, at(n, time)]);
      ids.journal.push(id);
    }

    /* -------------------------------------------------- what went out */

    // Yesterday's messages, and today's whose time has come — as the app
    // would have sent them, a few seconds apart, to the stub's linked phone.
    const deliver = (job, when) => {
      db.deliveries.begin(job, when.toISOString());
      db.deliveries.succeed(job.key, messageId(), when.toISOString());
    };
    const settings = db.settings.get();
    for (const [n, due] of [[-1, () => true], [0, (job) => parseTime(job.time) <= minute]]) {
      const date = addDays(today, n);
      planDay(db, settings, date, { linkedPhone: LINKED })
        .filter((job) => job.to?.id && due(job))
        .forEach((job, i) => deliver(job, new Date(at(n, job.time).getTime() + (3 + i * 4) * 1000)));
    }
    // The answers to two messages sent on WhatsApp: yesterday's 📅 that put
    // the dentist on the calendar, and this morning's 📝 on today's page.
    const dentistAt = at(-1, "20:14");
    const dentist = { id: messageId(), chat_id: "self", sent_at: dentistAt.toISOString(), text: `Dentist ${weekday(1)} 10-10:45am`, quoted: null };
    db.captures.record(dentist, "event", ids.events.Dentist);
    deliver({ key: `capture:${dentist.id}`, day: day(-1), kind: "capture", to: SELF, title: "Dentist" }, new Date(dentistAt.getTime() + 6_000));
    if (minute >= 8 * 60 + 45) {
      const noteAt = at(0, "08:40");
      const note = { id: messageId(), chat_id: "self", sent_at: noteAt.toISOString(), text: noteLine.slice("08:40 — ".length), quoted: null };
      db.captures.record(note, "note", db.journal.get(day(0)).id, noteLine);
      deliver({ key: `capture:${note.id}`, day: day(0), kind: "capture", to: SELF, title: "Note" }, new Date(noteAt.getTime() + 5_000));
    }
  } finally {
    db.close();
  }

  /* Written over days, not all this minute: db.mjs stamps every row with
   * now, which a seed cannot change through it. Only the dates move. */
  const raw = new DatabaseSync(file);
  try {
    const stamp = raw.prepare("UPDATE notes SET created_at = ?, updated_at = ? WHERE id = ?");
    for (const [id, when] of written) stamp.run(sqliteTime(when), sqliteTime(when), id);
    raw.prepare("UPDATE tasks SET created_at = ?, updated_at = ?").run(sqliteTime(at(-7, "09:00")), sqliteTime(at(-7, "09:00")));
    raw.prepare("UPDATE tasks SET done_at = ? WHERE id = ?").run(sqliteTime(at(-1, "18:20")), ids.tasks["Send Joseph & Mary a card"]);
    raw.prepare("UPDATE events SET created_at = ?, updated_at = ?").run(sqliteTime(at(-10, "21:00")), sqliteTime(at(-10, "21:00")));
    raw.prepare("UPDATE events SET created_at = ?, updated_at = ? WHERE id = ?").run(sqliteTime(at(-1, "20:14")), sqliteTime(at(-1, "20:14")), ids.events.Dentist);
  } finally {
    raw.close();
  }

  return {
    people: Object.keys(people).length,
    events: Object.keys(ids.events).length,
    tasks: Object.keys(ids.tasks).length,
    notes: ids.notes.length,
    journal: ids.journal.length,
  };
}

/* ------------------------------------------------------------------ CLI */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("Usage: node scripts/demo/seed.mjs <data dir>   (a new or empty folder)");
    process.exit(2);
  }
  // Never anywhere near the real app's data.
  if (/WishCalendar|Application Support\/Ormma/i.test(resolve(dir))) {
    console.error(`seed: ${resolve(dir)} looks like a real Ormma data folder. Give the demo a folder of its own.`);
    process.exit(2);
  }
  mkdirSync(dir, { recursive: true });
  try {
    const counts = seedDemo(join(dir, "birthdays.db"));
    console.log(`seed: ${counts.people} people, ${counts.events} events, ${counts.tasks} tasks, ${counts.notes} notes and ${counts.journal} journal pages in ${join(resolve(dir), "birthdays.db")}`);
  } catch (err) {
    console.error(`seed: ${err.message}`);
    process.exit(1);
  }
}
