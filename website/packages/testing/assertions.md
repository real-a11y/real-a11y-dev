---
title: "Assertions — @real-a11y-dev/testing"
description: Structural accessibility assertions — collectFindings plus assertHeadingOrder, assertNoUnlabeledInteractive, assertDialogsLabeled, assertLandmarkStructure, assertUniqueInteractiveNames — over the semantic tree.
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
| `severity` | `"error"` blocks use (unlabeled controls, unnamed tree items, tooltips, meters and progress bars, unlabeled dialogs); `"warning"` is triage-later (heading order, a missing main landmark, duplicate landmarks, images missing alt, form controls labeled only by `title`, controls that share a name). |
| `message` | Self-contained description of the problem. |
| `role` / `name` / `tagName` | The offending node, when the finding is node-scoped. |
| `locator` | Best-effort CSS selector path, so the element is findable. |
| `context` | Disambiguating `href` / nearest landmark, when available. |

### `ALL_RULES`

The full rule set `collectFindings` runs by default:

```ts
ALL_RULES;
// ["no-unlabeled-interactive", "label-title-only", "image-alt",
//  "heading-order", "dialog-labeled", "landmark-structure",
//  "unique-interactive-names"]
```

Pass a subset as the second argument to run only some. The five `assert*` helpers below are thin wrappers over `collectFindings` for one rule each.

## `listByRole(root, filter)`

Lists every element in one category — `"link"`, `"button"`, `"form"`, `"landmark"`, `"image"`, or `"heading"` — as `role "name"` plus a best-effort locator, using the same role groups as the extension's filter tabs. Returns a formatted string; a token-efficient way to review one kind of element at a time.

```ts
import { listByRole } from "@real-a11y-dev/testing";

console.log(listByRole(document.body, "image"));
// img "Company logo"  [#logo]
// img  [main > figure:nth-of-type(2) > img]   ← no accessible name
```

## `assertNoUnlabeledInteractive(root)`

Throws if any interactive element (button, link, textbox, combobox, checkbox, radio, etc.), or any `treeitem`, `tooltip`, `meter` or `progressbar` (WAI-ARIA 1.2 requires a name for these), has an empty accessible name. A glyph, emoji, or `title=` on a button is a **non-empty** name (what a screen reader announces) and does **not** fail this assertion — same as axe-core `button-name`. Form controls labeled only by `title` are a separate warning, `label-title-only`, via `collectFindings` / `assertRules`, not this helper.

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

A `role="heading"` with a missing, empty or out-of-range `aria-level` is compared as level 2, the level browsers expose. A non-numeric value such as `abc` reads as level 1, as in Chromium. The missing attribute itself is reported by `toBeValidA11yTree`, not by this assertion.

```ts
assertHeadingOrder(document.body);
```

## `assertDialogsLabeled(root)`

Throws if any `dialog` or `alertdialog` element has no accessible name (via `aria-label` or `aria-labelledby`). A dialog's own text doesn't count: `<div role="dialog">Delete this project? <button>Cancel</button></div>` has no accessible name, because a screen reader announces a dialog only by the name its author gives it, so it throws.

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

## `assertUniqueInteractiveNames(root)`

Throws if two controls of one role share an accessible name, so that a screen-reader user who hears only the name, in the Tab order or in a list of the page's buttons or links, can't tell them apart. The rule is `unique-interactive-names`, a `warning` in `collectFindings`: no specification requires unique names, so it is best practice (WCAG 2.4.6 Headings and Labels, 2.4.9 Link Purpose (Link Only)), not a conformance failure.

- **Buttons, links, checkboxes and switches** are compared across the whole page, whichever landmark or region they sit in.
- **Radios, options, tabs, menu items and tree items** are compared only within their own container (a `radiogroup` or a `<fieldset>` with a legend, a list box, `<select>` or labelled `<optgroup>`, a tab list, a menu, a tree's level), which a screen reader announces as focus enters it. The same "Yes" radio under two questions passes; two "Large" radios in one group don't. A group with no name is only a wrapper, announced as nothing: two "Rename" items in two unnamed groups of one menu are compared, and so are radios in two unnamed fieldsets. An item an `aria-owns` claims belongs to its owner. A radio in no group is compared across the page.
- **Text fields aren't compared**: a billing and a shipping fieldset can each have a "City".
- **Links to the same `href` don't count**: they are one destination, and so are a path and an absolute URL with that path (`/docs` and `https://example.com/docs`). Links of one name that go to two places are all reported. A `href="#"` or `javascript:` link goes nowhere in particular, so two "Delete" links with `href="#"` are reported, and so are a `tel:` and an `sms:` link to one number.
- **The comparison ignores case, spacing and states** (an expanded and a collapsed "Options" are two "Options"), and ignores **descriptions**: an `aria-describedby` that differs doesn't make two names unique, because the Tab order and an elements list don't read it.
- **Each frame is compared on its own** in a native tree, and so is each player or field that draws controls of its own: every `<video controls>` has a "play" and every date input a "Show date picker" in Chromium's tree, and no page can rename them.
- Unnamed controls are `assertNoUnlabeledInteractive`'s to report, not this rule's. Nor are names strict mode withheld: two `[redacted]` names say nothing about whether the real ones match.

```ts
import { assertUniqueInteractiveNames } from "@real-a11y-dev/testing";

document.body.innerHTML = `
  <main>
    <section aria-label="Requests">
      <p>Ana</p><button>Accept</button>
      <p>Luis</p><button>Accept</button>
    </section>
  </main>`;
assertUniqueInteractiveNames(document.body);
```

Each control gets a finding of its own, with its locator and the landmark it is in:

```
A11yAssertionError: Found 2 accessibility issues:
  - Duplicate accessible name: another button is also named "Accept". A screen-reader user who hears only the name can't tell them apart; give each a name of its own (best practice, WCAG 2.4.6 and 2.4.9). [body > main > section > button:nth-of-type(1) — in <region "Requests">]
  - Duplicate accessible name: another button is also named "Accept". A screen-reader user who hears only the name can't tell them apart; give each a name of its own (best practice, WCAG 2.4.6 and 2.4.9). [body > main > section > button:nth-of-type(2) — in <region "Requests">]
```

To fix one, give each control a name of its own, for example by adding its row's or card's text with `aria-labelledby` (`aria-labelledby="accept-ana ana"`), or visually hidden text inside the button.

## `A11yAssertionError`

All five assertions throw this error type on failure. Import it to catch or assert against it directly:

```ts
import type { A11yAssertionError } from "@real-a11y-dev/testing";
```

## See also

- [Matchers](/packages/testing/matchers) — the same checks as `expect` matchers with `.not` negation
- [Playwright adapter](/packages/testing/playwright) — run these assertions against a real browser
