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
| `.expectTree(snapshot, options?)` | Assert the current tree's serialization matches `snapshot`. `options` are `treeSnapshot`'s (see caveat below). |
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

`expectTree` re-serializes the tree with `treeSnapshot`'s **default options** unless you pass your own: no `redact`, `mode: "a11y"`, generic nodes flattened, and each node's [states block](/packages/testing/snapshots#what-a-line-carries) printed (`checkbox "Email me" {checked=false}`). A snapshot captured via `treeSnapshot(root, { redact: [...] })`, `{ mode: "dom" }` or `{ states: false }` matches only when you pass `expectTree` the same options. An expectation written before tree text carried states needs either its blocks added or `{ states: false }`.

A mismatch names the **first differing line** (with a couple of lines of context). It does not dump both full trees.

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

`a11yDiff` returns a boxed value that renders through the **same snapshot serializer** as `boxedTreeSnapshot` — register it once (`registerA11yMatchers` from [`/matchers`](/packages/testing/matchers)) and `toMatchSnapshot()` / `toMatchInlineSnapshot()` print the change list verbatim. Without it, the snapshot holds the same change list as a quoted string. `before` must be a pre-captured tree (extracting it at assert time would diff the tree against itself); `after` can be a live `Element`, captured for you. A `focus:` line appears only when both sides carry focus context (both `capture()`d).

The `~ listbox "Countries": childIds …` line says which container the two options joined. To leave such a line out when the `+`/`-` lines already explain it, pass `childIds: false`:

```ts
expect(a11yDiff(before, document.body, { childIds: false })).toMatchInlineSnapshot(`
  + option "Spain"
  + option "France"
  ~ combobox "Country": a11y.states.expanded false → true
`);
```

A move, where a node changes container without a `+`/`-` line, and a reorder still print their `childIds` lines.

A text change prints once. When an element's text is its name before and after, as with a `status` message or a paragraph, the diff prints the `a11y.name` line and leaves out the `dom.textContent` line that would repeat the same two strings:

```
~ status "That hour is closed.": a11y.name "" → "That hour is closed."
```

When the two differ, both lines print. A button whose `aria-label` stays put while its text changes prints only its `dom.textContent` line.

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

- **`ChangeSpec`** — the ergonomic default. `added` / `removed` / `changed` are matched by `role` + optional `name` (string = case-, whitespace-, and typography-normalized exact; RegExp = tested against the folded name). A `ChangedMatcher` may list `changes` (dot-paths that must appear). **Subset by default** — resilient to incidental changes; `exact: true` asserts nothing else changed. Two kinds of change never count as an extra on their own: a `childIds`-only change on a container (the structural shadow of an add/remove), and an `a11y.value`-only change (a field whose contents a `type` step changed). Assert a value change explicitly with `changes: ["a11y.value"]`.
- **`string`** — trim-compared against the `serializeTreeDiff` output, like `expectTree`. Includes the `focus:` line, and follows the project's [diff defaults](#setting-the-options-once). (This whole-diff text form compares literally — unlike the `ChangeSpec` name match, it is **not** typography-folded, so it stays a faithful snapshot.)
- **`(diff) => void`** — the escape hatch; throw to fail.

Calling `expectChanges` before any action throws. A `ChangeSpec` failure ends with the rendered diff, so "what *did* change?" is always answered. A string-form mismatch, like `expectTree`, names the first differing line instead of dumping both full texts.

Under the hood both styles are the engine's [`diffTrees`](/packages/testing#queries) rendered by `serializeTreeDiff` — an **in-realm** comparison keyed on node identity (a live before/after in one document), distinct from the [CLI's](/packages/cli) cross-process artifact diff.

### Setting the options once

A suite usually wants `childIds`, `values` and `redact` the same way in every test. Set them once, in the setup file that registers the matchers, and a call you forget to pass them to still prints the project's way:

```ts
// vitest.setup.ts
registerA11yMatchers(expect, {
  diff: { childIds: false, redact: [/\d{2}:\d{2}/] },
});
```

```ts
expect(a11yDiff(before, root)).toMatchSnapshot();                    // childIds: false, times redacted
expect(a11yDiff(before, root, { childIds: true })).toMatchSnapshot(); // this call only; times still redacted
```

In a suite that doesn't register the matchers, `configureA11y({ diff: { … } })` from `@real-a11y-dev/testing` does the same; `registerA11yMatchers` calls it with its second argument.

- **A call's options win key by key.** A key the call leaves out, or passes as `undefined`, takes the project's value, then the built-in default.
- **A call's `redact` replaces the project's list** rather than adding to it. `redact: []` turns redaction off for that call.
- **Each call that passes `diff` replaces the diff defaults**, so the last one wins. `{ diff: {} }` clears them; `registerA11yMatchers(expect)` with no second argument leaves them as they are.
- **They hold for the rest of the test file.** Set them in the setup file. A test that changes them for itself should put them back afterwards, or every later test in the file prints its way; under Vitest's `isolate: false`, so do later files.
- **They apply to every diff this package prints for a test:** `a11yDiff`, the text a `flow().expectChanges("…")` string is compared against, and the diff a `ChangeSpec` failure ends with. The [snapshot report](/packages/testing/snapshots#the-snapshot-report) redacts an `a11yDiff` record with the same patterns as its text.

## Recording what happened in between

A diff sees the page at two moments. A keyboard or screen-reader user meets a sequence: where focus goes, and what live regions announce, in that order. Whatever comes and goes between the two captures (focus dropping to the page for a moment, a "Deleting…" status shown and then cleared) never reaches the diff. `recordTimeline` records it, and, if you ask, the keys, clicks and typing that caused it.

### `recordTimeline(root, options?)`

Start it before the interaction, wait for the page's last change, then box what it heard with `stop()`:

```ts
import { recordTimeline } from "@real-a11y-dev/testing";

test("deleting a draft", async () => {
  render(<Drafts />);
  const timeline = recordTimeline(document.body);

  await user.click(screen.getByRole("button", { name: "Delete draft" }));
  await screen.findByText("Draft deleted.");

  expect(timeline.stop()).toMatchInlineSnapshot(`
    focus     button "Delete draft"
    announce  status "Deleting…"
    focus     (none)
    focus     button "New draft"
    announce  status "Draft deleted."
  `);
});
```

The diff of the same interaction shows only `focus: button "Delete draft" → button "New draft"` and the final status. The timeline also shows that focus fell to the page when the row was removed, where a screen reader announces the document and the user's reading position resets, that "Deleting…" was announced before it was cleared, and which came first at the end: the focus move or the message.

- **A `focus` line** names the focused node the way [`tabSequenceSnapshot`](/packages/testing/snapshots#tabsequencesnapshot-root-options) prints a stop: `role "name" {states}`. `(none)` means focus rests on `<body>` or `<html>`, or outside the root, whatever else the page is showing. The first line is where focus starts, unless it starts on nothing. A focused node the tree folds away, such as a `<div tabindex="-1">` with no name, still gets a line, as `generic`. One that assistive tech can't reach ends in `[hidden]`, since a screen reader meets nothing there: inside `aria-hidden`, `inert` or hidden (`hidden`, `display: none`) content, above the root as well as in it, which jsdom lets take focus (`button "A" [hidden]`). A focused option in a sensitive field's popup, such as a card's expiry month, prints `option "[redacted]"`, as the tab order prints it: which one holds focus says which is chosen.
- **An `announce` line** is the text a live region gains: an element with `aria-live="polite"` or `"assertive"`, or a `status` (an `<output>` included), `alert` or `log`. It names the region's role, and adds `{live=polite}` or `{live=assertive}` when `aria-live` sets a politeness the role doesn't imply (`<div aria-live="polite">` prints `announce  generic "Saved." {live=polite}`). The text is the text of the region's text nodes as a screen reader could read them, on one line: nothing `aria-hidden` or hidden, never a `<textarea>`'s markup, and blocks kept apart by a space. A change under `aria-live="off"` inside a region prints nothing on its own: the nearest `aria-live` decides. Nor does text in a region nested inside it, which announces for itself.
- **A region emptied prints nothing**, because nothing is announced, and neither does text a removal or a restyle takes out of a region: only text it gains prints. The same text set again prints nothing either; emptied, removed, or hidden first, it prints again, whether by its own `hidden`, `display` or `aria-hidden` or by a container that stops rendering it (`hidden`, `display: none`, a closed `<details>`). A region hidden from assistive tech from above, as a modal's `aria-hidden` or `inert` does to the rest of the page, keeps its text, so showing it again prints only text it gained meanwhile, and moving it, or the root, within one step prints nothing. A region inserted into another prints once, as itself; one inserted with a region inside it prints its whole text, the inner region's included, if it has text of its own outside the inner region, and the inner region prints a line of its own either way. A region switched to `aria-live="off"` prints nothing, and what it shows meanwhile counts as said when it turns live again. Text a region holds when recording starts counts as already said, even while hidden from above, switched off, or inside an open shadow root.
- **Lines follow the order the page made its changes**, even within one step: a focus line where focus came to rest on what it names, an announce line where its text was last written or shown. Text a page's `focus` or `blur` listener writes follows the move. What one synchronous run of the page's code does is read once, so text set and cleared in it, or focus passing through an element on the way to another, prints nothing. Anything an `await` separates is read separately, even an `await` of a promise that has already resolved, which a browser would render together with what came before: text set before one and cleared after it still prints.

The order is the point. In the example, React renders `setStatus("Draft deleted.")` later, while `newDraft.focus()` runs at once, so focus lands before the message arrives even though the handler sets the status first. A page that announces first and then moves focus prints the two lines the other way round. Which one a screen reader user hears first, and whether one cuts the other off, can depend on exactly that.

`stop()` returns a box like `a11yDiff`'s, so with the serializer registered ([`registerA11yMatchers`](/packages/testing/matchers)) it snapshots as the plain text above. A timeline that heard nothing prints `(nothing recorded)`. Calling `stop()` again returns the same box; nothing is recorded after the first call.

| Option | Default | What it does |
|---|---|---|
| `focus` | `true` | Record focus moves. |
| `announcements` | `true` | Record live-region announcements. |
| `interactions` | `false` | Also record what the user did: `press`, `click` and `type` lines. See [Lines for what the user did](#lines-for-what-the-user-did). |
| `redact` | none | Patterns masked as `[REDACTED]` in the names lines print and in announced text, as in the [other snapshots](/packages/testing/snapshots#using-redact). |

Pass `{ announcements: false }` for a focus-only timeline, so a copy change in a status message doesn't churn a focus test, or `{ focus: false }` for announcements alone. Turning both off throws, unless `interactions` is on: a recorder that listens for nothing could never fail. So does a root that isn't in the document, whose changes the recorder would never see. Jest's fake timers are fine, `queueMicrotask` faked included.

### Lines for what the user did

A timeline shows what the page did. With `{ interactions: true }` it also shows what the user did to cause it, so a stray focus move stands next to the key that should have caused it:

```ts
const timeline = recordTimeline(document.body, { interactions: true });
```

```
press     Tab
focus     button "Delete draft"
click     button "Delete draft"
announce  status "Deleting…"
focus     (none)
press     Escape
type      textbox "Email"
```

- **A `press` line** is a key that types no text, by its name, with the modifiers held (`Ctrl`, `Alt`, `Shift`, `Meta`, in that order): `Tab`, `Shift+Tab`, `Escape`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, an arrow, `ContextMenu`, `F1` to `F24`, `Space` outside a text field, and `Enter` outside a `<textarea>` or an editor, where it would type a line break. Where the recorder can't see what took the key, it counts it as a field: a custom element whose shadow root is closed, and an element with a `textbox`, `searchbox` or `combobox` role, print no `Space` or `Enter`. A character key prints only as a shortcut, held with `Ctrl` or `Meta` (`Ctrl+A`); `AltGr`, which reports `Ctrl` and `Alt` together, types one, so it prints nothing. A modifier on its own, a key composing text through an input method, and any other key print nothing. Ten `ArrowDown` presses print ten lines.
- **A `click` line** is a `click` event the page received, from a pointer, from a key that activates (`Enter` on a button sends a click too, so it prints `press     Enter` and then a click line) or from script. It names what the click activates, the way a focus line names its node: the nearest element from the target up that can take focus or has a role a click activates, so a click on a button's icon prints the button. Where there is none, it names the target itself, and one the tree folds away prints as `generic`. A click on a `<label>` prints two lines, because the page receives two clicks: the label's, then its control's.
- **A `type` line** is typing into a text field, a `<textarea>` or an editor. **It names the field, never the characters.** Typing into one field prints one line however many keystrokes it took, until something else prints a line, so `Backspace` in the middle splits it in two. A sensitive field (a password, a card number, a one-time code) prints its role and name alone. A click or type line builds its name as [strict mode](/packages/testing/snapshots#strict-mode) does, so a field whose `aria-labelledby` points at itself, or at another field, isn't named by what was typed there.
- **Lines say what the page received**, whatever sent it, so `fireEvent`, `user-event`, Playwright and a person mean the same thing by them. `fireEvent.click` sends a click and no pointer press, so it prints a click line and no focus line. A pointer click moves focus when the button goes down and clicks when it comes up, so its focus line comes first:

  ```
  focus     button "Save"
  click     button "Save"
  ```

  Each line is placed among the page's changes as a focus line is, so a Tab prints before the focus move it makes, and a click before what its handler announced. A click is named as it happened, so a button that removes itself still prints its name.

**What the lines never hold.** No typed character reaches a line or a recorded event, in a password field or any other: no character key, nothing from an `input` or `beforeinput` event's data, no clipboard content. Only what is inside the root is recorded, but a key pressed with focus resting on the page prints, as `focus     (none)` does.

**What it doesn't model yet:**

- **Only what the root holds** is recorded. Pass `document.body` to hear the whole page, including a toast portaled outside your component.
- **Changes inside a shadow root** aren't heard as they happen: a `MutationObserver` doesn't reach them. Light-DOM text a slot shows in a region is, and so is focus inside an open shadow root.
- **A stylesheet's own change**, such as a `<style>` edited or added, isn't read as a restyle: text that change alone shows in a region prints at the region's next change, and is placed by the reads at focus moves.
- **Only text nodes are read.** An image's `alt`, an `aria-label` inside a region and a field's value are left out, so `<img alt="Success"> Saved` prints `"Saved"`, and a region whose message is only an image or a label prints no line.
- **`aria-atomic`, `aria-relevant` and `aria-busy`** aren't read: an announce line is always the region's whole text.
- **Order around a focus move within one step is best-effort.** An announce line goes before a focus move made in the same synchronous run when the region already said its final text at the move, or that text with some of its elements removed since. A run that rewrites the region into new elements after the move and drops part of it places the line after the move, though the words that stay were there before.
- **A region inserted already holding its text** prints like any other. Most screen readers don't announce one, `role="alert"` being the usual exception, so a line for a `status` that arrived with its message may be a message nobody hears.
- **No strict mode.** There is no `redactInput` here yet, so a timeline can't promise what [strict mode](/packages/testing/snapshots#strict-mode) does for the other snapshots: a focused name built from typed text, or an editor inside a live region, prints as it is. `type` and `click` lines are the exception: they name their node as strict mode would, and print nothing typed.
- **An interaction a script sends inside a shadow root without `composed: true`** never reaches the document, so it is recorded only in an open shadow root focus has been in. `flow().type()` sends its `input` that way and moves no focus first, so typing it does inside a shadow root prints no `type` line.
- **Other gestures** aren't recorded: a `pointerdown` with no click, a double click, a context menu, a drag, a form's `submit`, and keys released (`keyup`).
- **In the page only.** The recorder runs where the test's DOM is: jsdom, or a runner that runs the test inside a browser. The [Playwright adapter](/packages/testing/playwright), which drives a page from outside, has no timeline yet, and the [snapshot report](/packages/testing/snapshots#the-snapshot-report) doesn't draw one.

Call `stop()` even when the test fails before it, in a `finally` or an `afterEach`: until then, the recorder keeps listening to the document, and reads the root's tree on every later focus move.

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
