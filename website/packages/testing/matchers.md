---
title: "Matchers — @real-a11y-dev/testing"
description: Custom expect matchers for Vitest and Jest — toHaveNoUnlabeledInteractive, toHaveValidHeadingOrder, toHaveTabSequence, toMatchA11yContract — plus the a11ySnapshot serializer.
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

Found 1 accessibility issue:
  - Unlabeled interactive element: button <button>
```

## `toBeValidA11yTree()`

Asserts the extracted accessibility tree has no ARIA **errors** — invalid roles, missing required accessible names, and relationship violations (interactive nesting, presentational-children misuse). Backed by `@real-a11y-dev/validate`. Advisory **warnings** don't fail it — only errors do.

```ts
expect(container).toBeValidA11yTree();

// Negation asserts the tree *does* have an ARIA error
expect(brokenContainer).not.toBeValidA11yTree();
```

Unlike the four matchers above, this one doesn't wrap an `assert*` function — it runs the semantic tree through `@real-a11y-dev/validate` and fails only on `severity: "error"` issues.

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

Names are matched with **typographic punctuation normalized**, so a plain token like `button "Don't save"` matches a label the page renders with a curly apostrophe (`Don’t`). Curly quotes, the ellipsis character, en/em dashes, and non-breaking spaces all fold to their ASCII forms for the comparison — you never have to paste smart quotes to make a token match. (Roles and everything else compare exactly; only accessible-name typography is folded.)

## `toMatchA11yContract(contract, options?)`

Asserts the tree **satisfies an authored contract** — a partial a11y tree, written in the same `role "name" (level N)` grammar the snapshots use. Think of it as the `toMatchObject` of accessibility trees: unlike a full snapshot, the contract lists only the nodes you care about, and **extra nodes in the implementation are allowed**.

```ts
// The tree must CONTAIN this structure, in this order, nested this way —
// but a skip link, a cookie banner, or extra wrappers don't break it.
expect(container).toMatchA11yContract(`
  main
    heading "Sign in" (level 1)
    form
      textbox "Email address"
      textbox "Password"
      button "Sign in"
    link "Forgot password?"
`);
```

Matching is **containment with ancestor semantics**:

- every contract node must appear with the same role (and name / `(level N)` / `[focused]` when the contract specifies them — an **omitted name matches any name**);
- each node must sit somewhere **under** its contract parent's match — intermediate wrappers in the implementation are fine, so `textbox "Email address"` matches even when the real markup nests it in a `group "Credentials"`;
- contract nodes must appear in document order;
- extra target nodes are always allowed.

That resilience is the point: a contract survives the noise a real page accumulates, so it stays green through cosmetic churn and fails only on a **structural** regression — a `<button>` shipped as a `<div onclick>`, a heading demoted, a field that lost its label. When it fails, the message pinpoints the first missing node and why:

```
a11y contract not satisfied: matched 5/7 nodes.

  ✓ main   (line 5)
  ✓   heading "Sign in" (level 1)   (line 6)
  ✓   form   (line 7)
  ✓     textbox "Email address"   (line 9)
  ✓     textbox "Password"   (line 10)
  ✖     button "Sign in"   ← NOT FOUND
  ·   link "Forgot password?"

  ✖ button "Sign in": not found under form (matched line 7), after textbox "Password" (line 10).
```

**Received** can be a DOM Element (extracted on the spot) **or an already-serialized tree string** (a committed `auditSnapshot` artifact). Names fold typographic punctuation like `toHaveTabSequence` does, so a contract typed with plain quotes matches curly-quote labels. A contract may carry `#` comments and a `---` frontmatter block (e.g. a source URL) — both are ignored for matching.

**`{ strict: true }`** switches to exact tree equality — the contract behaves like a committed snapshot baseline (and, unlike containment, compares names byte-exact). Use it only where you truly render a component in isolation and nothing else should be present.

```ts
// containment: everything listed must be present (default)
expect(container).toMatchA11yContract(contract);

// strict: the tree must equal the contract exactly, nothing more
expect(inIsolation).toMatchA11yContract(contract, { strict: true });
```

Because a serialized string is accepted, the same contract can be checked against a **committed snapshot artifact** — not only a live test render.

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

- [`auditSnapshot()`](/packages/testing/snapshots#auditsnapshot-root-options) returns a **plain string**. The value your test holds *is* the tree, so you can assert on it directly — `expect(s).toContain('button "Save"')`, `expect(s1).toBe(s2)` — log it, or write it to a file. It needs no setup.
- `a11ySnapshot()` returns an **opaque boxed value** that the registered serializer renders at snapshot time. It does nothing on its own, but it keeps `toMatchSnapshot()` / `toMatchInlineSnapshot()` fully native — and crucially, **inline snapshots stay readable**: the tree is rendered as-is instead of escaped into a quoted string literal.

| Reach for `auditSnapshot` when… | Reach for `a11ySnapshot` when… |
|---|---|
| You want the string itself — substring assertions, comparing two trees, writing a CI artifact | You're committing the tree with `toMatchSnapshot()` / `toMatchInlineSnapshot()` |
| You don't want to register a serializer | You want clean, unquoted output — especially for **inline** snapshots |

When in doubt: `auditSnapshot` for "I need the string," `a11ySnapshot` for "I'm storing a snapshot of the tree."

### Modal scoping in snapshots

Because the snapshot reflects the extracted a11y tree, an open dialog **scopes** the snapshot — content behind a modal is inert to assistive tech, so it drops out and the snapshot captures only the dialog. That makes the snapshot a precise regression artifact for the modal state, not just the page.

## Rules, contracts, and snapshots — which to reach for

Three of these matchers assert about the same tree but answer different questions, so it's worth being precise about when each earns its place.

| Dimension | Rule-based<br/>`toBeValidA11yTree`, `toHaveNoUnlabeledInteractive`, … | Contract<br/>`toMatchA11yContract` | Snapshot<br/>`a11ySnapshot` + `toMatchSnapshot` |
|---|---|---|---|
| Asks | "Is this markup **legal**?" | "Is this the markup I **meant**?" | "Did **anything** change?" |
| Source of truth | ARIA rules | A spec you author | The last recording |
| Authoring cost | none | you write the contract | none (`-u` records it) |
| Scope | whole tree, blanket | only the nodes you list | whole tree, total |
| Churn on cosmetic change | no | no | **yes** |

### Rules and contracts catch *disjoint* bugs

The most important thing to internalize: `toBeValidA11yTree()` and `toMatchA11yContract()` are **orthogonal**. Each passes where the other fails.

**Valid ARIA, but violates your intent** — a rule can't help you:

```html
<a href="/signin">Sign in</a>   <!-- you meant a button -->
```

`toBeValidA11yTree()` **passes**: a named link is perfectly legal ARIA, and nothing in the spec says this is wrong. `toMatchA11yContract('button "Sign in"')` **fails**: you specified a button. *Validity can't know your intent.*

**Matches your intent, but invalid ARIA** — a contract can't help you:

```html
<main>
  <button>Save</button>
  <button aria-label=""></button>   <!-- unnamed -->
</main>
```

`toMatchA11yContract('main\n  button "Save"')` **passes**: containment only checks the nodes you listed, and the extra button is an allowed extra. `toBeValidA11yTree()` **fails**: `button` requires an accessible name. *A contract can't catch what you never thought to specify.*

### In practice

- **Rules everywhere.** `toBeValidA11yTree()` is a blanket floor with zero authoring cost — apply it broadly.
- **A contract for the flows where structure *is* the requirement** — a login form, a checkout step, a modal's focus scope. The rule catches "this is broken ARIA"; the contract catches "this is valid ARIA that's no longer the thing we designed."
- **A snapshot when you want total coverage** of a stable surface and accept the churn. Contracts are the deliberate middle ground: more intentional than a snapshot (a failure always means something you chose to care about), more expressive than a rule (it knows your design, which no rule engine can infer).

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
