// Rasterizes website/public/og-image.svg to PNG at 1200×630.
// Run after editing the OG image: `pnpm rasterize-og`.
//
// Why PNG: the VitePress config references `/og-image.png` as the social
// card. Most scrapers (Twitter, LinkedIn, Slack, Facebook) parse PNG
// reliably; SVG support in OG scrapers is inconsistent.

import { chromium } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..", "..");

const SRC = resolve(repoRoot, "website/public/og-image.svg");
const OUT = resolve(repoRoot, "website/public/og-image.png");
const WIDTH = 1200;
const HEIGHT = 630;

const svg = readFileSync(SRC, "utf8");

const browser = await chromium.launch();
const context = await browser.newContext({ deviceScaleFactor: 1 });
const page = await context.newPage();

const html = `<!DOCTYPE html><html><head><style>
  html,body{margin:0;padding:0;background:#ffffff}
  svg{display:block;width:${WIDTH}px;height:${HEIGHT}px}
</style></head><body>${svg}</body></html>`;

await page.setContent(html);
await page.setViewportSize({ width: WIDTH, height: HEIGHT });

const buf = await page
  .locator("svg")
  .first()
  .screenshot({ type: "png" });

writeFileSync(OUT, buf);
console.log(`  wrote ${OUT}`);
console.log(`  ${WIDTH}×${HEIGHT}, ${buf.length} bytes`);

await browser.close();
console.log("\n✓ og-image.png regenerated from og-image.svg");
