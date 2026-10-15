/* Builds the desktop app: Ormma with its own Node, for people who will not
 * install Node, Docker or git to use it.
 *
 *   node desktop/build.mjs              both
 *   node desktop/build.mjs --mac        dist/Ormma-<version>-mac.dmg
 *   node desktop/build.mjs --windows    dist/Ormma-<version>-windows-setup.exe
 *
 * The version is desktop/package.json's. What it needs:
 *
 *   both       Node 24 and npm; Go (desktop/shim, the native front door)
 *   --mac      a Mac: lipo, codesign, hdiutil
 *   --windows  makensis — brew install makensis, apt install nsis, or
 *              choco install nsis — on any computer
 *
 * It downloads the Node it bundles from nodejs.org — darwin-arm64,
 * darwin-x64 and win-x64 — checks each against nodejs.org's SHA-256 sums,
 * and keeps them in desktop/.cache. The app's own packages are pure
 * JavaScript, so one `npm ci` serves both. The Mac app is universal (Apple
 * silicon and Intel). Signing, when the environment says how:
 *
 *   MAC_SIGN_IDENTITY   "Developer ID Application: …" from this keychain;
 *                       without it the app is signed ad hoc, and macOS asks
 *                       before opening it the first time (docs/install.md)
 *   MAC_NOTARY_PROFILE  an `xcrun notarytool store-credentials` profile:
 *                       the .dmg is notarized and stapled
 *   ORMMA_NODE_VERSION  another Node 24 to bundle */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const DIST = join(REPO, "dist");
const WORK = join(DIST, "build");
const CACHE = join(HERE, ".cache");
const VERSION = JSON.parse(readFileSync(join(HERE, "package.json"), "utf8")).version;
// A month old when chosen: new enough for its fixes, old enough to have
// shown its problems. Node 24 is LTS until April 2028.
const NODE_VERSION = process.env.ORMMA_NODE_VERSION || "24.21.0";
const BUNDLE_ID = "tech.analytixkraft.ormma";
const GO_WINRES = "github.com/tc-hib/go-winres@v0.3.3";

const args = process.argv.slice(2);
const wantMac = args.includes("--mac") || !args.includes("--windows");
const wantWindows = args.includes("--windows") || !args.includes("--mac");

const say = (line) => console.log(`build: ${line}`);
const run = (command, argv, options = {}) => execFileSync(command, argv, { stdio: "inherit", ...options });
const sha256 = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const fresh = (dir) => {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
};

/* ------------------------------------------------------------- Node */

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

let sums = null;
/* nodejs.org's archive for one platform, downloaded once and checked. */
async function nodeArchive(name) {
  const base = `https://nodejs.org/dist/v${NODE_VERSION}`;
  const dir = join(CACHE, `node-v${NODE_VERSION}`);
  mkdirSync(dir, { recursive: true });
  if (!sums) {
    const file = join(dir, "SHASUMS256.txt");
    if (!existsSync(file)) await download(`${base}/SHASUMS256.txt`, file);
    sums = new Map(readFileSync(file, "utf8").trim().split("\n").map((line) => line.trim().split(/\s+/).reverse()));
  }
  const file = join(dir, name);
  if (!existsSync(file)) {
    say(`downloading ${base}/${name}`);
    await download(`${base}/${name}`, file);
  }
  const want = sums.get(name);
  if (!want || sha256(file) !== want) {
    rmSync(file, { force: true });
    throw new Error(`${name} does not match nodejs.org's SHA-256 sum — removed it; run again to download it afresh`);
  }
  return file;
}

/* `inside` (a path in the archive) out of a Node archive, into `to`. */
function extract(archive, inside, to) {
  const dir = fresh(join(WORK, "extract"));
  if (archive.endsWith(".zip")) run("unzip", ["-q", archive, inside, "-d", dir]);
  else run("tar", ["-xzf", archive, "-C", dir, inside]);
  mkdirSync(dirname(to), { recursive: true });
  cpSync(join(dir, inside), to);
  return to;
}

/* ---------------------------------------------------------- the app */

/* The files that run, shared by the Mac and Windows builds: the app, the
 * bridge and the launcher, each with its packages. Tests, scripts, Docker
 * files and TypeScript's leftovers stay behind. */
function payload() {
  const out = fresh(join(WORK, "payload"));
  const copy = (from, to = from) => cpSync(join(REPO, from), join(out, to), { recursive: true });
  for (const name of ["package.json", "package-lock.json", "src", "public"]) copy(`app/${name}`);
  for (const name of ["package.json", "package-lock.json", "src"]) copy(`whatsapp/${name}`);
  for (const name of ["package.json", "launcher.mjs", "lib", "public"]) copy(`desktop/${name}`);
  copy("LICENSE");
  say("installing the app's and the bridge's packages");
  const npm = (dir, extra = []) =>
    run("npm", ["ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error", ...extra], { cwd: join(out, dir) });
  npm("app");
  npm("whatsapp", ["--omit=peer"]);
  prune(out);
  return out;
}

function prune(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === ".bin") rmSync(path, { recursive: true, force: true });
      else prune(path);
    } else if (/\.(d\.ts|d\.mts|d\.cts|map)$/.test(entry.name) && path.includes("node_modules")) {
      rmSync(path, { force: true });
    }
  }
}

/* desktop/shim, built for one platform. */
function shim({ goos, goarch, out, gui = false, resources = null }) {
  const src = fresh(join(WORK, `shim-${goos}-${goarch}`));
  cpSync(join(HERE, "shim"), src, { recursive: true });
  if (resources) resources(src);
  const ldflags = ["-s", "-w", ...(gui ? ["-H=windowsgui"] : [])].join(" ");
  run("go", ["build", "-trimpath", "-ldflags", ldflags, "-o", out, "."], { cwd: src, env: { ...process.env, GOOS: goos, GOARCH: goarch, CGO_ENABLED: "0" } });
  return out;
}

const plistEscape = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

function infoPlist() {
  const entries = {
    CFBundleDevelopmentRegion: "en",
    CFBundleDisplayName: "Ormma",
    CFBundleExecutable: "Ormma",
    CFBundleIconFile: "Ormma",
    CFBundleIdentifier: BUNDLE_ID,
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: "Ormma",
    CFBundlePackageType: "APPL",
    CFBundleShortVersionString: VERSION,
    CFBundleVersion: VERSION,
    LSApplicationCategoryType: "public.app-category.productivity",
    // Node 24's own minimum.
    LSMinimumSystemVersion: "13.5",
    NSHumanReadableCopyright: "Ormma · AnalytixKraft · MIT License",
  };
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${Object.entries(entries).map(([key, value]) => `  <key>${key}</key><string>${plistEscape(value)}</string>`).join("\n")}
  <!-- No Dock icon: opening Ormma starts it in the background and opens
       the browser; the program the icon runs is done in a second. -->
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
`;
}

/* ---------------------------------------------------------------- Mac */

async function buildMac(files) {
  if (process.platform !== "darwin") throw new Error("the Mac app is built on a Mac (lipo, codesign, hdiutil)");
  say("the Mac app");
  const work = fresh(join(WORK, "mac"));
  const app = join(work, "Ormma.app", "Contents");
  mkdirSync(join(app, "MacOS"), { recursive: true });
  mkdirSync(join(app, "Resources"), { recursive: true });

  // One Node for both kinds of Mac.
  const arm = extract(await nodeArchive(`node-v${NODE_VERSION}-darwin-arm64.tar.gz`), `node-v${NODE_VERSION}-darwin-arm64/bin/node`, join(work, "node-arm64"));
  const intel = extract(await nodeArchive(`node-v${NODE_VERSION}-darwin-x64.tar.gz`), `node-v${NODE_VERSION}-darwin-x64/bin/node`, join(work, "node-x64"));
  run("lipo", ["-create", "-output", join(app, "MacOS", "ormma-node"), arm, intel]);
  extract(await nodeArchive(`node-v${NODE_VERSION}-darwin-arm64.tar.gz`), `node-v${NODE_VERSION}-darwin-arm64/LICENSE`, join(app, "Resources", "licenses", "node.txt"));

  const shims = ["arm64", "amd64"].map((goarch) => shim({ goos: "darwin", goarch, out: join(work, `shim-${goarch}`) }));
  run("lipo", ["-create", "-output", join(app, "MacOS", "Ormma"), ...shims]);
  for (const exe of ["Ormma", "ormma-node"]) chmodSync(join(app, "MacOS", exe), 0o755);

  cpSync(files, join(app, "Resources"), { recursive: true });
  cpSync(join(HERE, "icons", "ormma.icns"), join(app, "Resources", "Ormma.icns"));
  writeFileSync(join(app, "Info.plist"), infoPlist());
  writeFileSync(join(app, "PkgInfo"), "APPL????");

  // Node first — code inside the bundle is signed before the bundle is.
  const identity = process.env.MAC_SIGN_IDENTITY || "-";
  const sign = (target, extra = []) =>
    run("codesign", ["--force", "--sign", identity, ...(identity === "-" ? [] : ["--options", "runtime", "--timestamp", ...extra]), target]);
  sign(join(app, "MacOS", "ormma-node"), ["--entitlements", join(HERE, "mac", "entitlements.plist")]);
  sign(join(work, "Ormma.app"));
  run("codesign", ["--verify", "--strict", "--deep", join(work, "Ormma.app")]);
  say(identity === "-" ? "signed ad hoc (no MAC_SIGN_IDENTITY)" : `signed as ${identity}`);

  // The disk image: the app, and Applications to drag it onto.
  const image = fresh(join(work, "dmg"));
  run("ditto", [join(work, "Ormma.app"), join(image, "Ormma.app")]);
  symlinkSync("/Applications", join(image, "Applications"));
  const dmg = join(DIST, `Ormma-${VERSION}-mac.dmg`);
  rmSync(dmg, { force: true });
  run("hdiutil", ["create", "-quiet", "-volname", "Ormma", "-fs", "HFS+", "-format", "ULMO", "-srcfolder", image, dmg]);
  if (identity !== "-") run("codesign", ["--sign", identity, "--timestamp", dmg]);
  if (process.env.MAC_NOTARY_PROFILE) {
    run("xcrun", ["notarytool", "submit", dmg, "--keychain-profile", process.env.MAC_NOTARY_PROFILE, "--wait"]);
    run("xcrun", ["stapler", "staple", dmg]);
  }
  return dmg;
}

/* ------------------------------------------------------------ Windows */

async function buildWindows(files) {
  say("the Windows installer");
  const work = fresh(join(WORK, "windows"));
  const root = join(work, "Ormma");
  mkdirSync(root, { recursive: true });

  const zip = await nodeArchive(`node-v${NODE_VERSION}-win-x64.zip`);
  extract(zip, `node-v${NODE_VERSION}-win-x64/node.exe`, join(root, "node", "ormma-node.exe"));
  extract(zip, `node-v${NODE_VERSION}-win-x64/LICENSE`, join(root, "licenses", "node.txt"));

  // Ormma.exe, with its icon and version — go-winres writes them as a .syso
  // the Go linker takes in. Without it (offline, say) it still works, with
  // Windows' plain program icon.
  shim({
    goos: "windows",
    goarch: "amd64",
    gui: true,
    out: join(root, "Ormma.exe"),
    resources(src) {
      try {
        run(
          "go",
          [
            "run", GO_WINRES, "simply",
            "--arch", "amd64",
            "--icon", join(HERE, "icons", "ormma.ico"),
            "--manifest", "gui",
            "--product-name", "Ormma",
            "--product-version", VERSION,
            "--file-version", VERSION,
            "--file-description", "Ormma",
            "--copyright", "AnalytixKraft · MIT License",
            "--original-filename", "Ormma.exe",
          ],
          { cwd: src },
        );
      } catch {
        say("go-winres did not run: Ormma.exe gets no icon of its own");
      }
    },
  });

  cpSync(files, root, { recursive: true });
  rmSync(join(root, "LICENSE"));
  writeFileSync(join(root, "LICENSE.txt"), readFileSync(join(REPO, "LICENSE"), "utf8").replace(/\r?\n/g, "\r\n"));
  cpSync(join(HERE, "icons", "ormma.ico"), join(root, "ormma.ico"));

  const longest = walk(root).reduce((a, b) => (relative(root, b).length > relative(root, a).length ? b : a));
  say(`longest path inside: ${relative(root, longest).length} characters (Windows' old limit is 260 with the install folder)`);

  const exe = join(DIST, `Ormma-${VERSION}-windows-setup.exe`);
  rmSync(exe, { force: true });
  run("makensis", [
    "-V2",
    "-INPUTCHARSET", "UTF8",
    `-DVERSION=${VERSION}`,
    `-DSOURCE=${root}`,
    `-DICON=${join(HERE, "icons", "ormma.ico")}`,
    `-DOUTFILE=${exe}`,
    join(HERE, "windows", "installer.nsi"),
  ], {
    // makensis reads the script through the locale: in the C locale an em
    // dash is "Bad text encoding".
    env: { ...process.env, LC_ALL: process.platform === "darwin" ? "en_US.UTF-8" : "C.UTF-8" },
  });
  return exe;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]));
}

/* --------------------------------------------------------------- go */

mkdirSync(DIST, { recursive: true });
say(`Ormma ${VERSION}, with Node ${NODE_VERSION}`);
const files = payload();
const built = [];
if (wantMac) built.push(await buildMac(files));
if (wantWindows) built.push(await buildWindows(files));
const lines = built.map((file) => `${sha256(file)}  ${file.split("/").pop()}`);
writeFileSync(join(DIST, `SHA256SUMS-${VERSION}.txt`), `${lines.join("\n")}\n`);
for (const file of built) say(`${relative(REPO, file)} — ${(statSync(file).size / 1024 / 1024).toFixed(1)} MB`);
