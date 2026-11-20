# @real-a11y-dev/serialize

Deterministic text serialization of the [Semantic Navigator](https://real-a11y.dev) accessibility tree. The same string format the testing snapshots, the `real-a11y` CLI (`tree`/`outline`/`tabs`), the MCP server, the injected page bundle, and the Chrome extension's Copy/export all share. (The `inspector`, `react` and `storybook-addon` panels do not use it.)

> **Internal package — not published to npm.** It is bundled into
> [`@real-a11y-dev/testing`](../testing), the `real-a11y` CLI, the MCP server,
> the internal [`browser`](../browser) driver's page-bundle, and the Chrome
> extension — every surface that prints one of these views already carries it.
> There is nothing to install and nothing to import by this name. The examples
> below are written from inside the workspace, for anyone working on the format
> itself.
>
> It was published up to `0.1.0-beta.12` before becoming internal.
> [`@real-a11y-dev/testing`](https://real-a11y.dev/packages/testing) is the
> published home for the serializers: `serializeTree`, `serializeTreeDiff`,
> `extract`, `SerializeOptions` and `TreeDiffSerializeOptions` keep their names,
> while `serializeOutline` and `serializeTabSequence` arrive as
> `outlineSnapshot` and `tabSequenceSnapshot` (with `treeSnapshot` aliasing
> `serializeTree`), and `numberTabStops` keeps its name too. Only
> `foldTypography` and the `SerializeInput` type are not re-exported, and those
> two have no published replacement.

```ts
import {
  serializeTree,
  serializeOutline,
  serializeTabSequence,
} from "@real-a11y-dev/serialize";

serializeTree(document.body);
// main "Sign-in form"
//   heading "Sign in" (level 1)
//   textbox "Email"
//   button "Sign in"

serializeOutline(document.body);
// h1 Sign in

serializeTabSequence(document.body);
// textbox "Email"
// button "Sign in"
```

Tab-order lines carry no `NN.` sequence number — line order conveys the
sequence, and numbering renumbers every following line on one insertion, churning
a committed snapshot's diff. For a human- or agent-read listing where an explicit
"stop 7" helps, add ordinals at **render** time (never store them):

```ts
import { serializeTabSequence, numberTabStops } from "@real-a11y-dev/serialize";

numberTabStops(serializeTabSequence(document.body));
// 01. textbox "Email"
// 02. button "Sign in"
```

Each function accepts a DOM root **or** a pre-extracted tree from
[`@real-a11y-dev/core`](../core), so it works in
jsdom, a real browser, and the extension panel without re-extracting. With a
pre-extracted tree it also runs in **plain Node** — no DOM globals needed — so
trees produced outside a DOM runtime (a deserialized snapshot, a browser tree
read over CDP) serialize the same way.

`serializeTree` takes `{ mode, redact, includeGeneric, markFocus, values,
states, redactInput }` options — see the [testing docs](https://real-a11y.dev/packages/testing/snapshots)
for the `redact` pattern reference, the `[focused]` marker, and `values`, which
prints each field's announced value (`textbox "Email" = "jane@x.com"`, a
sensitive field as `"[redacted]"`). `values` is off by default, so output is
unchanged unless asked. `redactInput` is the strict mode: given a DOM root it
extracts with no field value and no editor text in any name, and given a tree
it throws unless the tree was extracted that way. The output is stable
across runs (no ids or timestamps), which is what makes it safe to commit and
diff.

### What the text carries

A `serializeTree` line is `role "name"`, then `= "value"` when `values` is on,
`(level N)` when the node has a level, a `{…}` states block when the node has
anything to print, and `[focused]` when `markFocus` is on.
`serializeTabSequence` prints the same, without the level:

```
checkbox "Subscribe" {checked}
checkbox "Subscribe" {checked=false}
button "Menu" {expanded=false, haspopup=menu} [focused]
textbox "Email" = "a@b.c" {required, invalid, description="We never share it"}
link "Docs" {current=page}
heading "Setup" (level 2)
```

The block holds the states, description and announced properties a screen
reader presents beyond role and name. Tokens are separated by `, `, in a fixed
order, and print only when they carry information:

| Key | Prints |
| --- | --- |
| `checked`, `pressed` | `key`, `key=false`, `key=mixed` |
| `expanded` | `expanded`, `expanded=false` |
| `selected`, `disabled`, `readonly`, `required` | `key`, only when true |
| `invalid` | `invalid` for any invalid value (`grammar` and `spelling` too) |
| `current` | `current` or `current=<token>` (`page`, `step`, …) |
| `haspopup` | `haspopup=<token>` |
| `roledescription`, `description` | `key="…"`, JSON-quoted and run through `redact` |

Nothing else prints: not `focusable`, `editable`, `busy`, `modal`, a
`level` (which keeps its own `(level N)`), or any other property. Pass
`states: false` for text without blocks, byte for byte what the serializer
printed before it had them, e.g. to keep comparing with a baseline committed
then.

Which keys a node carries depends on the producer, so a DOM tree and a native
tree of the same page can differ by these tokens:

- only the native producer (Chromium's own tree) reads `haspopup` and
  `roledescription`, a description from a table caption, an SVG `<desc>` or
  ruby text, `readonly` on a read-only grid's cells, and `checked=false` on an
  ARIA checkbox with no `aria-checked`;
- only the DOM producer reads `current`;
- on a pristine required checkbox, radio or `<select>`, the DOM producer
  prints `required` and `invalid` only after interaction (`:user-invalid`, as
  HTML-AAM says), while Chromium reports `invalid` from the start and no
  `required`.

The outline and `serializeTreeDiff`'s labels never print a block: a `~` line
names each changed state on its own.

## `serializeTreeDiff(diff, options?)`

Renders a `TreeDiff` from core's
[`diffTrees`](https://real-a11y.dev/packages/testing#queries) — what
**one interaction changed**, as a committable change list:

```ts
import { extractA11yTree, diffTrees } from "@real-a11y-dev/core";
import { serializeTreeDiff } from "@real-a11y-dev/serialize";

const before = extractA11yTree(root);
openTheCountryPicker();
const after = extractA11yTree(root);

serializeTreeDiff(diffTrees(before, after));
// + option "Spain"
// + option "France"
// ~ combobox "Country": a11y.states.expanded false → true
// ~ listbox "Countries": childIds 0 children → 2 children
```

One line per added (`+`) / removed (`-`) node, one per changed field (`~`), in
document order. Nodes are labeled `role "name" (level N)` — **never a node id**,
so the output is snapshot-stable; a child-list change renders as counts for the
same reason. A pure reorder shows `childIds reordered (3 children)` (so a
tab-order or menu reorder isn't a silent no-op). An empty diff renders
`(no changes)`.

Options: `redact` (as above); `values`, which adds `a11y.value` change lines
(`~ textbox "Search": a11y.value (unset) → "hello"`) and values on added or
removed nodes (off by default, when a change to a field's contents alone renders
`(no changes)`); `childIds: false`, which leaves out a container's `childIds`
line when its `+`/`-` lines already explain it (the `listbox "Countries"` line
above), but keeps it for a move or a reorder. The line is on by default because
it is the only one that says which container a node joined or left. Plus
`focusBefore` / `focusAfter` — pass the
focused node at each capture point and the diff gains a trailing focus line,
which is how a focus-management bug becomes visible:

```
focus: button "Open settings" → dialog "Settings"
focus: button "Save" → (none)          ← focus was lost
```

Focus is supplied by the caller because a tree captured earlier can't answer
"what was focused then" after the fact (`ExtractionResult.focusedId` records it
at capture time).

## `foldTypography(name)`

Folds typographic variants in an accessible name to their ASCII forms — curly
quotes and apostrophes, the ellipsis character, en/em dashes, non-breaking
spaces, plus Unicode NFC:

```ts
foldTypography("Don’t save"); // -> "Don't save"
```

Design tools and CMSes emit smart typography while a developer hand-typing an
expected name uses plain ASCII, so the two differ byte-for-byte even though a
reader (and a screen reader) sees the same string. This exists for **comparison
only** — `@real-a11y-dev/testing`'s name matchers fold both sides before
comparing. Serialized output is never folded: it stays faithful to what
assistive tech actually announces.
