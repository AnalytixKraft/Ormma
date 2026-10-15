/* Ormma's icon, everywhere it is used, from one drawing: a leather-bound
 * diary with "Memory" stamped in gold, a quill on it, and a ribbon. Run on a
 * Mac — it sets the word with CoreText and draws with QuickLook, sips and
 * iconutil — after changing the drawing, and commit what it writes:
 *
 *   node desktop/icons/make-icons.mjs
 *
 *   app/public/favicon.svg           the drawing: the browser tab, the cover's
 *                                    mark, the sign-in page
 *   app/public/icon-512.png          the same, 512 px (the web manifest)
 *   app/public/apple-touch-icon.png  on paper, edge to edge, 180 px — iOS
 *                                    rounds the corners itself
 *   desktop/icons/ormma-mac.svg      the Mac icon's drawing: the diary on a
 *                                    paper tile, as recent macOS wants an icon
 *   desktop/icons/ormma.icns         the Mac icon, every size (Ormma.app)
 *   desktop/icons/ormma.ico          the Windows icon: the diary alone, every
 *                                    size (Ormma.exe, the installer, the Start
 *                                    menu)
 *
 * The word is outlines (glyphs.swift, from Baskerville SemiBold), not text:
 * it looks the same wherever the icon is drawn, font or no font. */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..", "app", "public");
const work = mkdtempSync(join(tmpdir(), "ormma-icons-"));

/* ------------------------------------------------------------ the word */

const WORD = "Memory";
const FONT = "Baskerville-SemiBold";
const [glyphs, advance] = execFileSync("swift", [join(HERE, "glyphs.swift"), FONT, WORD], { encoding: "utf8" }).trim().split("\t");
// Set 236 wide, its baseline where the cover's upper third ends.
const WORD_WIDTH = 236;
const scale = WORD_WIDTH / Number(advance);
const word = (x, y) => `translate(${x} ${y}) scale(${scale.toFixed(5)})`;

/* --------------------------------------------------------- the drawing */

// On a 512 grid. The cover: x 40–424, y 36–440; the quill crosses its right
// edge, the pages and the ribbon show below it.
const COVER = { x: 40, y: 36, w: 384, h: 404, r: 34 };

const defs = `
  <linearGradient id="leather" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ad6740"/>
    <stop offset="0.5" stop-color="#8c4828"/>
    <stop offset="1" stop-color="#673018"/>
  </linearGradient>
  <linearGradient id="back" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#6a3119"/>
    <stop offset="1" stop-color="#4a200e"/>
  </linearGradient>
  <linearGradient id="spine" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#4f2410"/>
    <stop offset="0.75" stop-color="#7a3c1f"/>
    <stop offset="1" stop-color="#5a2913"/>
  </linearGradient>
  <linearGradient id="pages" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fbf3df"/>
    <stop offset="1" stop-color="#dfcca6"/>
  </linearGradient>
  <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#fcebc4"/>
    <stop offset="1" stop-color="#d6ab6b"/>
  </linearGradient>
  <linearGradient id="vane" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#e8cf9f"/>
    <stop offset="0.45" stop-color="#fdf5e3"/>
    <stop offset="1" stop-color="#e2c48f"/>
  </linearGradient>
  <linearGradient id="ribbon" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#8a2c20"/>
    <stop offset="0.5" stop-color="#b9483a"/>
    <stop offset="1" stop-color="#8a2c20"/>
  </linearGradient>
  <radialGradient id="sheen" cx="0.28" cy="0.18" r="0.85">
    <stop offset="0" stop-color="#fff" stop-opacity="0.2"/>
    <stop offset="0.6" stop-color="#fff" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="fold" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3a1808" stop-opacity="0.45"/>
    <stop offset="1" stop-color="#3a1808" stop-opacity="0"/>
  </linearGradient>
  <clipPath id="cover"><rect x="${COVER.x}" y="${COVER.y}" width="${COVER.w}" height="${COVER.h}" rx="${COVER.r}"/></clipPath>`;

/* The quill, drawn pointing up from its nib at 0,0, then turned and set
 * down on the cover with its nib touching it. */
const quill = `
  <g transform="translate(318 352) rotate(36)">
    <path d="M-4 -2 L4 -2 L0 15 Z" fill="#3b2414"/>
    <path d="M-4.5 -2 L4.5 -2 L3 -70 L-3 -70 Z" fill="#ead8b2"/>
    <path d="M0 -62 C -27 -88 -42 -150 -32 -202 C -26 -234 -11 -254 0 -266 C 9 -249 23 -224 27 -191 C 31 -150 19 -100 0 -62 Z" fill="url(#vane)"/>
    <path d="M0 -96 L-24 -122 M0 -122 L-33 -152 M0 -150 L-35 -181 M0 -180 L-29 -210 M0 -210 L-18 -236 M0 -108 L17 -132 M0 -140 L24 -166 M0 -172 L24 -197 M0 -204 L17 -226" stroke="#c9a46c" stroke-width="2" stroke-linecap="round" opacity="0.75"/>
    <path d="M-2 -4 L2 -4 L0.8 -262 L-0.8 -262 Z" fill="#a9824f"/>
  </g>
  <path d="M327 365 C 305 377 268 381 259 371 C 253 364 264 357 279 362" fill="none" stroke="#e5c68e" stroke-width="3.5" stroke-linecap="round"/>`;

function diary() {
  const { x, y, w, h, r } = COVER;
  return `
  <rect x="${x}" y="${y + 30}" width="${w}" height="${h + 6}" rx="${r}" fill="url(#back)"/>
  <path d="M${x + 18} ${y + h - 24} H${x + w - 10} V${y + h + 18} Q${x + w - 10} ${y + h + 26} ${x + w - 20} ${y + h + 26} H${x + 28} Q${x + 18} ${y + h + 26} ${x + 18} ${y + h + 18} Z" fill="url(#pages)"/>
  <path d="M${x + 22} ${y + h + 9} H${x + w - 14} M${x + 22} ${y + h + 17} H${x + w - 16}" stroke="#ccb68b" stroke-width="2"/>
  <path d="M${x + 74} ${y + h - 6} H${x + 102} V${y + h + 58} L${x + 88} ${y + h + 46} L${x + 74} ${y + h + 58} Z" fill="url(#ribbon)"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="url(#leather)"/>
  <g clip-path="url(#cover)">
    <rect x="${x}" y="${y}" width="58" height="${h}" fill="url(#spine)"/>
    <rect x="${x + 58}" y="${y}" width="2.5" height="${h}" fill="#c27d52" opacity="0.8"/>
    <rect x="${x + 60.5}" y="${y}" width="3" height="${h}" fill="#3e1a0a" opacity="0.5"/>
    <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#sheen)"/>
    <rect x="${x}" y="${y + h - 10}" width="${w}" height="10" fill="url(#fold)" transform="rotate(180 ${x + w / 2} ${y + h - 5})"/>
  </g>
  <rect x="${x + 76}" y="${y + 16}" width="${w - 92}" height="${h - 32}" rx="20" fill="none" stroke="#e3b88e" stroke-width="3" stroke-dasharray="9 7" opacity="0.7"/>
  <path d="${glyphs}" transform="${word(x + 92, y + 196)}" fill="#3a1707" opacity="0.6"/>
  <path d="${glyphs}" transform="${word(x + 89.5, y + 191.5)}" fill="url(#gold)"/>${quill}`;
}

const svg = (body, { title = "Ormma", viewBox = "0 0 512 512", extraDefs = "" } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">
  <title>${title}</title>
  <defs>${defs}${extraDefs}
  </defs>${body}
</svg>
`;

const favicon = svg(diary());
writeFileSync(join(PUBLIC, "favicon.svg"), favicon);

// iOS: edge to edge, on paper; it rounds the corners.
const paper = `
  <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#f6f0e4"/>
    <stop offset="1" stop-color="#e6dcc8"/>
  </linearGradient>`;
const touchSvg = svg(`
  <rect width="512" height="512" fill="url(#paper)"/>
  <g transform="translate(50 42) scale(0.8)">${diary()}
  </g>`, { extraDefs: paper });

/* Apple's icon grid: a 1024 canvas, an 824 tile 100 in from each edge with
 * its corners rounded at about 185, and room around it for the shadow. */
const macSvg = svg(`
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#paper)" filter="url(#lift)"/>
  <g filter="url(#lift)"><g transform="translate(152 138) scale(1.4)">${diary()}
  </g></g>`, {
  viewBox: "0 0 1024 1024",
  extraDefs: `${paper}
  <filter id="lift" x="-20%" y="-20%" width="140%" height="140%">
    <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.28"/>
  </filter>`,
});
writeFileSync(join(HERE, "ormma-mac.svg"), macSvg);

/* ------------------------------------------------------------ the sizes */

/* An SVG drawn at 1024 × 1024, as PNG. */
function render(svgText, name) {
  const dir = join(work, name);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.svg`);
  writeFileSync(file, svgText);
  execFileSync("qlmanage", ["-t", "-s", "1024", "-o", dir, file], { stdio: "ignore" });
  return `${file}.png`;
}
const resized = (png, size, to) => {
  execFileSync("sips", ["-z", String(size), String(size), png, "--out", to], { stdio: "ignore" });
  return to;
};

const plain = render(favicon, "plain");
resized(plain, 512, join(PUBLIC, "icon-512.png"));
resized(render(touchSvg, "touch"), 180, join(PUBLIC, "apple-touch-icon.png"));

// The Mac icon: an iconset, every size at 1× and 2×, then iconutil.
const macPng = render(macSvg, "mac");
const iconset = join(work, "ormma.iconset");
mkdirSync(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  resized(macPng, size, join(iconset, `icon_${size}x${size}.png`));
  resized(macPng, size * 2, join(iconset, `icon_${size}x${size}@2x.png`));
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(HERE, "ormma.icns")]);

// The Windows icon: PNGs inside an .ico, which Windows reads since Vista.
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => readFileSync(resized(plain, size, join(work, `win-${size}.png`))));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // an icon
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  header.writeUInt8(size >= 256 ? 0 : size, entry); // 0 means 256
  header.writeUInt8(size >= 256 ? 0 : size, entry + 1);
  header.writeUInt8(0, entry + 2); // no palette
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4); // planes
  header.writeUInt16LE(32, entry + 6); // bits per pixel
  header.writeUInt32LE(images[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += images[i].length;
});
writeFileSync(join(HERE, "ormma.ico"), Buffer.concat([header, ...images]));

// A look at each, for whoever runs this.
renameSync(macPng, join(work, "ormma-mac-1024.png"));
renameSync(plain, join(work, "ormma-1024.png"));
rmSync(iconset, { recursive: true, force: true });
console.log(`made the icons — a look: ${join(work, "ormma-1024.png")} and ${join(work, "ormma-mac-1024.png")}`);
