/* Settings: the linked WhatsApp, when and where messages go, and the
 * password. */

import { MAX_PASSWORD, MIN_PASSWORD } from "../auth.mjs";
import { REMINDERS } from "../calendar.mjs";
import { DEFAULT_ANNIVERSARY_TEMPLATE, DEFAULT_TEMPLATE, MAX_TEMPLATE } from "../messages.mjs";
import { html, raw, selectOptions } from "./html.mjs";
import { iconOf, layout, phoneOf } from "./layout.mjs";
import { placeholderHelp, sendToOptions } from "./people.mjs";

/* The linked phone: its state, Link or Unlink, and the QR code while
 * linking (app.js follows it along). */
function whatsappSection({ status, error }) {
  const state = status?.state ?? "unreachable";
  let body;
  if (error) {
    body = html`<p class="status"><span class="dot dot--bad" aria-hidden="true"></span><span class="status__text">${error}</span></p>`;
  } else if (state === "open") {
    body = html`<p class="status"><span class="dot dot--ok" aria-hidden="true"></span><span class="status__text">Connected as <strong>${status.me?.name || phoneOf(status.me)}</strong> <span class="muted">${phoneOf(status.me)}</span></span></p>
<p>Keep that phone on, and open WhatsApp on it at least once every two weeks — otherwise WhatsApp unlinks this computer.</p>
<form method="post" action="/whatsapp/logout" class="inline-form" data-confirm="Unlink this WhatsApp number? Nothing is sent until a phone is linked again.">
  <button type="submit" class="button button--danger">Unlink</button>
</form>`;
  } else if (state === "pairing") {
    body = html`<div class="pairing">
  <figure class="qr">
    ${status.qr ? html`<img src="/whatsapp/qr.svg?t=${encodeURIComponent(status.qr_expires_at || "")}" width="264" height="264" alt="QR code for linking WhatsApp" data-qr>` : html`<div class="qr__wait" data-qr>Asking WhatsApp for a code…</div>`}
  </figure>
  <ol class="steps">
    <li>On the phone with the number to link, open WhatsApp.</li>
    <li>Go to <strong>Settings → Linked devices</strong> and tap <strong>Link a device</strong>.</li>
    <li>Point the phone at this code.</li>
  </ol>
</div>
<p class="hint">The code changes every 20 seconds, and stops after about 3 minutes. This section follows along on its own.</p>`;
  } else if (state === "connecting") {
    body = html`<p class="status"><span class="dot dot--off" aria-hidden="true"></span><span class="status__text">Connecting${status.me ? html` as <strong>${status.me.name || phoneOf(status.me)}</strong>` : ""}…</span></p>
${status.last_error ? html`<p class="notice">${status.last_error}</p>` : ""}
<p class="hint">This section follows along on its own. If it stays here for long, check this computer’s internet connection.</p>
<form method="post" action="/whatsapp/logout" class="inline-form" data-confirm="Unlink this WhatsApp number?"><button type="submit" class="button button--quiet">Unlink</button></form>`;
  } else if (state === "conflict") {
    body = html`<p class="status"><span class="dot dot--bad" aria-hidden="true"></span><span class="status__text">Another WhatsApp Web session took over this link.</span></p>
<p class="notice">${status.last_error}</p>
<form method="post" action="/whatsapp/logout" class="inline-form" data-confirm="Unlink, so you can link the phone again?"><button type="submit" class="button">Unlink</button></form>`;
  } else {
    body = html`<p>Link the WhatsApp number that will send the wishes and your reminder.</p>
<div class="warning">
  <p><strong>Use a spare number, not your personal or business one.</strong> WhatsApp does not allow unofficial apps like this one, and can ban the number that uses one — with every chat on it. Messaging people directly draws more attention than posting in groups.</p>
</div>
${status?.last_error ? html`<p class="notice">${status.last_error}</p>` : ""}
<form method="post" action="/whatsapp/pair" class="inline-form"><button type="submit" class="button">Link a phone</button></form>`;
  }
  return html`<section class="card whatsapp" id="whatsapp" data-wa-state="${state}" aria-labelledby="whatsapp-title">
  <h2 class="settings-title" id="whatsapp-title">WhatsApp</h2>
  ${body}
  <p class="wa-changed notice" hidden>WhatsApp’s state has changed — <a href="/settings#whatsapp">reload</a> to see it (your unsaved settings below would be lost).</p>
</section>`;
}

/* Where 📅 messages count: Message yourself, and the groups ticked — and,
 * with Claude, the groups where every message does. A group chosen before
 * that the number has since left stays listed, so a save does not drop it
 * unseen; so does "every message" while there is no API key. */
function capturePicks({ captureChats, captureEvery }, groups, claudeModel, claudeStatus) {
  const on = new Set(captureChats);
  const every = new Set(captureEvery);
  const known = new Set(groups.map((g) => g.id));
  const checked = (yes) => (yes ? raw(" checked") : "");
  const row = (value, label, note = "") => html`<div class="chat-pick">
    <label class="check"><input type="checkbox" name="captureChat" value="${value}"${checked(on.has(value) || every.has(value))}> <span>${label}${note ? html` <span class="optional">${note}</span>` : ""}</span></label>
    ${value === "self"
      ? ""
      : claudeModel
        ? html`<label class="check chat-pick__every"><input type="checkbox" name="captureEvery" value="${value}"${checked(every.has(value))}> <span>every message, no 📅</span></label>`
        : html`<label class="check chat-pick__every is-off" title="Needs ANTHROPIC_API_KEY in .env"><input type="checkbox" disabled${checked(every.has(value))}> <span>every message, no 📅</span></label>${every.has(value) ? html`<input type="hidden" name="captureEvery" value="${value}">` : ""}`}
  </div>`;
  return html`<fieldset class="field chat-picks">
  <legend class="field__label">Where 📅 messages count</legend>
  <div class="chat-picks__list">
    ${row("self", "Message yourself", "the linked number’s own chat — only its own messages")}
    ${groups.map((g) => row(g.id, g.subject))}
    ${[...new Set([...on, ...every])].filter((c) => c !== "self" && !known.has(c)).map((c) => row(c, "A group the number has left, or not listed now"))}
  </div>
  <span class="hint">In a group you tick, <strong>anyone in it</strong> can add to the calendar — at most 30 messages an hour. Groups you don’t tick are not read at all.${groups.length ? "" : " Link WhatsApp to list your groups here."}</span>
  <p class="hint claude-note">${claudeModel
    ? html`<strong>Claude reads them</strong> (${claudeModel}): each message, and the one it replies to, go to Anthropic to be read — so <code>📅 dinner at Ravi’s next Friday after 8</code> works too. In a group with <em>every message, no 📅</em> ticked, Claude adds what is an event or a task and lets the rest go.`
    : html`Simple rules read them. With <code>ANTHROPIC_API_KEY</code> in the .env file, Claude reads them — free-form wording too — and a group can have <em>every message</em> count, no 📅 needed.`}</p>
  ${claudeStatus?.ok === false
    ? html`<p class="notice">Claude’s last call did not work, so simple rules read 📅 messages for now: ${claudeStatus.error.slice(0, 400)}</p>`
    : ""}
</fieldset>`;
}

/* --------------------------------------------------------------- settings */

export function settingsPage({ values, errors = {}, timeZones, groups, wa, claudeModel = null, claudeStatus = null, assets, flash }) {
  const invalid = (e) => (e ? raw(' aria-invalid="true"') : "");
  const error = (e) => (e ? html`<span class="field__error">${e}</span>` : "");
  return layout({
    title: "Settings",
    active: "settings",
    assets,
    flash,
    body: html`<h1>Settings</h1>
${whatsappSection(wa)}
<form method="post" action="/settings" class="card form" novalidate>
  <h2 class="settings-title">Messages</h2>
  <label class="check check--big"><input type="checkbox" name="enabled" value="1"${values.enabled ? raw(" checked") : ""}> <span><strong>Send wishes and reminders automatically</strong><br><span class="hint">Ticked, each goes out at its time. Unticked, the app pauses: nothing goes out on its own — no wishes, reminders, calendar messages or alerts — until you tick it again. The Send now buttons, and the answers to your 📅 messages, work either way.</span></span></label>

  <fieldset class="settings-group">
    <legend>Wishes</legend>
    <label class="field field--short">
      <span class="field__label">Wishes at</span>
      <input type="time" name="wishTime" value="${values.wishTime}" required${invalid(errors.wishTime)}>
      ${error(errors.wishTime)}
    </label>
    <div class="defaults__pair">
      <label class="field">
        <span class="field__label">${iconOf("birthday")} Default birthday message</span>
        <textarea name="template" rows="5" maxlength="${MAX_TEMPLATE}" placeholder="${DEFAULT_TEMPLATE}">${values.template}</textarea>
        ${error(errors.template)}
      </label>
      <label class="field">
        <span class="field__label">${iconOf("anniversary")} Default anniversary message</span>
        <textarea name="anniversaryTemplate" rows="5" maxlength="${MAX_TEMPLATE}" placeholder="${DEFAULT_ANNIVERSARY_TEMPLATE}">${values.anniversaryTemplate}</textarea>
        ${error(errors.anniversaryTemplate)}
      </label>
    </div>
    <span class="hint">Sent for every row whose own message on the People page is empty. Empty here restores the original.</span>
    ${placeholderHelp()}
  </fieldset>

  <fieldset class="settings-group">
    <legend>Your reminder</legend>
    <div class="field-row">
      <label class="field">
        <span class="field__label">Your WhatsApp number</span>
        <input name="myPhone" value="${values.myPhone}" inputmode="tel" autocomplete="off" placeholder="+91 98765 43210"${invalid(errors.myPhone)}>
        ${error(errors.myPhone)}
      </label>
      <label class="field">
        <span class="field__label">Send my daily reminder to</span>
        <select name="reminderTo"${invalid(errors.reminderTo)}>${sendToOptions(values.reminderTo, groups, { self: "This WhatsApp — the linked phone", direct: "My number (below)", none: "Nowhere — no reminder" })}</select>
        ${error(errors.reminderTo)}
      </label>
    </div>
    <div class="field-row">
      <label class="field">
        <span class="field__label">Reminder at</span>
        <input type="time" name="reminderTime" value="${values.reminderTime}" required${invalid(errors.reminderTime)}>
        ${error(errors.reminderTime)}
      </label>
      <label class="field">
        <span class="field__label">Days ahead</span>
        <input type="number" name="daysAhead" value="${values.daysAhead}" min="0" max="30" required${invalid(errors.daysAhead)}>
        ${error(errors.daysAhead)}
      </label>
    </div>
    <p class="hint">Before the wishes go out, the reminder lists every wish of the day — its time, where it goes, what it says — and the birthdays and anniversaries this many days ahead. “This WhatsApp” puts it in the linked phone’s own chat (Message yourself). Previews go to your number, or to the linked phone if you leave it empty.</p>
  </fieldset>

  <fieldset class="settings-group" id="calendar">
    <legend>Calendar</legend>
    <label class="field field--short">
      <span class="field__label">Send my calendar messages to</span>
      <select name="calendarTo"${invalid(errors.calendarTo)}>${sendToOptions(values.calendarTo, groups, { self: "This WhatsApp — the linked phone", direct: "My number (above)", none: "Nowhere — no calendar messages" })}</select>
      ${error(errors.calendarTo)}
    </label>
    <p class="hint">At the reminder time, “Your day” lists the day’s events, the tasks due, and tomorrow’s events — on days that have any. An event with a reminder gets a message of its own at that time. They go apart from the wishes’ reminder; choose a group only if everyone in it may read them.</p>
    <label class="field field--short">
      <span class="field__label">Remind me before each new event</span>
      <select name="defaultRemind"${invalid(errors.defaultRemind)}>${selectOptions([["", "No reminder"], ...REMINDERS], values.defaultRemind ?? "")}</select>
      ${error(errors.defaultRemind)}
      <span class="hint">Events added from WhatsApp get it, and an event you add here starts with it. Change it on any event.</span>
    </label>
    <label class="field field--short">
      <span class="field__label">A reminder without a time goes at</span>
      <input type="time" name="morningTime" value="${values.morningTime}"${invalid(errors.morningTime)}>
      ${error(errors.morningTime)}
      <span class="hint">“remind me to call Renjith” on WhatsApp: the next morning at this time — unless it says when.</span>
    </label>
    <input type="hidden" name="captureShown" value="1">
    <label class="check check--big"><input type="checkbox" name="capture" value="1"${values.capture ? raw(" checked") : ""}> <span><strong>Add to the calendar from WhatsApp</strong><br><span class="hint">A message that starts with 📅, in a chat ticked below, goes on the calendar: <code>📅 Dentist Tue 10am</code>, <code>📅 Trip 10-13 Oct</code>, <code>📅 task Pay rent by Fri</code> — or a reply of 📅 to a message, to add what it says. One that starts with <strong>📝</strong> is written on that day’s journal page, with the time. The answers go where calendar messages go.</span></span></label>
    ${capturePicks(values, groups, claudeModel, claudeStatus)}
  </fieldset>

  <fieldset class="settings-group" id="alerts">
    <legend>Alerts</legend>
    <label class="field field--short">
      <span class="field__label">When a wish is not sent, tell</span>
      <select name="alertTo"${invalid(errors.alertTo)}>${sendToOptions(values.alertTo, groups, { self: "This WhatsApp — the linked phone", direct: "My number (above)", none: "No one — no alerts" })}</select>
      ${error(errors.alertTo)}
    </label>
    <p class="hint">An alert says which wish was not sent, and why: as soon as WhatsApp refuses one, or the next morning, at the reminder time, when a day ended while this computer was off or asleep or WhatsApp was not connected. While WhatsApp is not connected, alerts wait for it too. They come from the linked number, so sent to that number itself they land in Message yourself without a notification; in a group, everyone there sees them.</p>
    <div class="form__actions">
      <button type="submit" form="test-alert" class="button button--quiet button--small" data-confirm="Send a test alert now, to where alerts go as last saved?">Send a test alert</button>
      <span class="hint">Goes where alerts go, as last saved.</span>
    </div>
  </fieldset>

  <fieldset class="settings-group">
    <legend>Time and numbers</legend>
    <div class="field-row">
      <label class="field">
        <span class="field__label">Time zone</span>
        <select name="timezone">${selectOptions(timeZones.map((z) => [z, z.replaceAll("_", " ")]), values.timezone)}</select>
      </label>
      <label class="field">
        <span class="field__label">Country code for numbers without one</span>
        <input name="countryCode" value="${values.countryCode}" inputmode="numeric" maxlength="4" autocomplete="off"${invalid(errors.countryCode)}>
        ${error(errors.countryCode)}
      </label>
    </div>
    <p class="hint">If this computer is off or asleep at the set times, the day’s messages go out when it is back — later that day, never twice.</p>
  </fieldset>

  <div class="form__actions"><button type="submit" class="button">Save changes</button></div>
</form>
<form method="post" action="/settings/test-alert" id="test-alert" hidden></form>

<section class="card" id="password" aria-labelledby="password-title">
  <h2 class="settings-title" id="password-title">Password</h2>
  <form method="post" action="/settings/password" class="form">
    <div class="field-row">
      <label class="field">
        <span class="field__label">Current password</span>
        <input type="password" name="current" autocomplete="current-password" required>
      </label>
      <label class="field">
        <span class="field__label">New password <span class="optional">${MIN_PASSWORD}+ characters</span></span>
        <input type="password" name="next" autocomplete="new-password" minlength="${MIN_PASSWORD}" maxlength="${MAX_PASSWORD}" required>
      </label>
      <label class="field">
        <span class="field__label">New password again</span>
        <input type="password" name="again" autocomplete="new-password" minlength="${MIN_PASSWORD}" maxlength="${MAX_PASSWORD}" required>
      </label>
    </div>
    <div class="form__actions"><button type="submit" class="button">Change password</button></div>
    <p class="hint">Changing it signs out every other browser. Forgot it? On the computer that runs the app, run <code>bash scripts/reset-password.sh</code> — then sign in with ADMIN_PASSWORD from its .env file.</p>
  </form>
</section>`,
  });
}
