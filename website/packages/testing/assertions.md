---
title: "Assertions — @real-a11y-dev/testing"
description: Structural accessibility assertions — collectFindings plus assertHeadingOrder, assertNoUnlabeledInteractive, assertDialogsLabeled, assertLandmarkStructure — over the semantic tree.
---

# Assertions

These throw `A11yAssertionError` with a descriptive message on failure. Designed for use directly in `it()` / `test()` blocks without wrapping in `expect()`.

Part of [`@real-a11y-dev/testing`](/packages/testing). Prefer the `expect(el).toHaveValidHeadingOrder()` form? See [Matchers](/packages/testing/matchers), which wraps these same checks.

## `collectFindings(root, rules?)`

The non-throwing primitive underneath every `assert*` helper. It runs the rules over a **single** tree extraction and returns **every** violation as a structured `Finding[]`, instead of throwing on the first. Reach for it to build a report, a custom matcher, or to feed an audit to another tool.

```ts
import { collectFindings, ALL_RULES } from "@real-a11y-dev/testing";

const findings = collectFindings(document.body); // all rules
const headingsOnly = collectFindings(document.body, ["heading-order"]);
```

`root` is a DOM `Element` **or** an already-extracted tree (`ExtractionResult`). Passing a pre-extracted tree runs the rules over the _same_ snapshot used for the serialized tree / outline / tab order, so a multi-view report can't be internally inconsistent on a page that changes between extractions.

Each `Finding` carries:

| Field | Meaning |
| --- | --- |
| `rule` | Which rule fired — one of `ALL_RULES` (below). |
| `severity` | `"error"` blocks use (unlabeled controls, unlabeled dialogs); `"warning"` is triage-later (heading order, duplicate landmarks, images missing alt). |
| `message` | Self-contained description of the problem. |
| `role` / `name` / `tagName` | The offending node, when the finding is node-scoped. |
| `locator` | Best-effort CSS selector path, so the element is findable. |
| `context` | Disambiguating `href` / nearest landmark, when available. |

### `ALL_RULES`

The full rule set `collectFindings` runs by default:

```ts
ALL_RULES;
// ["no-unlabeled-interactive", "image-alt", "heading-order",
//  "dialog-labeled", "landmark-structure"]
```

Pass a subset as the second argument to run only some. The four `assert*` helpers below are thin wrappers over `collectFindings` for one rule each.

## `listByRole(root, filter)`

Lists every element in one category — `"link"`, `"button"`, `"form"`, `"landmark"`, `"image"`, or `"heading"` — as `role "name"` plus a best-effort locator, using the same role groups as the extension's filter tabs. Returns a formatted string; a token-efficient way to review one kind of element at a time.

```ts
import { listByRole } from "@real-a11y-dev/testing";

console.log(listByRole(document.body, "image"));
// img "Company logo"  [#logo]
// img  [main > figure:nth-of-type(2) > img]   ← no accessible name
```

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
A11yAssertionError: Found 2 accessibility issues:
  - Unlabeled interactive element: button <button> [#save]
  - Unlabeled interactive element: textbox <input> [form > input — in <form>]
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
