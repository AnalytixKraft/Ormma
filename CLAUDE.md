# Working in this repo

## Agents never send WhatsApp messages

**No agent sends a WhatsApp message — not to test, not "just once".** Only
the app's own scheduler sends, at the times its owner set. The bridge acts as
a real WhatsApp account that belongs to someone, and whatever it sends reaches
real people.

So, against a running app or bridge, an agent never:

- calls the bridge's `POST /send`;
- presses **Send today's messages now**, **Retry now**, **Send me a preview**,
  **Send a test alert**, or any other button that sends;
- turns **Send messages** on in Settings;
- does anything else that makes WhatsApp deliver a message.

Reading is fine: the bridge's `GET /status` and `GET /healthz`,
`docker compose logs`, the database. Never `POST /commands/ack` against a
running bridge: the app's poller takes the owner's 📅 messages that way, and
anything else that takes them takes them off the calendar. Linking a phone (`POST /pair`) sends
nothing, but is only for a bridge that is `idle`, and only when a person asks.

Code that sends is tested against fakes that reach no one: the fake bridges in
`app/test/`, the demo's stub bridge (`node scripts/demo/run.mjs`), or a stub
server with the app run outside Docker and `BRIDGE_URL` pointing at it — never
the `whatsapp` container. If checking a change seems to
need a real message, stop and ask a person to send it: say what to click and
what to look for.

The rule exists because it was broken once: an agent "checking" `/send`
against a bridge it believed was unlinked posted a real message from its
owner's number to a stranger.

## The Claude API key

`ANTHROPIC_API_KEY` (and `ANTHROPIC_WORKSPACE_ID`) live in `.env`, like the
other secrets: never print them, log them, or put them in a commit, a test or
a page. Tests use stand-in clients (`app/test/claude.test.mjs`); a real call,
when one is needed to check the request, carries made-up text only — never
anyone's messages.

## Where things are

- `app/` — the pages, the database and the scheduler. Tests:
  `cd app && npm ci && npm test`.
- `whatsapp/` — the bridge, the one piece that acts as a WhatsApp account.
  Read [`whatsapp/README.md`](whatsapp/README.md) before changing it: anything
  that widens what it can do widens what a ban or a leaked token can cost.
- `desktop/` — the Mac and Windows app: the launcher (`desktop/launcher.mjs`),
  the native front door (`desktop/shim/`), and the build (`node
  desktop/build.mjs`). Tests: `cd desktop && npm test`. Try a build only on its
  own data folder and ports (`ORMMA_HOME`, `ORMMA_LOGS`, `ORMMA_LABEL`, and
  `APP_PORT`/`BRIDGE_PORT` in its `ormma.env`) — never on the live instance's.
- [`README.md`](README.md) and [`docs/`](docs/) — installing, the user guide,
  working on it; `scripts/` — setup, backup, restore; `scripts/demo/` — the
  demo (made-up data, a stub bridge) and the screenshots.
