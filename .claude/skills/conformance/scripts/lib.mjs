/**
 * Shared setup for the conformance scripts: locate the repo, load the BUILT
 * browser/audit packages (the same code every surface ships), launch Chromium.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

/** Where the WPT and ACT Rules sparse clones live (SKILL.md §2). */
export const CACHE =
  process.env.REAL_A11Y_CONFORMANCE_CACHE ??
  join(homedir(), ".cache/real-a11y-conformance");

const DIST = {
  browser: join(ROOT, "packages/browser/dist/index.js"),
  audit: join(ROOT, "packages/audit/dist/index.js"),
};

export async function loadPackages() {
  for (const [name, path] of Object.entries(DIST)) {
    if (!existsSync(path)) {
      console.error(
        `No ${relative(ROOT, path)} (${name}). Build first:\n  pnpm --filter "@real-a11y-dev/browser..." build`,
      );
      process.exit(2);
    }
  }
  warnIfStale();
  const browser = await import(pathToFileURL(DIST.browser).href);
  const audit = await import(pathToFileURL(DIST.audit).href);
  return { browser, audit };
}

const requireFromBrowser = createRequire(
  join(ROOT, "packages/browser/package.json"),
);

/** The Chromium build the repo's Playwright pins — the one CI runs, and the
 *  one the DOM producer is tuned against. */
export function pinnedChromium() {
  try {
    // `browsers.json` is not in playwright-core's `exports`; read it beside
    // the package.json, which is.
    const fromPlaywright = createRequire(
      requireFromBrowser.resolve("playwright"),
    );
    const core = dirname(
      fromPlaywright.resolve("playwright-core/package.json"),
    );
    const { browsers } = JSON.parse(
      readFileSync(join(core, "browsers.json"), "utf8"),
    );
    return browsers.find((b) => b.name === "chromium")?.browserVersion ?? null;
  } catch {
    return null;
  }
}

/** Chromium via the repo's own Playwright. `executablePath` overrides the
 *  pinned build; a milestone other than the pinned one gets a warning, because
 *  a divergence that exists only there is drift, not a finding. */
export async function launch(executablePath = process.env.REAL_A11Y_CHROMIUM) {
  const { chromium } = requireFromBrowser("playwright");
  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
  });
  const pinned = pinnedChromium();
  const running = browser.version();
  if (pinned && running.split(".")[0] !== pinned.split(".")[0]) {
    console.error(
      `warning: running Chromium ${running}, but the repo pins ${pinned}. ` +
        `Re-check every finding on ${pinned.split(".")[0]} before filing it.`,
    );
  }
  return browser;
}

/** A built bundle older than its sources tests yesterday's code. */
function warnIfStale() {
  const built = statSync(DIST.browser).mtimeMs;
  const newest = (dir) =>
    readdirSync(dir, { withFileTypes: true }).reduce((m, e) => {
      const p = join(dir, e.name);
      return Math.max(m, e.isDirectory() ? newest(p) : statSync(p).mtimeMs);
    }, 0);
  const stale = ["core", "browser", "serialize", "audit"].filter((p) => {
    const src = join(ROOT, "packages", p, "src");
    return existsSync(src) && newest(src) > built;
  });
  if (stale.length) {
    console.error(
      `warning: packages/{${stale.join(",")}}/src is newer than the built browser bundle — you would be testing old code.\n` +
        `         pnpm --filter "@real-a11y-dev/browser..." build`,
    );
  }
}
