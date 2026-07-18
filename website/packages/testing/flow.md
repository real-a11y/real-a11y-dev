---
title: "Flow API — @real-a11y-dev/testing"
description: Fluent interaction chains that assert about the accessibility tree after each step. How flow() compares to Testing Library, and when to use which.
---

# Flow API

Fluent interaction chains that assert about the **accessibility tree** after each step. Each `.click()` / `.type()` / etc. dispatches a real DOM action, then re-extracts the tree so the next step sees the post-interaction state.

Part of [`@real-a11y-dev/testing`](/packages/testing).

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

## Why `flow()` (vs Testing Library)?

Testing Library asserts about the **rendered DOM**. `flow()` asserts about the **extracted accessibility tree** — the same tree screen-reader users perceive and the same tree the Real A11y panel shows. That difference changes which tests are easy to write.

`flow()` is **not** a Testing Library replacement. They compose well: `userEvent` for input-fidelity (real keyboard/pointer sequences); `flow()` for tree-shape and "is the right region active" assertions.

### Side-by-side: same test, both libraries

A common flow — open a confirm dialog, dismiss it, assert it closed:

```ts
// Testing Library
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

test("delete-confirm dialog", async () => {
  render(<AccountSettings />);
  const user = userEvent.setup();

  await user.click(screen.getByRole("button", { name: /delete account/i }));

  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveAccessibleName(/confirm/i);

  await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});
```

```ts
// flow()
import { flow } from "@real-a11y-dev/testing";

test("delete-confirm dialog", async () => {
  render(<AccountSettings />);

  await flow(document.body)
    .findByRole("button", { name: /delete account/i })
    .click()
    .expectActiveModal((name) => /confirm/i.test(name))
    .findByRole("button", { name: /cancel/i })
    .click()
    .expectActiveModal(null);
});
```

Both pass on the same component. The Flow version is shorter because `expectActiveModal` is a single tree-level invariant — "exactly one dialog is open AND its name matches." Expressing the same in RTL stitches `getByRole` + `within` + `toHaveAccessibleName` + `queryByRole` together. And because Flow re-extracts the tree after `.click()`, the next `findByRole` already sees the new dialog without an explicit `within(dialog)` scope.

### When to use which

| Reach for Testing Library when… | Reach for `flow()` when… |
|---|---|
| You need `userEvent` keyboard/pointer fidelity (`tab()`, `keyboard("{Enter}")`, hover, paste, etc.) | The assertion is about the a11y tree shape, not a single element |
| Per-element matchers fit (`toHaveValue`, `toBeChecked`, `toBeDisabled`) | You want to assert "the right modal is now open" or "no modal is open" in one step |
| Your codebase is already deep in RTL idioms and you want to stay consistent | The same audit logic must also run in a real browser via the [Playwright adapter](/packages/testing/playwright) |
| Testing one component in isolation | The test traces a flow that crosses multiple components/regions |
| You care about the simulated input (e.g. testing a custom keyboard handler) | You care about the **outcome** in the a11y tree (states, structure, active modal) |

The two libraries see different things. RTL sees what *sighted users using a mouse and keyboard* experience. `flow()` sees what *AT users* experience after the same actions. For most teams the right answer is **both, in the same suite**.

## Available steps

| Step | Description |
|---|---|
| `.findByRole(role, opts?)` | Move the cursor to the first matching node. Throws if not found. |
| `.click()` | Dispatch a click action on the current node. |
| `.submit()` | Dispatch a submit action (form). |
| `.toggle()` | Dispatch a toggle action (`<details>`/`<summary>`; falls back to click for ARIA disclosures). |
| `.select(value)` | Dispatch a select action with the given value (native `<select>`). |
| `.type(text)` | Dispatch a type action with the given text (textbox, searchbox). |
| `.expectTree(snapshot)` | Assert the current tree's serialization matches `snapshot` (see caveat below). |
| `.expectChanges(spec \| string \| fn)` | Assert **what the interaction(s) changed** in the tree since the diff window opened (see [Asserting what an interaction changed](#asserting-what-an-interaction-changed)). |
| `.expectActiveModal(predicate)` | Assert the active dialog. Pass `null` to assert no dialog is open, or `(name) => boolean` to assert one is open and its accessible name satisfies the predicate. |
| `.expect(fn)` | Run a custom assertion with the current tree as argument. |

The flow is lazy — steps queue up and run when you `await` the chain.

### `expectActiveModal` — examples

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

### `expectTree` — caveat

`expectTree` re-serializes the tree with **default options** (no `redact`, `mode: "a11y"`, generic nodes flattened). A snapshot captured via `auditSnapshot(root, { redact: [...] })` or `{ mode: "dom" }` will not match. For redacted or DOM-mode comparisons, use `.expect((tree) => { … })` and call `serializeTree`/`auditSnapshot` yourself.

## Asserting what an interaction changed

The differentiator over element-querying: assert the **effect** of an interaction on the whole tree — options appearing, `aria-expanded` flipping, focus moving — not just one element's final state. Two styles, same underlying diff.

### Style A — `capture` + `a11yDiff` (imperative, inline snapshot)

Capture the tree before, interact with whatever you like (`userEvent`, `fireEvent`, a raw click), then diff against the live root:

```ts
import { capture, a11yDiff } from "@real-a11y-dev/testing";

test("opening the country picker", () => {
  render(<CountrySelector />);
  const before = capture(document.body);

  fireEvent.click(screen.getByRole("combobox", { name: /country/i }));

  expect(a11yDiff(before, document.body)).toMatchInlineSnapshot(`
    + option "Spain"
    + option "France"
    ~ combobox "Country": a11y.states.expanded false → true
    ~ listbox "Countries": childIds 0 children → 2 children
  `);
});
```

`a11yDiff` returns a boxed value that renders through the **same snapshot serializer** as `auditSnapshot` — register it once (`registerA11yMatchers` from [`/matchers`](/packages/testing/matchers)) and `toMatchSnapshot()` / `toMatchInlineSnapshot()` print the change list verbatim. `before` must be a pre-captured tree (extracting it at assert time would diff the tree against itself); `after` can be a live `Element`, captured for you. A `focus:` line appears only when both sides carry focus context (both `capture()`d).

### Style B — `flow().expectChanges` (fluent, structured)

Inside a flow, `expectChanges` diffs everything since the chain's first action (or the previous `expectChanges`, which resets the window):

```ts
await flow(document.body)
  .findByRole("combobox", { name: /country/i })
  .click()
  .expectChanges({
    added: [
      { role: "option", name: "Spain" },
      { role: "option", name: "France" },
    ],
    changed: [{ role: "combobox", changes: ["a11y.states.expanded"] }],
    exact: true,
  });
```

Three forms:

- **`ChangeSpec`** — the ergonomic default. `added` / `removed` / `changed` are matched by `role` + optional `name` (string = case-, whitespace-, and typography-normalized exact; RegExp = tested against the folded name). A `ChangedMatcher` may list `changes` (dot-paths that must appear). **Subset by default** — resilient to incidental changes; `exact: true` asserts nothing else changed (a `childIds`-only change on a container is treated as the structural shadow of an add/remove and never counts as an extra).
- **`string`** — trim-compared against the `serializeTreeDiff` output, like `expectTree`. Includes the `focus:` line. (This whole-diff text form compares literally — unlike the `ChangeSpec` name match, it is **not** typography-folded, so it stays a faithful snapshot.)
- **`(diff) => void`** — the escape hatch; throw to fail.

Calling `expectChanges` before any action throws. A `ChangeSpec` / `string` failure ends with the full rendered diff, so "what *did* change?" is always answered.

Under the hood both styles are core's [`diffTrees`](/packages/core#difftrees-before-after) rendered by `serializeTreeDiff` — an **in-realm** comparison keyed on node identity (a live before/after in one document), distinct from the [CLI's](/packages/cli) cross-process artifact diff.

## `flow(root, options?)`

| Option | Type | Default | Description |
|---|---|---|---|
| `waitTimeout` | `number` | `200` ms | Max wait for the post-action debounced mutation cycle. Increase for slow async UIs; decrease for tighter feedback in pure-DOM flows. |

```ts
await flow(root, { waitTimeout: 500 })
  .findByRole("button", { name: /save/i })
  .click();
```

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

## See also

- [Matchers](/packages/testing/matchers) — `expect`-style assertions, including post-`flow()` modal checks
- [Playwright adapter](/packages/testing/playwright) — run the same audits in a real browser
