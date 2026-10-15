/* The desktop app's icons, made from the app's own (app/public/favicon.svg)
 * so the two never drift apart. Run on a Mac — it draws with QuickLook,
 * sips and iconutil — after changing the icon, and commit what it writes:
 *
 *   node desktop/icons/make-icons.mjs
 *
 *   ormma-mac.svg  the Mac icon's drawing: the diary standing on a tile the
 *                  colour of the app's paper. Recent macOS sets an icon that
 *                  is not a rounded square on a grey tile of its own; this
 *                  is the tile it should have.
 *   ormma.icns     the Mac icon, every size (Ormma.app)
 *   ormma.ico      the Windows icon: the diary alone, every size (Ormma.exe,
 *                  the installer, the Start menu) */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const FAVICON = join(HERE, "..", "..", "app", "public", "favicon.svg");
const work = mkdtempSync(join(tmpdir(), "ormma-icons-"));

/* The favicon's drawing, without its own <svg> wrapper, to nest. */
const favicon = readFileSync(FAVICON, "utf8");
const inner = favicon.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title>[\s\S]*?<\/title>/, "");

/* Apple's icon grid: a 1024 canvas, an 824 tile 100 in from each edge with
 * its corners rounded at about 185, and room around it for the shadow. */
const macSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <title>Ormma</title>
  <defs>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fdfcf7"/>
      <stop offset="1" stop-color="#efeadb"/>
    </linearGradient>
    <filter id="lift" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="0.28"/>
    </filter>
  </defs>
  <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#paper)" filter="url(#lift)"/>
  <g filter="url(#lift)"><svg x="152" y="144" width="736" height="736" viewBox="0 0 64 64">${inner}</svg></g>
</svg>
`;
writeFileSync(join(HERE, "ormma-mac.svg"), macSvg);

/* An SVG drawn at 1024 × 1024, as PNG. */
function render(svgFile, name) {
  const out = join(work, name);
  mkdirSync(out, { recursive: true });
  execFileSync("qlmanage", ["-t", "-s", "1024", "-o", out, svgFile], { stdio: "ignore" });
  return join(out, `${svgFile.split("/").pop()}.png`);
}
const resized = (png, size, to) => {
  execFileSync("sips", ["-z", String(size), String(size), png, "--out", to], { stdio: "ignore" });
  return to;
};

// The Mac icon: an iconset, every size at 1× and 2×, then iconutil.
const macPng = render(join(HERE, "ormma-mac.svg"), "mac");
const iconset = join(work, "ormma.iconset");
mkdirSync(iconset);
for (const size of [16, 32, 128, 256, 512]) {
  resized(macPng, size, join(iconset, `icon_${size}x${size}.png`));
  resized(macPng, size * 2, join(iconset, `icon_${size}x${size}@2x.png`));
}
execFileSync("iconutil", ["-c", "icns", iconset, "-o", join(HERE, "ormma.icns")]);

// The Windows icon: PNGs inside an .ico, which Windows reads since Vista.
const winPng = render(FAVICON, "win");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = sizes.map((size) => readFileSync(resized(winPng, size, join(work, `win-${size}.png`))));
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

// A look at the Mac one, for whoever runs this.
renameSync(macPng, join(work, "ormma-mac-1024.png"));
console.log(`made ormma-mac.svg, ormma.icns and ormma.ico — a look at the Mac icon: ${join(work, "ormma-mac-1024.png")}`);
rmSync(iconset, { recursive: true, force: true });
