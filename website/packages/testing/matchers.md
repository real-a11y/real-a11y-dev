---
title: "Matchers — @real-a11y-dev/testing"
description: Custom expect matchers for Vitest and Jest — toHaveNoUnlabeledInteractive, toHaveValidHeadingOrder, toHaveTabSequence — plus the a11ySnapshot serializer.
---

# Matchers

An ergonomic `expect` layer over the [assertions](/packages/testing/assertions) and [snapshots](/packages/testing/snapshots) — the same checks, but read as native matchers with `.not` negation and clean failure messages. This is the jest-axe-style surface of the package.

Shipped from a separate, opt-in entry so the main package stays side-effect-free:

```ts
import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
```

> **Not the same as jest-axe.** jest-axe runs a WCAG **rule engine** and reports violations. These matchers assert **structure** and capture **snapshots** of the semantic tree — including focus order and modal scoping, which a rule engine doesn't model. The two compose well in one suite. See [Accessibility Snapshots](/guide/accessibility-snapshots) for the distinction.

## Setup

Registration is opt-in (the jest-axe pattern): call `registerA11yMatchers(expect)` once from a setup file. Nothing runs on import.

### Vitest

```ts
// vitest.setup.ts
import { expect } from "vitest";
import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
import "@real-a11y-dev/testing/matchers/vitest"; // types-only augmentation

registerA11yMatchers(expect);
```

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

### Jest

```ts
// jest.setup.ts
import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";

// `expect` is the Jest global. No separate type import needed — the matchers
// ship a global `jest.Matchers` augmentation.
registerA11yMatchers(expect);
```

```js
// jest.config.cjs
module.exports = {
  preset: "ts-jest",
  testEnvironment: "jsdom",
  setupFilesAfterEnv: ["<rootDir>/jest.setup.ts"],
};
```

::: tip TypeScript module resolution (Jest + ts-jest)
The `/matchers` subpath is exposed through the package `exports` field, so TypeScript must read it. Use `"moduleResolution": "Node16"` (or `"NodeNext"` / `"Bundler"`) — the legacy `"node"` resolver ignores `exports` and the import won't resolve. `ts-jest` also needs `"isolatedModules": true` under Node16.
:::

## Assertion matchers

Each wraps the matching [`assert*` function](/packages/testing/assertions). They take a DOM root (e.g. `container`, `document.body`).

| Matcher | Asserts |
|---|---|
| `toHaveNoUnlabeledInteractive()` | Every interactive node has a non-empty accessible name. |
| `toHaveValidHeadingOrder()` | Exactly one `<h1>` and no skipped heading levels. |
| `toHaveLabeledDialogs()` | Every `dialog` / `alertdialog` has an accessible name. |
| `toHaveValidLandmarks()` | Exactly one `main`; at most one `banner` / `contentinfo`. |

```ts
expect(container).toHaveNoUnlabeledInteractive();
expect(container).toHaveValidHeadingOrder();
expect(container).toHaveLabeledDialogs();
expect(container).toHaveValidLandmarks();

// Negation comes for free
expect(brokenContainer).not.toHaveValidLandmarks();
```

On failure the matcher surfaces the underlying assertion's message:

```
expect(element).toHaveNoUnlabeledInteractive()

Found 1 unlabeled interactive element(s):
  - button (<button>)
```

## `toHaveTabSequence(expected)`

Asserts the computed Tab order equals an array of `role "name"` tokens, in the order a user would encounter pressing Tab (positive `tabindex` first).

```ts
expect(container).toHaveTabSequence([
  'link "Home"',
  'link "About"',
  'textbox "Search"',
  'button "Go"',
]);
```

This is the assertion form of [`tabSequenceSnapshot`](/packages/testing/snapshots#tabsequencesnapshot-root). It's especially useful for **focus-trap** checks — when a modal is open, the sequence collapses to just the dialog's controls:

```ts
await flow(container).findByRole("button", { name: "Delete account" }).click();
expect(container).toHaveTabSequence(['button "Cancel"', 'button "Delete"']);
```

## `a11ySnapshot(root, options?)` — snapshot serializer

Wrap a DOM root (or a pre-extracted tree) so `toMatchSnapshot()` / `toMatchInlineSnapshot()` render the **semantic tree** instead of a DOM dump — fully native to each framework's snapshot tooling (`-u`/`--update`, obsolete detection all work).

```ts
import { a11ySnapshot } from "@real-a11y-dev/testing/matchers";

expect(a11ySnapshot(container)).toMatchSnapshot();
```

```
main
  heading "Sign in" (level 1)
  form "Sign-in form"
    textbox "Email"
    button "Sign in"
```

It accepts the same options as `auditSnapshot` — including [`redact`](/packages/testing/snapshots#using-redact) to mask dynamic text (timestamps, IDs, prices) so the snapshot stays stable in CI:

```ts
expect(
  a11ySnapshot(container, { redact: [/\d{4}-\d{2}-\d{2}/g] }),
).toMatchSnapshot();
```

See [`redact`](/packages/testing/snapshots#using-redact) for the full pattern reference and the `g`-flag gotcha.

`registerA11yMatchers` registers the serializer for you. To register it on its own (e.g. via a framework's `snapshotSerializers` config), it's exported as `a11ySnapshotSerializer`.

### `a11ySnapshot` vs `auditSnapshot`

Both render the **same tree** — under the hood they call the same serializer with the same options (`mode`, `redact`, `includeGeneric`). The only difference is what they hand back, and therefore how the framework treats it:

- [`auditSnapshot()`](/packages/testing/snapshots#auditsnapshot-root-options) returns a **plain string**. The value your test holds *is* the tree, so you can assert on it directly — `expect(s).toContain('button "Save"')`, `expect(s1).toBe(s2)` — log it, or write it to a file (that's what the [CI diff bot](/guide/ci-diff-bot) does). It needs no setup.
- `a11ySnapshot()` returns an **opaque boxed value** that the registered serializer renders at snapshot time. It does nothing on its own, but it keeps `toMatchSnapshot()` / `toMatchInlineSnapshot()` fully native — and crucially, **inline snapshots stay readable**: the tree is rendered as-is instead of escaped into a quoted string literal.

| Reach for `auditSnapshot` when… | Reach for `a11ySnapshot` when… |
|---|---|
| You want the string itself — substring assertions, comparing two trees, writing a CI artifact | You're committing the tree with `toMatchSnapshot()` / `toMatchInlineSnapshot()` |
| You don't want to register a serializer | You want clean, unquoted output — especially for **inline** snapshots |

When in doubt: `auditSnapshot` for "I need the string," `a11ySnapshot` for "I'm storing a snapshot of the tree."

### Modal scoping in snapshots

Because the snapshot reflects the extracted a11y tree, an open dialog **scopes** the snapshot — content behind a modal is inert to assistive tech, so it drops out and the snapshot captures only the dialog. That makes the snapshot a precise regression artifact for the modal state, not just the page.

## Vitest vs Jest type augmentation

The matcher signatures are identical; only the type wiring differs:

| Aspect | Vitest | Jest |
|---|---|---|
| Runtime registration | `registerA11yMatchers(expect)` | `registerA11yMatchers(expect)` |
| Type augmentation | `import "@real-a11y-dev/testing/matchers/vitest"` | none — global `jest.Matchers` augmentation ships with the import |

## See it running

- [`examples/testing-vitest`](https://github.com/real-a11y/real-a11y-dev/tree/main/examples/testing-vitest) — `matchers-basic.test.ts` (simple) and `matchers-account-page.test.ts` (a full a11y gate + `flow()`-driven modal)
- [`examples/testing-jest`](https://github.com/real-a11y/real-a11y-dev/tree/main/examples/testing-jest) — the minimal Jest + ts-jest setup

## See also

- [Assertions](/packages/testing/assertions) and [Snapshots](/packages/testing/snapshots) — the functions these matchers wrap
- [Accessibility Snapshots](/guide/accessibility-snapshots) — the concept and why it complements rule-based audits
