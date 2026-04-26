/**
 * a11y snapshot generator — used by the CI diff bot.
 *
 * Visits each configured page with a real Chromium browser, calls
 * auditSnapshot() on it via the Playwright adapter, and writes the results
 * to `a11y-snapshots.md`.
 *
 * Usage:
 *   node packages/testing/scripts/snapshot.mjs
 *
 * Configuration (environment variables):
 *   A11Y_SNAPSHOT_OUT — output file path (default: a11y-snapshots.md)
 *   A11Y_PAGES        — JSON array of {name, url, rootSelector?} objects.
 *                       If omitted, falls back to DEFAULT_PAGES below.
 *
 * Example of a real-app override:
 *   A11Y_PAGES='[{"name":"Home","url":"http://localhost:3000"},
 *                {"name":"Login","url":"http://localhost:3000/login"}]' \
 *   node packages/testing/scripts/snapshot.mjs
 */

import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// Dynamic import from the built dist — works after `pnpm build`
const { attach } = await import("../dist/playwright.js");

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");

// Default output: repo root (so `pnpm a11y:snapshot` from anywhere writes there).
// In CI, A11Y_SNAPSHOT_OUT is set to an absolute path by the workflow.
const outFile =
  process.env.A11Y_SNAPSHOT_OUT ?? resolve(repoRoot, "a11y-snapshots.md");

// Default pages: the library's own fixture files.
// Override with A11Y_PAGES env var for your own app's routes.
const DEFAULT_PAGES = [
  {
    name: "fixture.html (well-structured)",
    url: `file://${resolve(repoRoot, "packages/testing/e2e/fixture.html")}`,
  },
  {
    name: "fixture-bad.html (broken)",
    url: `file://${resolve(repoRoot, "packages/testing/e2e/fixture-bad.html")}`,
  },
];

const PAGES = process.env.A11Y_PAGES
  ? JSON.parse(process.env.A11Y_PAGES)
  : DEFAULT_PAGES;

// ─── helpers ────────────────────────────────────────────────────────────────

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

/** Prefix each line with indent for Markdown code block indentation. */
function indented(text, prefix = "  ") {
  return text
    .split("\n")
    .map((l) => prefix + l)
    .join("\n");
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const context = await browser.newContext();
  const page = await context.newPage();

  const sections = [];

  for (const { name, url, rootSelector } of PAGES) {
    console.log(`  auditing: ${name}  (${url})`);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded" });

      const opts = rootSelector ? { rootSelector } : {};
      const sn = await attach(page, opts);

      const [audit, outline, tabs] = await Promise.all([
        sn.auditSnapshot(),
        sn.outlineSnapshot(),
        sn.tabSequenceSnapshot(),
      ]);

      sections.push(
        [
          `## ${name}`,
          "",
          `<!-- id: ${slugify(name)} -->`,
          "",
          "### A11y tree",
          "",
          "```",
          audit,
          "```",
          "",
          "### Heading outline",
          "",
          "```",
          outline || "(no headings)",
          "```",
          "",
          "### Tab sequence",
          "",
          "```",
          tabs || "(nothing focusable)",
          "```",
          "",
        ].join("\n"),
      );
    } catch (err) {
      sections.push(
        [`## ${name}`, "", `> ⚠️ Snapshot failed: ${err.message}`, ""].join(
          "\n",
        ),
      );
    }
  }

  const report =
    [
      "# A11y Snapshots",
      "",
      `_Generated ${new Date().toISOString()}_`,
      "",
    ].join("\n") + sections.join("\n");

  writeFileSync(outFile, report, "utf8");
  console.log(`\n✓ Snapshots written to ${outFile}`);

  await browser.close();
}

main().catch((err) => {
  console.error("Snapshot generation failed:", err);
  process.exit(1);
});
