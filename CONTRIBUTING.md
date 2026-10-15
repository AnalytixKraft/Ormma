# Contributing to Ormma

Thank you for wanting to help. Ormma is small, and meant to stay that way: a diary, a calendar and the people to remember, on one computer, with WhatsApp as the way in and out. Bug reports, fixes, translations of the docs, and ideas that fit that are all welcome.

## Three rules first

1. **Nothing you run while working on Ormma may send a WhatsApp message** — not to test, not “just once”. A linked bridge acts as a real person's WhatsApp account, and what it sends reaches real people. Test anything that sends against a fake: the fakes in `app/test/`, or [the demo](docs/building.md#the-demo-ormma-without-whatsapp), whose stub bridge reaches no one. If checking a change seems to need a real message, say so in the pull request, and say what to click and what to look for: a maintainer will try it on a number that is theirs to test with.
2. **No real people in the repo, in issues, or in pull requests.** Tests, examples and screenshots use made-up names, and phone numbers from Ofcom's range for drama, +44 7700 900000–900999. When you paste a log into an issue, take out names, numbers and the text of messages first — and never paste `.env`, `ormma.env`, or anything from the `whatsapp` data folder: those are live credentials.
3. **Read [`whatsapp/README.md`](whatsapp/README.md) before changing the bridge.** Anything that widens what it can do widens what a ban or a leaked token can cost.

## Getting started

```bash
git clone https://github.com/AnalytixKraft/Ormma.git
```

```bash
cd Ormma/app && npm ci && npm test
```

```bash
node ../scripts/demo/run.mjs
```

That last one is Ormma with made-up data and no WhatsApp, at <http://127.0.0.1:3290> (password `ormma-demo`). [docs/building.md](docs/building.md) has the rest: how the code is laid out, the other tests, the screenshots, and the desktop app.

## Pull requests

- One change per pull request, with tests for what it changes. `npm test` in `app/`, `whatsapp/` and `desktop/` must pass; CI runs them, and builds and tries the desktop app on a Mac and on Windows.
- Write like the code around it: plain Node, no new dependency without a good reason, and comments that say *why*. Pages are rendered on the server; the browser gets no inline script and nothing from other sites.
- Words on the pages are plain and exact: say what happens, in the order it happens, as you would to someone who does not know how it works.
- Keep the look: the bound diary in `app/public/style.css` — the green cover, the ribbon, the day printed in two scripts — with the fonts that ship with the computer, and no web fonts.
- If the change shows on a page, add a screenshot to the pull request; if it changes a picture in the docs, retake it (`node scripts/demo/screenshots.mjs --start-demo --only <name>`).
- If it changes what someone does, change the docs with it: [the user guide](docs/guide.md), [the install guide](docs/install.md), and [CHANGELOG.md](CHANGELOG.md) under *Unreleased*.

## Licence

Ormma is MIT licensed. By sending a pull request, you agree that what you contribute is under the same licence.
