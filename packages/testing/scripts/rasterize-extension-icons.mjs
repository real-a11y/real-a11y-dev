// Rasterizes the Chrome extension's icon PNGs from the brand SVGs.
// Run after changing the brand mark: `pnpm rasterize-icons`.
//
// Source strategy:
//   - `logo.svg` is the master design (320-unit viewBox, full wordmark with
//     drop shadow). Browsers downsample it cleanly for the 48 and 128 PNGs.
//   - `favicon-16.svg` is a compact "ra" lockup. A two-row wordmark can't
//     render legibly at 16 px regardless of source fidelity, so we use a
//     size-specific simplified variant only at that scale.
//
// Uses Playwright's bundled Chromium to rasterize. No separate image-magick
// or rsvg-convert needed because Playwright is already a dev dep of testing.

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
// packages/testing/scripts/ → repoRoot is three levels up
const repoRoot = resolve(__dirname, "..", "..", "..");

const OUT_DIR = resolve(repoRoot, "packages/extension/public/icons");

const SOURCES = [
  { size: 16,  svg: resolve(repoRoot, "website/public/logo.svg") },
  { size: 48,  svg: resolve(repoRoot, "website/public/logo.svg") },
  { size: 128, svg: resolve(repoRoot, "website/public/logo.svg") },
];

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 1 });
const page = await context.newPage();

for (const { size, svg: svgPath } of SOURCES) {
  const svg = readFileSync(svgPath, "utf8");
  const html = `<!DOCTYPE html><html><head><style>
    html,body{margin:0;padding:0;background:transparent}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`;
  await page.setContent(html);
  await page.setViewportSize({ width: size, height: size });
  const buf = await page
    .locator("svg")
    .first()
    .screenshot({ omitBackground: true, type: "png" });
  const out = resolve(OUT_DIR, `icon-${size}.png`);
  writeFileSync(out, buf);
  console.log(`  ${size.toString().padStart(3)}px ← ${svgPath.replace(repoRoot + "\\", "").replace(repoRoot + "/", "")}  →  ${buf.length} bytes`);
}

await browser.close();
console.log("\n✓ extension icons regenerated from per-size favicon SVGs");
