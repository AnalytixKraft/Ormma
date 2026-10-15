import assert from "node:assert/strict";
import { test } from "node:test";
import { dayHeader, dayOfYear } from "../src/views/layout.mjs";

test("the day of the year, counted as a diary counts it at the head of a page", () => {
  assert.deepEqual(dayOfYear({ year: 2026, month: 10, day: 12 }), { n: 285, left: 80 });
  assert.deepEqual(dayOfYear({ year: 2026, month: 1, day: 1 }), { n: 1, left: 364 });
  assert.deepEqual(dayOfYear({ year: 2024, month: 12, day: 31 }), { n: 366, left: 0 }, "a leap year");
});

test("the day as a diary prints it: the numeral, the weekday, a Sunday in red, the names written in", () => {
  const sunday = String(dayHeader({ date: { year: 2026, month: 10, day: 11 }, people: [{ name: "Tom Iyer", kind: "birthday", day: 11, month: 10, year: 1990 }] }));
  assert.match(sunday, /^<article class="day day--large day--sunday">/);
  assert.match(sunday, /<h3 class="visually-hidden">Sunday 11 October 2026<\/h3>/);
  assert.match(sunday, /Day 284 · 81 left/);
  assert.match(sunday, /<span class="day__en">Sunday<\/span><\/p>/);
  assert.match(sunday, /October 2026/);
  assert.match(sunday, /Tom Iyer <span class="day__age">\(36\)<\/span><span class="visually-hidden">, birthday<\/span>/);

  const tab = String(dayHeader({ date: { year: 2026, month: 10, day: 17 }, size: "small", caption: "In 5 days", heading: "p" }));
  assert.match(tab, /^<article class="day day--small">/);
  assert.match(tab, /<p class="visually-hidden">Saturday 17 October 2026, In 5 days<\/p>/);
  assert.match(tab, /<span class="day__en">Sat<\/span><\/p>/);
  assert.doesNotMatch(tab, /day__count|day__blank/);
});
