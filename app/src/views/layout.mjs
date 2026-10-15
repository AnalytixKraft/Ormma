/* The frame every page sits in — the cover, the ribbon, the page — the day
 * as a diary prints it, and the pages shown before signing in (or when
 * something is wrong). */

import { MONTHS, WEEKDAYS, ageOn, formatDayMonth, isLeapYear, weekdayOf, zonedNow } from "../dates.mjs";
import { desktopHints } from "../desktop.mjs";
import { KIND_ICON } from "../messages.mjs";
import { html, raw } from "./html.mjs";

/* What the app is called on its pages. (Inside, it keeps its first name —
 * the Docker project, the volumes, the cookie — so a rename loses nothing.) */
export const APP_NAME = "Ormma";
/* Malayalam for memory, remembrance — a diary, reminders, and the people to
 * remember on their day. */
export const APP_TAGLINE = "ഓർമ്മ — your diary and reminders";
/* The weekdays in Malayalam, printed beside the English as a Kerala diary
 * prints them. */
export const WEEKDAYS_ML = ["ഞായർ", "തിങ്കൾ", "ചൊവ്വ", "ബുധൻ", "വ്യാഴം", "വെള്ളി", "ശനി"];

export const iconOf = (kind) => KIND_ICON[kind] ?? KIND_ICON.birthday;
export const occasionWord = (kind) => (kind === "anniversary" ? "anniversary" : "birthday");

/* The linked number, as +<digits>, from WhatsApp's `me`. */
export const phoneOf = (me) => (me?.id ? `+${me.id.split("@")[0].split(":")[0]}` : "");

/* "12:21", or "30 Sep, 12:21" — in the app's time zone, spelled the way the
 * rest of the app spells dates. */
export function clockTime(iso, timeZone, withDate = false) {
  const t = zonedNow(new Date(iso), timeZone);
  const time = `${String(t.hour).padStart(2, "0")}:${String(t.minute).padStart(2, "0")}`;
  return withDate ? `${formatDayMonth(t)}, ${time}` : time;
}

/* The day of the year, and the days the year has left after it — "Day 285
 * · 80 left", as a diary counts them at the head of each page. */
export function dayOfYear({ year, month, day }) {
  const n = Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / 86_400_000) + 1;
  return { n, left: (isLeapYear(year) ? 366 : 365) - n };
}

/* ------------------------------------------------------------------ frame */

const NAV = [
  ["today", "/", "Today"],
  ["calendar", "/calendar", "Calendar"],
  ["notes", "/notes", "Notes"],
  ["people", "/people", "People"],
  ["settings", "/settings", "Settings"],
];

export function layout({ title, active = null, body, flash = null, signedIn = true, wide = false, assets }) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#123b2e">
<title>${title} · ${APP_NAME}</title>
<link rel="icon" href="/static/favicon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/static/apple-touch-icon.png">
<link rel="manifest" href="/static/manifest.webmanifest">
<link rel="stylesheet" href="${assets.css}">
<script src="${assets.js}" defer></script>
</head>
<body>
${signedIn
  ? html`<header class="cover">
  <a class="brand" href="/"><img class="brand__mark" src="/static/favicon.svg" alt="" width="30" height="30"><span class="brand__text"><span class="brand__name" lang="ml">ഓർമ്മ</span><span class="brand__latin">${APP_NAME}</span></span></a>
  <nav class="nav" aria-label="Main">
    ${NAV.map(([key, href, label]) => html`<a href="${href}"${key === active ? raw(' aria-current="page"') : ""}>${label}</a>`)}
  </nav>
  <form method="post" action="/logout" class="cover__signout"><button type="submit" class="linkish">Sign out</button></form>
</header>`
  : ""}
<main class="page${signedIn ? "" : " page--bare"}${wide ? " page--wide" : ""}">
${flash ? html`<div class="flash flash--${flash.type}" role="${flash.type === "error" ? "alert" : "status"}">${flash.text}</div>` : ""}
${body}
</main>
</body>
</html>`;
}

/* ------------------------------------------------------- the printed day */

/* The day as a diary prints it at the head of a page: the day of the year,
 * the numeral (red on a Sunday, as every calendar here prints it), the
 * weekday in English and Malayalam, the month — and, written in below,
 * the people to remember. `size` is "large" (the page's head) or "small"
 * (a thumb tab beside something); `heading` the level its (visually
 * hidden) title takes in the page's outline. */
export function dayHeader({ date, size = "large", people = [], caption = null, heading = "h3" }) {
  const wd = weekdayOf(date);
  const names = people.map((p) => ({ name: p.name, kind: p.kind, years: ageOn(p, date) }));
  const title = `${WEEKDAYS[wd]} ${date.day} ${MONTHS[date.month - 1]} ${date.year}${caption ? `, ${caption}` : ""}`;
  const count = dayOfYear(date);
  const large = size === "large";
  return html`<article class="day day--${size}${wd === 0 ? " day--sunday" : ""}">
  ${raw(`<${heading} class="visually-hidden">`)}${title}${raw(`</${heading}>`)}
  ${large ? html`<p class="day__count" aria-hidden="true">Day ${count.n} · ${count.left} left</p>` : ""}
  <p class="day__num" aria-hidden="true">${date.day}</p>
  <p class="day__weekday" aria-hidden="true"><span class="day__en">${large ? WEEKDAYS[wd] : WEEKDAYS[wd].slice(0, 3)}</span><span class="day__ml" lang="ml">${WEEKDAYS_ML[wd]}</span></p>
  <p class="day__month" aria-hidden="true">${large ? `${MONTHS[date.month - 1]} ${date.year}` : MONTHS[date.month - 1].slice(0, 3)}</p>
  ${names.length
    ? html`<ul class="day__people">${names.map(
        (n) => html`<li><span aria-hidden="true">${iconOf(n.kind)}</span> ${n.name}${n.years ? html` <span class="day__age">(${n.kind === "anniversary" ? `${n.years} yrs` : n.years})</span>` : ""}<span class="visually-hidden">, ${occasionWord(n.kind)}</span></li>`,
      )}</ul>`
    : large
      ? html`<p class="day__blank">No birthdays or anniversaries today</p>`
      : ""}
</article>`;
}

/* --------------------------------------------------------- sign in, setup */

/* A step from desktopHints() on a page: the line to type, as code. */
export const stepHtml = (step) => (step.menu ? step.menu : html`run <code>${step.command}</code> in ${step.terminal}`);

export function signInPage({ today, error, assets }) {
  const desktop = desktopHints();
  return layout({
    title: "Sign in",
    signedIn: false,
    assets,
    body: html`<div class="signin">
  <div class="signin__cover">
    <img class="signin__mark" src="/static/favicon.svg" alt="" width="64" height="64">
    <h1>${APP_NAME}</h1>
    <p class="signin__tagline">${APP_TAGLINE}</p>
  </div>
  <form method="post" action="/login" class="signin__form">
    ${dayHeader({ date: today, size: "small", heading: "p" })}
    <label class="field">
      <span class="field__label">Password</span>
      <input type="password" name="password" autocomplete="current-password" required autofocus>
    </label>
    ${error ? html`<p class="field__error" role="alert">${error}</p>` : ""}
    <button type="submit" class="button">Sign in</button>
    ${desktop
      ? html`<p class="hint">Forgot it? On this computer, ${stepHtml(desktop.reset)} — then open Ormma, and it asks you to choose a new one.</p>`
      : html`<p class="hint">First time: the password is ADMIN_PASSWORD in the .env file on the computer that runs this app. Forgot a password set in Settings? Run <code>bash scripts/reset-password.sh</code> there.</p>`}
  </form>
</div>`,
  });
}

export function notConfiguredPage({ problems, assets }) {
  const desktop = desktopHints();
  return layout({
    title: "Setup needed",
    signedIn: false,
    assets,
    body: html`<div class="signin"><div class="signin__cover">
    <img class="signin__mark" src="/static/favicon.svg" alt="" width="64" height="64">
    <h1>${APP_NAME}</h1>
    <p class="signin__tagline">${APP_TAGLINE}</p>
  </div>
  <div class="signin__form">
  <h2>Finish the setup</h2>
  <p>This app will not open until these are fixed in ${desktop ? html`its settings file, <code>${desktop.config}</code>` : "the .env file"}:</p>
  <ul class="problems">${problems.map((p) => html`<li>${p}</li>`)}</ul>
  ${desktop
    ? html`<p>Then restart Ormma: ${stepHtml(desktop.restart)}.</p>`
    : html`<p>From the project folder, run <code>bash scripts/setup.sh</code>, then <code>docker compose up -d</code>.</p>`}
</div></div>`,
  });
}

export function errorPage({ status, message, assets, signedIn = true }) {
  return layout({
    title: status === 404 ? "Not found" : "Something went wrong",
    assets,
    signedIn,
    body: html`<div class="narrow"><h1>${status === 404 ? "Not found" : "Something went wrong"}</h1><p>${message}</p><p><a href="/">Back to today</a></p></div>`,
  });
}
