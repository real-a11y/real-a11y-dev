---
title: "Snapshots — @real-a11y-dev/testing"
description: Deterministic string snapshots of the accessibility tree — treeSnapshot, outlineSnapshot, tabSequenceSnapshot — plus redact patterns for stable CI.
---

# Snapshots

Deterministic string representations of the accessibility tree. Safe to commit — the same DOM always produces the same string.

Part of [`@real-a11y-dev/testing`](/packages/testing). For the ergonomic `expect(...).toMatchSnapshot()` form, see [Matchers](/packages/testing/matchers).

## `treeSnapshot(root, options?)`

Returns a formatted string of the full semantic tree.

> Using the [matchers](/packages/testing/matchers) entry? `boxedTreeSnapshot()` renders the **same tree** with cleaner snapshot tooling. `treeSnapshot` returns a raw string you can assert on or write to a file; `boxedTreeSnapshot` returns a serializer-boxed value for native `toMatchSnapshot()`. See [`boxedTreeSnapshot` vs `treeSnapshot`](/packages/testing/matchers#boxedtreesnapshot-vs-treesnapshot).

```ts
import { treeSnapshot } from "@real-a11y-dev/testing";

test("login form structure", () => {
  render(<LoginForm />);
  expect(treeSnapshot(document.body)).toMatchSnapshot();
});
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `"a11y" \| "dom"` | `"a11y"` | Tree extraction mode. |
| `redact` | `RegExp[]` | `[]` | Patterns replaced with `[REDACTED]` in accessible names. Use this to keep snapshots deterministic. |
| `includeGeneric` | `boolean` | `false` | Include generic container nodes (`role="generic"`). |
| `markFocus` | `boolean` | `true` | Mark the element focused at extraction time with a trailing `[focused]`. See [Focus marker](#focus-marker). |
| `values` | `boolean` | `false` | Print each field's announced value: `textbox "Email" = "jane@x.com"`. See [Field values](#field-values). |
| `states` | `boolean` | `true` | Print each node's states, description and announced properties as a `{…}` block: `checkbox "Subscribe" {checked=false}`. See [What a line carries](#what-a-line-carries). |
| `redactInput` | `boolean` | `false` | Strict mode: no field value and no rich-text editor content, names included. See [Strict mode](#strict-mode). |

### What a line carries

A tree line is `role "name"`, plus `= "value"` with `values: true`, `(level N)` where the node has a level, a `{…}` states block where the node has anything to print, and `[focused]` with `markFocus`. A tab-order line carries the same except the level:

```
checkbox "Subscribe" {checked}
checkbox "Subscribe" {checked=false}
button "Menu" {expanded=false} [focused]
textbox "Email" = "a@b.c" {required, invalid, description="We never share it"}
link "Docs" {current=page}
heading "Setup" (level 2)
```

The block holds the states, description and announced properties a screen reader presents beyond role and name, so a snapshot fails when a checkbox is unchecked, an `aria-expanded` flips, or a description changes. Tokens come in a fixed order and print only when they carry information:

| Key | Prints |
|---|---|
| `checked`, `pressed` | `key`, `key=false`, `key=mixed`: a screen reader says "not checked", so false prints |
| `expanded` | `expanded`, `expanded=false` ("collapsed") |
| `selected`, `disabled`, `readonly`, `required` | `key`, only when true: false is what absent means |
| `invalid` | `invalid` for any invalid value, `grammar` and `spelling` included |
| `current` | `current`, or `current=page` (`step`, `location`, …) |
| `haspopup` | `haspopup=menu` (`listbox`, `dialog`, …) |
| `roledescription`, `description` | `roledescription="slide"`, `description="…"`: JSON-quoted, and `redact` applies |

Nothing else prints: not `focusable`, `editable`, `busy` or `modal`, and not `level`, which keeps its `(level N)`. A [strict-mode](#strict-mode) tree prints no description that would carry a field's value.

**Where the producers differ.** The two producers read most states alike: checked, pressed, expanded, selected and disabled on checkboxes, radios, switches, toggle buttons, selects, list boxes, menus, trees and tabs, and required and invalid on text fields. Where they differ, a DOM snapshot and a native one of the same page differ by those tokens:

| Key or case | DOM producer (jsdom, `treeSnapshot`, `real-a11y tabs`) | Native producer (Chromium's own tree: the [Playwright adapter's](/packages/testing/playwright) `tree: "native"`, `real-a11y tree`, MCP) |
|---|---|---|
| `haspopup`, `roledescription` | not read | read |
| `current` | read | not read |
| A pristine required checkbox, radio or `<select>` | `required`; `invalid` only once the user has interacted (`:user-invalid`, as HTML-AAM says) | `invalid` from the start, and no `required` |
| A description from a table caption, an SVG `<desc>` or ruby text | none | read |
| `readonly` on the cells of a read-only grid | none | read |
| `checked=false` on an ARIA checkbox with no `aria-checked` | none | read |

**Opting out.** `treeSnapshot(root, { states: false })` prints no block, byte for byte the text the serializer printed before it had blocks: use it to keep comparing with a baseline committed then, or re-record your snapshots once (`vitest -u`, `jest -u`) to take the states in. To see what one interaction changed, [`serializeTreeDiff`](/packages/testing/flow) still prints each changed state, description and property as its own `~` line.

### Field values

Pass `values: true` to print what each field holds, the way a screen reader announces it:

```
form "Checkout"
  textbox "Email" = "jane@x.com"
  combobox "Country" = "Spain" {expanded=false}
  textbox "Password" = "[redacted]"
  slider "Tip" = "15%"
```

- **What the value is.** A text field's or editor's text, a `<select>`'s selected option **label** (`"Spain"`, not its `value="es"`), and a range widget's `aria-valuetext` (else `aria-valuenow`). Checkboxes and radios carry none; their `checked` state prints in the states block (see [What a line carries](#what-a-line-carries)). Whitespace collapses, and a value is capped at 240 characters.
- **Sensitive fields never print.** A `type="password"` field, or one whose `autocomplete` names a credential or payment field (`current-password`, `new-password`, `one-time-code`, `cc-number`, `cc-csc`, `cc-exp*`), prints `"[redacted]"` when it holds anything. Nor does any line say which choice it holds: an option inside a sensitive field, or in its popup (a listbox it controls with `aria-controls`, owns with `aria-owns` or points `aria-activedescendant` into, or one a combobox around it holds), carries no `selected`, and nothing in such a popup carries a description. In `tabSequenceSnapshot`, a stop that is one of the items there (an option, a radio, a day in a date grid) reads `option "[redacted]"`: under a roving `tabindex` the popup's one stop is its chosen item, so its name would say which it is. Strict mode (`redactInput`) does the same for an option in any list box. `treeSnapshot` still names every item.
- **Off by default.** A committed snapshot only changes when you ask for values. `redact` patterns apply to values as they do to names.

The value lives on the node as `a11y.value`, so a custom assertion can read it directly.

Example output:

```
main
  heading "Sign in" (level 1)
  form "Sign in"
    group "Credentials"
      textbox "Email address"
      textbox "Password"
    button "Sign in"
    link "Forgot password?"
```

### Strict mode

`redactInput: true` keeps every field value and all rich-text editor content out of the output, the same strict mode as the CLI's `--redact-input` and the [Playwright adapter's](/packages/testing/playwright#strict-mode-redactinput). No value prints even with `values: true`, and a name that would carry typed text — a heading around an editor, a button labelled by one, a heading inside one — reads `"[redacted]"` whole, as the native tree reads it. A name from the page's own markup (an `aria-label`, an image's `alt`) is kept.

```ts
treeSnapshot(container, { redactInput: true });
```

It works on a DOM root, which it extracts in strict mode. A name is built at extraction, so an already-extracted tree must have been read in strict mode too (its `source.redactInput` is set); any other tree makes it throw rather than print names it can't take a value back out of. `outlineSnapshot` and `tabSequenceSnapshot` take the option the same way.

### Using `redact`

`redact` takes an array of regexes. Any substring of an **accessible name** that matches one is replaced with the literal placeholder `[REDACTED]`. The element, its role, and its position are untouched — only the volatile text inside its name is masked.

#### Without `redact` — the snapshot flakes

A relative timestamp in an `aria-label` changes between runs, so the committed snapshot fails even though nothing actually regressed:

```ts
// rendered: <button aria-label="Saved 2 minutes ago">
expect(treeSnapshot(container)).toMatchSnapshot();
```

```
button "Saved 2 minutes ago"     ← committed at 10:00
button "Saved 5 minutes ago"     ← CI at 10:03   →  snapshot mismatch ✗
```

#### With `redact` — stable structure, masked text

```ts
// rendered: <button aria-label="Saved 2 minutes ago">
expect(
  treeSnapshot(container, {
    redact: [/\d+ (seconds?|minutes?|hours?) ago/],
  }),
).toMatchSnapshot();
```

```
button "Saved [REDACTED]"        ← identical on every run ✓
```

You still catch real regressions — if the button lost its label the name would change to `""` — you just stop catching "the clock advanced."

#### Realistic patterns

Most flakes come from a handful of sources. Pass a regex for each noisy bit:

```ts
import { treeSnapshot } from "@real-a11y-dev/testing";

expect(
  treeSnapshot(container, {
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

The redaction happens **after** name computation — so an `aria-label="Updated 2 minutes ago"` becomes `[REDACTED]` in the snapshot string without changing the underlying tree. The element still appears, its role and structure still matter.

Define one shared list and reuse it across the suite so every snapshot masks the same noise consistently:

```ts
// test/redact.ts
export const COMMON_REDACTS = [
  /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/g,
  /:r[0-9a-z]+:/g,
];

// anywhere a snapshot is taken
expect(treeSnapshot(container, { redact: COMMON_REDACTS })).toMatchSnapshot();
```

::: tip How `redact` works — and two gotchas
- It runs on the **accessible name only**, at serialization time. Roles, heading levels, and tree shape are never modified — `redact` changes the snapshot *string*, not the extraction.
- Patterns apply **in order**, cumulatively.
- **Add the `g` flag if a name can contain more than one match.** Internally each pattern runs `name.replace(pattern, "[REDACTED]")`, and `String.replace` without `/g` only replaces the *first* match — so `"Created 2026-01-01, edited 2026-02-02"` with `/\d{4}-\d{2}-\d{2}/` masks just the first date. `/\d{4}-\d{2}-\d{2}/g` masks both.
- **Redact the narrowest thing that's actually volatile.** Masking a whole name blinds the snapshot to real regressions in it — remove the clock, not the label.
:::

> Available everywhere snapshots are: `treeSnapshot` and the [`boxedTreeSnapshot`](/packages/testing/matchers#boxedtreesnapshot-root-options-—-snapshot-serializer) matcher in jsdom, and the [Playwright adapter](/packages/testing/playwright#redacting-variable-content) — which marshals each `RegExp` across the browser boundary for you.

## `outlineSnapshot(root, options?)`

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

Honors `markFocus` (default `true`) — a focused heading is shown with a trailing `[focused]`. See [Focus marker](#focus-marker).

## `tabSequenceSnapshot(root, options?)`

Returns the tab sequence, one stop per line in Tab order.

The stops are the ones Chromium tabs to. An `<a>` without an `href` is not one, not even with `role="button"`, which is the keyboard bug worth catching. Nor is a control disabled directly or by its `<fieldset>`, or an element whose `tabindex` is not an integer, such as `""`. An `aria-disabled` control is a stop, because `aria-disabled` announces a state and leaves focus alone. So is the `<summary>` that toggles a `<details>`, such as an FAQ accordion's question, listed as `generic` and named by its text. Only the first `<summary>` child of a `<details>` is a stop; any other summary is plain text to Chromium. So is an image map's `<area href>` while the image using its map is rendered, listed at the area's own place in the document, where Chromium tabs to it. An area in a hidden or `inert` `<map>` is not: Chromium tabs to one, but leaves it out of its accessibility tree. [`toHaveTabSequence`](/packages/testing/matchers#tohavetabsequence-expected) counts the same way.

Nothing in the body of a closed `<details>` is a stop, not even a `<details>` nested in it. Chromium renders a closed disclosure as its summary alone, so Tab reaches the body only once it opens. The body is out of [`treeSnapshot`](#treesnapshot-root-options) and [`outlineSnapshot`](#outlinesnapshot-root-options) too, and [`toHaveTabSequence`](/packages/testing/matchers#tohavetabsequence-expected) counts the same way.

```ts
expect(tabSequenceSnapshot(document.body)).toMatchSnapshot();
```

Example output:

```
link "Skip to content"
link "Home"
link "About"
textbox "Search"
button "Submit search"
```

A rich-text editor counts the way Chromium counts it. Each `contenteditable` region is one stop, named by its label and never by what was typed into it. A link inside the editor is not a stop, because Chromium can't focus it, unless it sits in a `contenteditable="false"` island such as a mention chip.

Lines carry **no** `NN.` position number: line order already conveys the sequence, and a hard-coded number renumbers every following line the moment one stop is inserted near the top — churning the whole snapshot's diff for one real change. For a human-read listing where an explicit "stop 7" helps, add the numbers at render time with `numberTabStops` from `@real-a11y-dev/testing` (`numberTabStops(tabSequenceSnapshot(root))`); never store the numbered form.

Honors `markFocus` (default `true`) — the currently-focused stop is shown with a trailing `[focused]`. See [Focus marker](#focus-marker).

## Focus marker

Every serializer marks the element that held focus **when the tree was extracted** with a trailing `[focused]`. This turns focus management — invisible in a plain tree dump — into a one-line, committable assertion.

It's on by default. The marker appears **only when something inside the tree actually holds focus**: a freshly-rendered page (focus resting on `<body>`) serializes exactly as before, so snapshots of un-interacted UI don't change.

### Assert where an interaction put focus

```ts
render(<SignIn />);
screen.getByLabelText("Email").focus();

expect(treeSnapshot(document.body)).toMatchInlineSnapshot(`
  main
    heading "Sign in" (level 1)
    form "Sign-in form"
      textbox "Email" [focused]
      button "Sign in"
`);
```

### Assert a modal orients the user (the outline view)

Focusing a dialog's primary heading when it opens is an excellent practice — it instantly orients keyboard and screen-reader users without landing on a destructive button or the first form field. The heading outline makes that contract assertable in one line:

```ts
openDeleteAccountDialog();

expect(outlineSnapshot(document.body)).toMatchInlineSnapshot(`
  h1 Dashboard
    h2 Delete account [focused]
`);
```

If focus had instead fallen to the destructive **Delete** button — or nowhere — the marker would move (or vanish), and the assertion would fail.

### Turning it off

Pass `markFocus: false` for marker-free output — e.g. when comparing against a tree from a source that has no concept of focus:

```ts
treeSnapshot(document.body, { markFocus: false });
```

### Upgrading an existing suite

Because the marker is on by default, a committed snapshot **captured after an interaction that moved focus** will gain a `[focused]` line the first time you run it on this version. That's the marker surfacing focus the snapshot was silently omitting — review the diff and re-record once (`vitest -u` / `jest -u`). Snapshots of un-interacted UI (focus on `<body>`) are unaffected.

## Determinism

All three helpers return the **same string** for the same DOM — on every run, on every machine. No timestamps, no generated IDs, no ordering surprises. The `[focused]` marker is deterministic too: the same interaction leaves focus on the same element, so the same steps always produce the same string. That's the property that makes `toMatchSnapshot()` safe in CI without flakes. For genuinely variable content, use [`redact`](#using-redact); to drop the focus marker entirely, pass [`markFocus: false`](#focus-marker).

## The snapshot report

A snapshot's text is made to be committed and diffed, so it leaves most of the tree out: [no states, no description](#what-a-line-carries), nothing about what an element takes. The snapshot report shows the rest. Add its reporter to Vitest or Jest, and after every run `a11y-snapshots/index.html` draws each snapshot's tree the way the Semantic Navigator panel does.

::: code-group

```ts [Vitest]
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    reporters: ["default", "@real-a11y-dev/testing/reporter"],
  },
});
```

```js [Jest]
// jest.config.js
module.exports = {
  reporters: ["default", "@real-a11y-dev/testing/reporter/jest"],
};
```

:::

Keep `"default"` in the list: naming any reporter replaces the runner's own output. Then run your tests as usual. The run ends with a link to the page:

```
 a11y snapshots  6 recorded → file:///…/a11y-snapshots/index.html
```

The page is one self-contained file. It opens from disk, needs no server, and works offline. Add `a11y-snapshots/` to your `.gitignore`.

### What it shows

- **Every boxed snapshot of the run**, by test file and test: each [`boxedTreeSnapshot()`](/packages/testing/matchers#boxedtreesnapshot-root-options-—-snapshot-serializer) and each [`a11yDiff()`](/packages/testing/flow#asserting-what-an-interaction-changed).
- **A tree snapshot as a tree** you can open and close, with each row's states and what it takes (`interactive`, `focusable`, `selected`, `invalid`, …), filters for headings, links, buttons, forms and landmarks, and the TAB view: the tab stops in order.
- **A diff on the tree it describes.** The after tree opens with what changed marked: new rows, changed rows with the field that changed (a description, the order of a row's children and where focus went among them), and a count of rows removed. The before tree is one click away.
- **The snapshot's text** beside it, as the `.snap` holds it, its `+` added, `-` removed and `~` changed lines coloured.

Its `.snap` text is still what a test asserts. The report only shows a snapshot, and never fails a run. The page a snapshot was taken of is gone, so nothing in the report clicks, types or selects.

### What it records

Only a boxed snapshot has a tree behind it. A snapshot of a plain string, such as `expect(treeSnapshot(el)).toMatchSnapshot()`, has none, so it doesn't appear. Snapshot `boxedTreeSnapshot(el)` instead to see it in the report. Each record is named after its test, which the recorder reads from the `expect` you pass to [`registerA11yMatchers(expect)`](/packages/testing/matchers), or from the runner's own `expect` (Vitest's too with `globals` off). Vitest names a test `describe > test`, which the page splits into its describe path and its own name; Jest joins the two with a space, so the page shows the whole name.

Which tests record:

- **Not a concurrent test** (`describe.concurrent`, `test.concurrent`, or Vitest's `sequence.concurrent`): tests running together share one `expect`, which can't say which of them took a snapshot, so the run warns once and records none of theirs.
- **A retried test keeps the try that counted** under Vitest. Jest doesn't say which try is running, so there a retried test keeps its failed tries' records too.
- **Two Vitest projects that run one file** each keep their records, and the page names the project beside the file.

A record shows states, which the text leaves out, but nothing typed into the page:

- **No field value**, even where the snapshot printed one with [`values: true`](#field-values): the text beside the tree shows it, and the tree holds none. No `a11y.value`, and no `value`, `aria-valuenow` or `aria-valuetext` attribute.
- **Nothing inside an editor.** A rich-text editor's lines and runs are left out of the record, and the nodes above a field keep their own text but not a preview of the field's.
- **Sensitive fields are masked** as the extractor reads the page, and [`redactInput: true`](#strict-mode) withholds every value and all editor content from the record as from the text.
- **A snapshot's [`redact`](#using-redact) patterns** apply to everything in the record the page supplied: names, descriptions, text, and attribute values, the page's own element ids included. They leave alone what the record builds its tree from and what the panel reads as structure: node ids, roles, `tabindex`, a heading's level, and states. So a pattern like `/\d+/` can't merge rows or reorder the tab stops.

States and descriptions are recorded as the panel shows them, so a selected option still says it is selected, and a description that quotes a field it points at (`aria-describedby` on a control holding a value) quotes it in the record too, as an `a11yDiff`'s text does. Use `redactInput: true` to keep those out.

### Options

Both reporters take the same options, as the runner's `[name, options]` pair:

```ts
reporters: [
  "default",
  ["@real-a11y-dev/testing/reporter", { outputDir: "reports/a11y" }],
],
```

| Option | Type | Default | Description |
|---|---|---|---|
| `outputDir` | `string` | `"a11y-snapshots"` | Where `index.html` and the `records/` it is made from go, relative to Vitest's `root` or Jest's `rootDir`. |

The report deletes only a `records/` folder it made, and overwrites only an `index.html` it wrote. Pointed at a folder that already holds others by those names, it leaves them alone, records nothing, and says why.

### In CI and watch mode

- **CI:** upload `a11y-snapshots/index.html` as an artifact, and anyone on the pull request can open what the run recorded. The page holds the records and nothing else: no path from the machine that ran it.
- **Watch mode:** each rerun, in Vitest or Jest, replaces the records of the files it ran and writes the page again. Reload it to see the new run, or keep [`npx real-a11y show-report`](/packages/cli/commands#show-report-dir) open in another terminal, and the page redraws by itself.
- **`vitest --merge-reports`** clears nothing and writes the page from the records in `outputDir`. Copy each shard's `records/` folder there first to see them all.

The reporters need Vitest 3 or later, or Jest 29 or later, and Node 20.16 or later.

### `REAL_A11Y_TREES_DIR`

Both reporters work by setting `REAL_A11Y_TREES_DIR` for the run. While it is set, each boxed snapshot writes the tree behind it to that directory as JSON, one file per snapshot (`<test file>/<test name>-<n>.json`, the folder per Vitest project too), the before and after trees for a diff. You only need to set it yourself to keep those records without the reporter.

## See also

- [Matchers](/packages/testing/matchers) — `boxedTreeSnapshot()` serializer so `expect(el).toMatchSnapshot()` renders the tree directly
- [The snapshot report](#the-snapshot-report) — every boxed snapshot of a run, drawn as a tree with its states and changes
- [Playwright adapter](/packages/testing/playwright) — the same snapshots against a real browser
- [CI Diff Bot recipe](/guide/ci-diff-bot) — running [`@real-a11y-dev/cli`](/packages/cli)'s `snapshot` / `diff` in a PR workflow

> **In-suite vs. headless.** The serializers on this page (`treeSnapshot` / `outlineSnapshot` / `tabSequenceSnapshot`) produce strings inside your test run, committed with `toMatchSnapshot()`. For a headless page-set audit of a deployed site — no test suite — use [`@real-a11y-dev/cli`](/packages/cli)'s identically-named `snapshot` command (a whole page set → one JSON artifact) and `diff`.
