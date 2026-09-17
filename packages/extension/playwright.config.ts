import { defineConfig } from "@playwright/test";

/**
 * Native-tree e2e suite — drives the built `dist-dogfood/` extension in a real
 * Chromium. See `e2e/README.md` for what it covers and why, and `e2e/harness.ts`
 * for the launch mechanics.
 *
 * Mirrors `packages/testing/playwright.config.ts`'s shape, with two deliberate
 * departures:
 *
 *  - **`fullyParallel: false`.** Parallelism here is per-worker, not per-test:
 *    each worker launches its own Chromium with the unpacked extension, and the
 *    extension's `chrome.debugger` bookkeeping is per-browser. Files still run
 *    across workers.
 *  - **The project carries no `use` block.** `packages/testing`'s spreads
 *    `devices["Desktop Chrome"]`, which configures Playwright's own `page`
 *    fixture — and nothing here uses that fixture. `--load-extension` has no
 *    equivalent through it, so `harness.ts` calls
 *    `chromium.launchPersistentContext` itself and every `use` key (userAgent,
 *    viewport, and in some Playwright versions `channel`) would be silently
 *    ignored. Copying the block across would have left config that reads as
 *    load-bearing and is not.
 */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.test.ts",

  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,

  // Launching Chromium with an unpacked extension, attaching the debugger and
  // reading a full AX tree costs real seconds — well past Playwright's 30s
  // default on a loaded CI box.
  timeout: 60_000,

  projects: [{ name: "chromium" }],
});
