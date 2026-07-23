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
| `tree` | `"dom" \| "native"` | `"dom"` | Which producer builds the tree. See [Auditing the native tree](#auditing-the-native-tree). |

## Narrowing the root

```ts
// Audit only the main content area
const sn = await attach(page, { rootSelector: "main" });
await sn.assertNoUnlabeledInteractive();
```

## Auditing the native tree

By default `attach()` uses the **DOM producer**: it injects the page-bundle and walks the light DOM in the page. Pass `{ tree: "native" }` to use the **native producer** instead — it reads Chromium's own accessibility tree over CDP (via `@real-a11y-dev/browser`'s `nativeTree`) and runs the same serialize/audit helpers in Node:

```ts
test("native tree sees the media controls", async ({ page }) => {
  await page.goto("/player");
  const sn = await attach(page, { tree: "native" });

  // Same handle, same assertions — over Chromium's a11y tree.
  await sn.assertHeadingOrder();
  await sn.assertLandmarkStructure();
  expect(await sn.auditSnapshot()).toMatchSnapshot();
});
```

Why a second producer: Chromium exposes structure no in-page walk can reach — most visibly a `<video controls>`'s play/scrubber/mute controls, which live in a closed user-agent shadow root. An audit run over the native tree sees them; the DOM producer stops at the `<video>` element.

Native mode is **read-only and whole-document** for now:

- `tabSequenceSnapshot()` **throws** — a native tree carries no focus/interaction data, so tab order can't be computed. Use `{ tree: "dom" }` for tab-sequence snapshots.
- `rootSelector` scoping is **not supported** — omit it (the default `"body"` audits the whole document); passing any other selector throws up front rather than silently ignoring it.

Everything else — `auditSnapshot()`, `outlineSnapshot()`, and every `assert*` method — works identically. Both producers normalize to the *same* tree model, so a snapshot's `role "name"` grammar is the same and the two trees are directly comparable.

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
// "Found 2 accessibility issues:
//   - Unlabeled interactive element: button <button>
//   - Unlabeled interactive element: textbox <input>"
await expect(sn.assertNoUnlabeledInteractive()).rejects.toThrow(/unlabeled/i);
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
