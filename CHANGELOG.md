# Changelog

What changed in each release of Ormma. The desktop downloads are on the [releases page](https://github.com/AnalytixKraft/Ormma/releases).

## Unreleased

## 1.0.0 — 2026-10-15

The first release with downloads for Mac and Windows.

- **The desktop app**: Ormma for Mac (a universal `.dmg`, Apple silicon and Intel) and for Windows (an installer that needs no administrator), with its own Node — nothing else to install. It starts when you sign in, starts itself again if it stops, and opens in your browser. The first page asks you to choose a password. `Ormma backup`, `restore`, `reset-password`, `stop` and `uninstall` do the rest; opening a newer version is the whole of an update.
- **A diary**: notes with #tags and search, notes about the people on your list, and a journal page for every day — written from WhatsApp too, with 📝 or `Notes:`, and read back with `show notes for yesterday`.
- **A calendar**: events, repeating or not, with reminders on WhatsApp; tasks; “Your day” each morning. Add to it from WhatsApp with 📅 — or, with a Claude API key, in your own words — and reply `delete` to take it off again.
- **Reminders that keep coming until done**: `remind me to call Renjith` — three days, then every other day for ten, until you reply `done`.
- **The people to remember**: birthdays and anniversaries, wished on WhatsApp at their time, in a group or to their own number; a morning reminder of every wish the day holds; an alert when one was not sent.
- **Documentation and screenshots**: an install guide, a user guide, and a demo with made-up data that needs no WhatsApp (`node scripts/demo/run.mjs`).
- The People table has room for a whole phone number, and for a time on a 12-hour clock.
