---
title: "Playwright adapter — @real-a11y-dev/testing"
description: Run the same accessibility audit helpers against a real browser page. The attach() adapter injects a self-contained bundle and exposes every helper via page.evaluate().
---

# Playwright adapter

Run the same audit helpers against a real browser page. The adapter injects a self-contained IIFE bundle into the page and exposes every helper via `page.evaluate()`.

Part of [`@real-a11y-dev/testing`](/packages/testing), imported from the `/playwright` subpath.

## Install

```sh
npm install -D @playwright/test
```

The `playwright` peer dependency is optional — only needed when using `@real-a11y-dev/testing/playwright`.

## `attach(page, options?)`

```ts
import { test, expect } from "@playwright/test";
import { attach } from "@real-a11y-dev/testing/playwright";

test("page heading structure", async ({ page }) => {
  await page.goto("https://example.com");
  const sn = await attach(page);

  // Assertions — throw with descriptive messages on failure
  await sn.assertHeadingOrder();
  await sn.assertNoUnlabeledInteractive();
  await sn.assertLandmarkStructure();
  await sn.assertDialogsLabeled();

  // Snapshots — deterministic strings, safe to commit
  expect(await sn.auditSnapshot()).toMatchSnapshot();
  expect(await sn.outlineSnapshot()).toMatchSnapshot();
  expect(await sn.tabSequenceSnapshot()).toMatchSnapshot();
});
```

**`attach()` options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `rootSelector` | `string` | `"body"` | CSS selector for the audit root element. |

## Narrowing the root

```ts
// Audit only the main content area
const sn = await attach(page, { rootSelector: "main" });
await sn.assertNoUnlabeledInteractive();
```

## Testing that assertions fail on broken pages

Lock in the failure mode too — not just the happy path. When a new assertion lands or you refactor a page, you want confirmation that broken structure still throws:

```ts
// Good page: every assertion passes
test("well-structured page satisfies all audits", async ({ page }) => {
  await page.goto("/home");
  const sn = await attach(page);
  await expect(sn.assertHeadingOrder()).resolves.toBeUndefined();
  await expect(sn.assertLandmarkStructure()).resolves.toBeUndefined();
  await expect(sn.assertNoUnlabeledInteractive()).resolves.toBeUndefined();
  await expect(sn.assertDialogsLabeled()).resolves.toBeUndefined();
});

// Intentionally-broken fixture: each assertion must throw its specific failure
test("broken fixture fails every audit", async ({ page }) => {
  await page.goto("/test-fixtures/broken.html");
  const sn = await attach(page);
  await expect(sn.assertHeadingOrder()).rejects.toThrow(/heading/i);
  await expect(sn.assertLandmarkStructure()).rejects.toThrow(/main/i);
  await expect(sn.assertNoUnlabeledInteractive()).rejects.toThrow(/unlabeled/i);
  await expect(sn.assertDialogsLabeled()).rejects.toThrow(/dialog/i);
});
```

Keep a small "broken" fixture checked into your test repo with one of each pattern the assertions target (missing h1, skipped level, unlabeled button, unlabeled dialog). If a future refactor ever weakens the assertions, this test catches it immediately.

## Determinism

`auditSnapshot()`, `outlineSnapshot()`, and `tabSequenceSnapshot()` return the **same string** for the same DOM — on every run, on every machine. No timestamps, no generated IDs, no ordering surprises:

```ts
test("auditSnapshot is stable across repeated calls", async ({ page }) => {
  await page.goto("/home");
  const sn = await attach(page);

  const snap1 = await sn.auditSnapshot();
  const snap2 = await sn.auditSnapshot();
  expect(snap1).toBe(snap2);
});
```

That's the property that makes `expect(await sn.auditSnapshot()).toMatchSnapshot()` safe to use in CI without flakes. If you have genuinely variable content (timestamps, locale-dependent copy), redact it — see below.

## Redacting variable content

`auditSnapshot()` takes the same [`redact`](/packages/testing/snapshots#using-redact) option as the jsdom helper — an array of `RegExp` whose matches become `[REDACTED]` in accessible names:

```ts
test("home page structure", async ({ page }) => {
  await page.goto("/home");
  const sn = await attach(page);
  expect(
    await sn.auditSnapshot({
      redact: [
        /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g, // ISO timestamps
        /\d+ (seconds?|minutes?|hours?) ago/g, // relative times
      ],
    }),
  ).toMatchSnapshot();
});
```

A `RegExp` can't be passed through `page.evaluate()` directly — Playwright serializes evaluate arguments and a `RegExp` arrives as an empty `{}`. The adapter handles this for you: it marshals each pattern to `{ source, flags }`, ferries that across the boundary, and rebuilds the `RegExp` inside the page — so patterns behave exactly as they do in jsdom. Keep the [`g`-flag gotcha](/packages/testing/snapshots#using-redact) in mind when a name can contain more than one match.

## How it works

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

1. `attach()` reads the pre-built IIFE bundle (`dist/page-bundle.iife.global.js`) from the package.
2. Injects it into the page via `page.addScriptTag()`. This sets `window.__realA11y__`.
3. Each method calls `page.evaluate()`, running the helper in the browser and returning the result (or re-throwing the error) in Node.

The bundle is read once and cached in the Node process — subsequent `attach()` calls on the same process are instant.

## Error propagation

When an assertion throws `A11yAssertionError` inside the page, Playwright propagates the error message back to Node. The full descriptive message (including all offending elements) is preserved.

```ts
// Error message example:
// "Found 2 unlabeled interactive element(s):
//   - button (<button>)
//   - textbox (<input>)"
await expect(sn.assertNoUnlabeledInteractive()).rejects.toThrow("unlabeled");
```

## `SemanticNavigatorPageHandle` type

```ts
import type {
  SemanticNavigatorPageHandle,
  AttachOptions,
  PlaywrightPage,
} from "@real-a11y-dev/testing/playwright";
```

`PlaywrightPage` is a minimal structural type that accepts the real Playwright `Page` object without requiring `playwright` or `@playwright/test` in packages that only import the types.

## See also

- [Snapshots](/packages/testing/snapshots) and [Assertions](/packages/testing/assertions) — the helpers `attach()` exposes
- [CI Diff Bot recipe](/guide/ci-diff-bot) — wiring snapshots into a PR workflow
