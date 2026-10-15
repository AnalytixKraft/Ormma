# Working on Ormma

How the code is laid out, how to try it without WhatsApp, and how the desktop downloads are built and released. Start with [CONTRIBUTING.md](../CONTRIBUTING.md) — above all its first rule: **nothing you run while working on Ormma may send a WhatsApp message.**

- [The code](#the-code)
- [Tests](#tests)
- [The demo: Ormma without WhatsApp](#the-demo-ormma-without-whatsapp)
- [Screenshots](#screenshots)
- [The desktop app](#the-desktop-app)
- [Building the downloads](#building-the-downloads)
- [Releasing](#releasing)

## The code

| | |
|---|---|
| `app/` | The pages, the database and the scheduler: plain Node 24 (`node:http`, `node:sqlite`, `node:test`), with one dependency to draw the QR code and the Anthropic SDK for the optional Claude reader. Each area's handlers are in `app/src/routes/`, its pages in `app/src/views/`. |
| `whatsapp/` | The bridge — the one piece that acts as a WhatsApp account, built on [Baileys](https://github.com/WhiskeySockets/Baileys). Read [its README](../whatsapp/README.md) before changing it: anything that widens what it can do widens what a ban or a leaked token can cost. |
| `desktop/` | The desktop app: the launcher, the native front door, the icons and the build ([below](#the-desktop-app)). |
| `scripts/` | Setting up, backing up and restoring a copy run from source; `scripts/native/` runs it under launchd on a Mac; `scripts/demo/` is [the demo](#the-demo-ormma-without-whatsapp). |
| `docker-compose.yml` | The app and the bridge in Docker, and an optional Cloudflare tunnel. |

The pages are rendered on the server; `app/public/app.js` only adds confirmations, the list filter, reading an uploaded file, the live wish preview, QR refresh, the notebook's ⌘ + Enter and unsaved-writing warning, and the calendar's month strip on a phone.

The pages are drawn as a bound diary — the green cover with the gold stamp, the ribbon that marks the open section, the day printed as a diary prints it — in `app/public/style.css`, with no web fonts: Superclarendon, Charter, Gill Sans and Malayalam MN ship with macOS and iOS, and elsewhere the stacks fall back. The icon, `app/public/favicon.svg`, is the Malayalam ഓ as outlines (taken from Malayalam MN with CoreText) on a diary cover; `apple-touch-icon.png` and `icon-512.png` are rendered from it on a Mac with `qlmanage -t -s 1024` and `sips`, and the desktop app's icons by `desktop/icons/make-icons.mjs`.

Every page but sign-in needs the session cookie, every form post must come from the app's own pages, and the Content-Security-Policy allows no inline script and nothing from other sites. Both parts listen on 127.0.0.1 only (in Docker, the compose network is the fence), and every call to the bridge but `/healthz` needs its token.

## Tests

```bash
cd app && npm ci && npm test
```

```bash
cd whatsapp && npm ci && npm test
```

```bash
cd desktop && npm test
```

CI runs all three on every pull request, and builds and tries the desktop app on a Mac and on Windows (`.github/workflows/`).

Test anything that sends against a fake bridge, never a linked one: the tests' fakes in `app/test/`, the [demo](#the-demo-ormma-without-whatsapp)'s stub, or the app run outside Docker with `BRIDGE_URL` pointing at a stub of your own:

```bash
cd app && BRIDGE_URL=http://127.0.0.1:3999 BRIDGE_TOKEN=… ADMIN_PASSWORD=… SESSION_SECRET=… DATA_DIR=./data PORT=3211 npm start
```

Test data uses made-up names, and phone numbers from Ofcom's range for drama, **+44 7700 900000–900999**, which reach no one.

## The demo: Ormma without WhatsApp

```bash
node scripts/demo/run.mjs
```

That fills a new database with made-up people, events, tasks, notes and journal pages, starts a **stub bridge** in place of WhatsApp, and starts the app on it: open <http://127.0.0.1:3290> and sign in with `ormma-demo`. Every page works, Send buttons included — the stub answers as a linked WhatsApp would, in four made-up groups, and keeps what it is sent in memory, where it reaches no one. Ctrl+C stops both, and the database goes with them.

- `--state pairing` shows *Link a phone* with a QR code; `--state idle` starts unlinked, and the stub “scans” its own code a few seconds after *Link a phone*.
- `--port` and `--stub-port` move it (3290 and 3291 by default); `--data-dir <new folder>` keeps the database; `--password` changes the password.

It refuses to start if it would talk to anything but its own stub — the ports of a real Ormma (3210, 3000), a `BRIDGE_URL` in your shell, or anything already answering on its ports.

## Screenshots

The pictures in `docs/screenshots/` are of the demo, taken by headless Google Chrome over the DevTools protocol — no packages to install:

```bash
node scripts/demo/screenshots.mjs --start-demo
```

That starts its own demo (and the desktop app's first-run page, for `first-run.png`), takes every shot, and stops them. `--only today,people` takes some. The shots are a table at the top of `scripts/demo/screenshots.mjs` — add a row for one more. Chrome draws a time field the way the Mac is set, 12-hour or 24-hour, and the fonts are the Mac's: take them on a Mac.

## The desktop app

The downloads are the same app and bridge, with their own Node, and a launcher that does what `scripts/setup.sh`, `scripts/native/` and launchd do for a copy run from source:

| | |
|---|---|
| `desktop/launcher.mjs` | What the icon runs: start Ormma if it is not running and open the browser; and `serve`, `stop`, `restart`, `status`, `backup`, `restore`, `reset-password`, `uninstall` ([the commands](install.md#ormmas-commands)). Opening a newer version stops the older one. |
| `desktop/lib/service.mjs` | Ormma itself as the desktop app runs it (`serve`): runs once (`control.mjs`), shows the first-run page until there is a password (`first-run.mjs`), then keeps the bridge and the app running, each with only the settings it needs, each with its own log; stops the app before the bridge. |
| `desktop/lib/first-run.mjs` | *Choose a password*, on Ormma's own port before the app starts. It stores the password as Settings → Password would, and signs you in with the app's own cookie. It answers only on 127.0.0.1, only to a Host of localhost, and only to forms from itself. |
| `desktop/lib/settings.mjs` | `ormma.env`, the desktop app's `.env`, made on the first run. |
| `desktop/lib/system.mjs` | Starting at sign-in (a launchd agent on a Mac, the Run key on Windows), messages in a window, opening the browser. |
| `desktop/shim/` | The native front door, in Go: `Ormma.app/Contents/MacOS/Ormma` and `Ormma.exe`. It finds the bundled Node beside it and hands over to the launcher — on a Mac it becomes Node (launchd watches the process it started); on Windows it runs it with no console window. |
| `desktop/icons/` | The icons, made from the app's favicon by `make-icons.mjs` (on a Mac). |
| `desktop/windows/installer.nsi` | The Windows installer (NSIS): per user, no administrator; Start menu, Run key, an entry in Settings → Apps; uninstalling keeps the data. |
| `desktop/test/` | Unit tests, and the smoke tests CI runs on the built downloads. |

The app shows its desktop hints — `ormma.env` rather than `.env`, `Ormma reset-password` rather than `scripts/reset-password.sh` — when the launcher says so (`app/src/desktop.mjs`). On Windows, the launcher stops the app and the bridge over an IPC channel (there are no signals to send), and each stops on its own when the launcher is gone.

To run the launcher from a clone, on another data folder and other ports, beside any Ormma you already have:

```bash
mkdir -p /tmp/ormma-try && printf 'APP_PORT=3296\nBRIDGE_PORT=3297\n' > /tmp/ormma-try/ormma.env
```

```bash
ORMMA_HOME=/tmp/ormma-try ORMMA_LOGS=/tmp/ormma-try/logs node desktop/launcher.mjs serve
```

Its bridge has no WhatsApp link until you link one; leave it that way unless the number is yours to test with.

## Building the downloads

```bash
node desktop/build.mjs
```

That makes `dist/Ormma-<version>-mac.dmg` (universal: Apple silicon and Intel) and `dist/Ormma-<version>-windows-setup.exe`, with their SHA-256 sums. `--mac` or `--windows` makes one. The version is `desktop/package.json`'s.

It needs Node 24 with npm, and [Go](https://go.dev/dl/) for the front door. The Mac app is built on a Mac (`lipo`, `codesign`, `hdiutil`); the Windows installer anywhere with NSIS — `brew install makensis`, `apt install nsis`, or `choco install nsis`. It downloads the Node it bundles from nodejs.org, checks it against nodejs.org's SHA-256 sums, and keeps it in `desktop/.cache`; and it runs [go-winres](https://github.com/tc-hib/go-winres) to give `Ormma.exe` its icon.

Then try them:

```bash
bash desktop/test/smoke-mac.sh dist/Ormma-*-mac.dmg
```

That opens the disk image, runs the app on its own data folder and spare ports, chooses a password on the first-run page, checks the app and the bridge answer, and stops it. `desktop/test/smoke-windows.ps1` does the same on Windows — but it installs for real, for the Windows account it runs as, so it is for CI or a spare machine.

### Signing

Unsigned, macOS and Windows warn before opening Ormma the first time ([what people see](install.md#on-a-mac)). To sign:

- **Mac**: with an Apple Developer ID certificate in the keychain, `MAC_SIGN_IDENTITY="Developer ID Application: …"` signs the app with the hardened runtime (`desktop/mac/entitlements.plist`), and `MAC_NOTARY_PROFILE=<profile>` — a profile saved with `xcrun notarytool store-credentials` — has Apple notarize the disk image, then staples it. Notarized, it opens with no warning.
- **Windows**: sign `Ormma.exe` and the installer with a code-signing certificate (`signtool`, or a cloud signing service) after the build. Not yet scripted.

## Releasing

1. Set the version in `desktop/package.json`, and add it to [CHANGELOG.md](../CHANGELOG.md) as `## <version> — <date>`, with what changed.
2. Merge that to `main`.
3. Tag it, and push the tag:

```bash
git tag v1.0.0
```

```bash
git push origin v1.0.0
```

`.github/workflows/release.yml` builds and tries both downloads and makes a **draft** release with them, their sums, and that part of the changelog. Read it over on GitHub — download each, open it once — then press **Publish**. The README's download links point at the latest published release.
