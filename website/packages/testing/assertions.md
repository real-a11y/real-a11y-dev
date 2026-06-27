---
title: "Assertions — @real-a11y-dev/testing"
description: Structural accessibility assertions — assertHeadingOrder, assertNoUnlabeledInteractive, assertDialogsLabeled, assertLandmarkStructure — that throw descriptive errors.
---

# Assertions

These throw `A11yAssertionError` with a descriptive message on failure. Designed for use directly in `it()` / `test()` blocks without wrapping in `expect()`.

Part of [`@real-a11y-dev/testing`](/packages/testing). Prefer the `expect(el).toHaveValidHeadingOrder()` form? See [Matchers](/packages/testing/matchers), which wraps these same checks.

## `assertNoUnlabeledInteractive(root)`

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

## `assertHeadingOrder(root)`

Throws if:
- There is not exactly one `h1`
- Any heading level is skipped (e.g., `h2` followed directly by `h4`)

```ts
assertHeadingOrder(document.body);
```

## `assertDialogsLabeled(root)`

Throws if any `dialog` or `alertdialog` element has no accessible name (via `aria-label` or `aria-labelledby`).

```ts
assertDialogsLabeled(document.body);
```

## `assertLandmarkStructure(root)`

Throws if:
- There is no `main` landmark
- There is more than one `main` landmark
- There is more than one `banner` (header) landmark
- There is more than one `contentinfo` (footer) landmark

```ts
assertLandmarkStructure(document.body);
```

## `A11yAssertionError`

All four assertions throw this error type on failure. Import it to catch or assert against it directly:

```ts
import type { A11yAssertionError } from "@real-a11y-dev/testing";
```

## See also

- [Matchers](/packages/testing/matchers) — the same checks as `expect` matchers with `.not` negation
- [Playwright adapter](/packages/testing/playwright) — run these assertions against a real browser
