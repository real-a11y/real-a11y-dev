# Example: Playwright E2E

Demonstrates `@real-a11y-dev/testing/playwright` — the `attach()` adapter — against real fixture pages in a Playwright test suite.

**Source:** [`packages/testing/e2e/`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/testing/e2e)

## What it shows

- `attach(page)` injecting the audit engine into a real browser page
- `auditSnapshot()` producing a stable string for snapshot tests
- `outlineSnapshot()` verifying heading structure
- `tabSequenceSnapshot()` verifying tab order
- All four assertions (`assertHeadingOrder`, `assertNoUnlabeledInteractive`, `assertLandmarkStructure`, `assertDialogsLabeled`) passing on a well-structured page
- The same assertions **throwing** on a broken page — error messages surfaced in the test runner
- `rootSelector` narrowing the audit to a specific subtree

## Run it locally

```sh
git clone https://github.com/real-a11y/real-a11y-dev.git
cd real-a11y
pnpm install

# Install the Playwright browser (first time only)
npx playwright install chromium --filter @real-a11y-dev/testing

# Run the e2e tests
pnpm --filter @real-a11y-dev/testing test:e2e
```

## Setup

```ts
// packages/testing/playwright.config.ts
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
```

## Good fixture — assertions pass

```ts
test("assertHeadingOrder passes for correct structure", async ({ page }) => {
  await page.goto(fixtureUrl("fixture.html"));
  const sn = await attach(page);

  await expect(sn.assertHeadingOrder()).resolves.toBeUndefined();
  await expect(sn.assertLandmarkStructure()).resolves.toBeUndefined();
  await expect(sn.assertNoUnlabeledInteractive()).resolves.toBeUndefined();
});
```

The good fixture has:
- One `<h1>` with two `<h2>` sections (no skipped levels)
- Labeled `<header>`, `<main>`, `<footer>` landmarks
- A form with proper `<label>` elements on every input
- A `<dialog>` with `aria-labelledby`

## Bad fixture — assertions throw

```ts
test("assertHeadingOrder throws on missing h1", async ({ page }) => {
  await page.goto(fixtureUrl("fixture-bad.html"));
  const sn = await attach(page);

  await expect(sn.assertHeadingOrder()).rejects.toThrow();
  await expect(sn.assertNoUnlabeledInteractive()).rejects.toThrow();
  await expect(sn.assertLandmarkStructure()).rejects.toThrow();
  await expect(sn.assertDialogsLabeled()).rejects.toThrow();
});
```

The bad fixture has:
- No `<h1>` (starts at `<h2>`, then jumps to `<h4>`)
- No `<main>` landmark
- An unlabeled `<button>` and unlabeled `<input>`
- An open `<dialog>` with no `aria-label` or `aria-labelledby`

## Narrowing the audit root

```ts
test("rootSelector narrows the audit to a subtree", async ({ page }) => {
  await page.goto(fixtureUrl("fixture.html"));
  const sn = await attach(page, { rootSelector: "form" });

  const snapshot = await sn.auditSnapshot();
  expect(snapshot).toContain("Send message");    // inside the form
  expect(snapshot).not.toContain("Test fixture"); // page h1 is outside the form
});
```

## Snapshot test

```ts
test("auditSnapshot is stable across multiple calls", async ({ page }) => {
  await page.goto(fixtureUrl("fixture.html"));
  const sn = await attach(page);

  const snap1 = await sn.auditSnapshot();
  const snap2 = await sn.auditSnapshot();
  expect(snap1).toBe(snap2); // deterministic — same DOM, same string
});
```

Commit `auditSnapshot()` output with `toMatchSnapshot()` to catch unintended accessibility regressions in CI:

```ts
test("page a11y tree matches snapshot", async ({ page }) => {
  await page.goto("/dashboard");
  const sn = await attach(page, { rootSelector: "main" });
  expect(await sn.auditSnapshot()).toMatchSnapshot();
  // Playwright stores snapshot in: e2e/snapshots/test-name-chromium.txt
});
```

## How the adapter works

```
Test (Node)                          Browser page
──────────                           ────────────
attach(page)
  → readBundle() (cached)
  → page.addScriptTag(bundle)   ──▶  window.__realA11y__ = { auditSnapshot, … }
  → returns handle

sn.assertHeadingOrder()
  → page.evaluate(               ──▶  __realA11y__.assertHeadingOrder(root)
      __realA11y__.fn(root)
    )                            ◀──  throws A11yAssertionError (message preserved)
```

The bundle (30 KB) is read from disk once and cached in the Node process — subsequent `attach()` calls add no I/O overhead.
