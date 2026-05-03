---
title: "@real-a11y-dev/testing — a11y audits for Vitest, Jest, Playwright"
description: Deterministic snapshots and structural assertions for the accessibility tree. Works in jsdom out of the box; Playwright adapter ships for real-browser E2E.
---

# @real-a11y-dev/testing

> **TL;DR** — Snapshot helpers (`auditSnapshot`, `outlineSnapshot`, `tabSequenceSnapshot`) and structural assertions (`assertHeadingOrder`, `assertNoUnlabeledInteractive`, `assertDialogsLabeled`, `assertLandmarkStructure`) plus a fluent `flow()` chain for interaction tests. Works in jsdom (Vitest / Jest) out of the box; add `@real-a11y-dev/testing/playwright` for real-browser E2E. Reach for this **in your test suite** — unit and e2e alike.

Headless accessibility audit helpers for Vitest, Jest, and Playwright. No browser required for the core helpers — they work in jsdom.

## Install

```sh
npm install -D @real-a11y-dev/testing
```

---

## Snapshots

Deterministic string representations of the accessibility tree. Safe to commit — same DOM always produces the same string.

### `auditSnapshot(root, options?)`

Returns a formatted string of the full semantic tree.

```ts
import { auditSnapshot } from "@real-a11y-dev/testing";

test("login form structure", () => {
  render(<LoginForm />);
  expect(auditSnapshot(document.body)).toMatchSnapshot();
});
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `"a11y" \| "dom"` | `"a11y"` | Tree extraction mode. |
| `redact` | `RegExp[]` | `[]` | Patterns replaced with `[redacted]` in names and text. Use this to keep snapshots deterministic. |

Example output:

```
main ""
  heading "Sign in" (level=1)
  form ""
    group "Credentials"
      textbox "Email address"
      textbox "Password"
    button "Sign in"
    link "Forgot password?"
```

#### Using `redact` — realistic patterns

Most snapshot flakes come from text that changes between runs. Pass regex patterns that match the noisy bits:

```ts
import { auditSnapshot } from "@real-a11y-dev/testing";

expect(
  auditSnapshot(container, {
    redact: [
      // ISO 8601 timestamps        →  2026-04-23T14:03:12Z
      /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}Z?)?/,

      // Relative times             →  "2 minutes ago", "3 days ago"
      /\b\d+\s(seconds?|minutes?|hours?|days?|weeks?)\sago\b/i,

      // Bearer / session tokens    →  long base64-ish strings in aria-labels
      /[A-Za-z0-9+/]{24,}={0,2}/,

      // React auto-generated IDs   →  ":r0:", ":r1:" from useId
      /:r[0-9a-z]+:/,

      // Currency with varying FX   →  "$1,234.56", "€987,65"
      /[$€£¥]\s?\d[\d,.\s]*/,
    ],
  }),
).toMatchSnapshot();
```

The redaction happens **after** name computation — so an `aria-label="Updated 2 minutes ago"` becomes `[redacted]` in the snapshot string without changing the underlying tree. The element still appears, its role and structure still matter.

Redact patterns are additive across calls — define one shared list for your suite:

```ts
// test/redact.ts
export const COMMON_REDACTS = [
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/,
  /:r[0-9a-z]+:/,
];

// anywhere a snapshot is taken
expect(auditSnapshot(container, { redact: COMMON_REDACTS })).toMatchSnapshot();
```

### `outlineSnapshot(root)`

Returns a string of the heading outline only — useful for structure audits.

```ts
expect(outlineSnapshot(document.body)).toMatchSnapshot();
```

Example output:

```
h1 Introduction
  h2 Getting started
  h2 Configuration
    h3 Advanced options
  h2 API reference
```

### `tabSequenceSnapshot(root)`

Returns the tab sequence as a numbered list.

```ts
expect(tabSequenceSnapshot(document.body)).toMatchSnapshot();
```

Example output:

```
1. link "Skip to content"
2. link "Home" (navigation)
3. link "About" (navigation)
4. textbox "Search"
5. button "Submit search"
```

---

## Assertions

These throw `A11yAssertionError` with a descriptive message on failure. Designed for use directly in `it()` / `test()` blocks without wrapping in `expect()`.

### `assertNoUnlabeledInteractive(root)`

Throws if any interactive element (button, link, textbox, combobox, checkbox, radio, etc.) has an empty accessible name.

```ts
import { assertNoUnlabeledInteractive } from "@real-a11y-dev/testing";

test("all buttons are labeled", () => {
  render(<Toolbar />);
  assertNoUnlabeledInteractive(document.body);
});
```

Error message example:
```
A11yAssertionError: Found 2 unlabeled interactive element(s):
  - button (no accessible name) at position 3 in tab sequence
  - textbox (no accessible name) under form "Contact us"
```

### `assertHeadingOrder(root)`

Throws if:
- There is not exactly one `h1`
- Any heading level is skipped (e.g., `h2` followed directly by `h4`)

```ts
assertHeadingOrder(document.body);
```

### `assertDialogsLabeled(root)`

Throws if any `dialog` or `alertdialog` element has no accessible name (via `aria-label` or `aria-labelledby`).

```ts
assertDialogsLabeled(document.body);
```

### `assertLandmarkStructure(root)`

Throws if:
- There is no `main` landmark
- There is more than one `main` landmark
- There is more than one `banner` (header) landmark
- There is more than one `contentinfo` (footer) landmark

```ts
assertLandmarkStructure(document.body);
```

---

## Flow API

Fluent interaction chains — the Testing Library-style alternative for accessibility-level flows.

```ts
import { flow, findByRole } from "@real-a11y-dev/testing";

test("country combobox", async () => {
  render(<CountrySelector />);

  await flow(document.body)
    .findByRole("combobox", { name: /country/i })
    .click()
    .findByRole("option", { name: "Spain" })
    .click()
    .expect((tree) => {
      const combo = findByRole(tree, "combobox", { name: /country/i });
      expect(combo?.a11y.states.expanded).toBe(false);
    });
});
```

### Available steps

| Step | Description |
|---|---|
| `.findByRole(role, opts?)` | Move the cursor to the first matching node. Throws if not found. |
| `.click()` | Dispatch a click action on the current node. |
| `.submit()` | Dispatch a submit action (form). |
| `.toggle()` | Dispatch a toggle action (`<details>`/`<summary>`; falls back to click for ARIA disclosures). |
| `.select(value)` | Dispatch a select action with the given value (native `<select>`). |
| `.type(text)` | Dispatch a type action with the given text (textbox, searchbox). |
| `.expectTree(snapshot)` | Assert the current tree's serialization matches `snapshot` (see caveat below). |
| `.expectActiveModal(predicate)` | Assert the active dialog. Pass `null` to assert no dialog is open, or `(name) => boolean` to assert one is open and its accessible name satisfies the predicate. |
| `.expect(fn)` | Run a custom assertion with the current tree as argument. |

The flow is lazy — steps queue up and run when you `await` the chain.

#### `expectActiveModal` — examples

```ts
// Assert a dialog is open and its name matches a string/regex
await flow(root)
  .findByRole("button", { name: /delete/i })
  .click()
  .expectActiveModal((name) => /confirm/i.test(name));

// Assert no dialog is open
await flow(root)
  .findByRole("button", { name: /cancel/i })
  .click()
  .expectActiveModal(null);
```

The first `role="dialog"` or `role="alertdialog"` in document order is treated as the active modal.

#### `expectTree` — caveat

`expectTree` re-serializes the tree with **default options** (no `redact`, `mode: "a11y"`, generic nodes flattened). A snapshot captured via `auditSnapshot(root, { redact: [...] })` or `{ mode: "dom" }` will not match. For redacted or DOM-mode comparisons, use `.expect((tree) => { … })` and call `serializeTree`/`auditSnapshot` yourself.

### `flow(root, options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `waitTimeout` | `number` | `200` ms | Max wait for the post-action debounced mutation cycle. Increase for slow async UIs; decrease for tighter feedback in pure-DOM flows. |

```ts
await flow(root, { waitTimeout: 500 })
  .findByRole("button", { name: /save/i })
  .click();
```

---

## Utilities

### `waitForMutations(root, options?)`

Resolves after the next debounced DOM mutation cycle. Useful after programmatic DOM changes.

```ts
import { waitForMutations } from "@real-a11y-dev/testing";

element.click();
await waitForMutations(root);
// DOM has settled, re-extract
```

**Options:**

| Option | Type | Default |
|---|---|---|
| `timeout` | `number` | `1000` ms |
| `debounceMs` | `number` | `50` ms |

### `dispatch(node, action?, payload?)`

Dispatches an action on a `SemanticNode` directly.

```ts
import { dispatch } from "@real-a11y-dev/testing";

const btn = findByRole(tree, "button", { name: /submit/i });
await dispatch(btn, "click");
```

---

## Playwright adapter

Run the same audit helpers against a real browser page. The adapter injects a self-contained IIFE bundle into the page and exposes every helper via `page.evaluate()`.

### Install

```sh
npm install -D @playwright/test
```

The `playwright` peer dependency is optional — only needed when using `@real-a11y-dev/testing/playwright`.

### `attach(page, options?)`

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

### Narrowing the root

```ts
// Audit only the main content area
const sn = await attach(page, { rootSelector: "main" });
await sn.assertNoUnlabeledInteractive();
```

### Testing that assertions fail on broken pages

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

### Determinism

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

That's the property that makes `expect(await sn.auditSnapshot()).toMatchSnapshot()` safe to use in CI without flakes. If you have genuinely variable content (timestamps, locale-dependent copy), see [`redact`](#using-redact-realistic-patterns) above.

### How it works

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

### Error propagation

When an assertion throws `A11yAssertionError` inside the page, Playwright propagates the error message back to Node. The full descriptive message (including all offending elements) is preserved.

```ts
// Error message example:
// "Found 2 unlabeled interactive element(s):
//   - button (<button>)
//   - textbox (<input>)"
await expect(sn.assertNoUnlabeledInteractive()).rejects.toThrow("unlabeled");
```

### `SemanticNavigatorPageHandle` type

```ts
import type {
  SemanticNavigatorPageHandle,
  AttachOptions,
  PlaywrightPage,
} from "@real-a11y-dev/testing/playwright";
```

`PlaywrightPage` is a minimal structural type that accepts the real Playwright `Page` object without requiring `playwright` or `@playwright/test` in packages that only import the types.

---

## TypeScript

```ts
import type { A11yAssertionError } from "@real-a11y-dev/testing";
```

---

## See it running

- **Vitest + jsdom** — [`examples/testing-vitest/`](/examples/testing-vitest): snapshot tests, `flow()` combobox interaction, tab-sequence structure assertions.
- **Playwright E2E** — [`examples/playwright/`](/examples/playwright): a "good fixture" where every assertion passes and a "broken fixture" where each throws — the pattern to keep in CI.
- **CI tree-diff bot** — the [CI Diff Bot recipe](/guide/ci-diff-bot) wires a snapshot generator into a PR workflow.
