# @real-a11y-dev/serialize

Deterministic text serialization of the [Semantic Navigator](https://real-a11y.dev) accessibility tree. The same string format the Real A11y panel, the testing snapshots, the `real-a11y` CLI (`tree`/`outline`/`tabs`), the MCP server, and the Chrome extension all share.

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
> `outlineSnapshot` and `tabSequenceSnapshot` (with `auditSnapshot` aliasing
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

`serializeTree` takes `{ mode, redact, includeGeneric, markFocus }` options —
see the [testing docs](https://real-a11y.dev/packages/testing/snapshots) for the
`redact` pattern reference and the `[focused]` marker. The output is stable
across runs (roles + names only, no ids or timestamps), which is what makes it
safe to commit and diff.

## `serializeTreeDiff(diff, options?)`

Renders a `TreeDiff` from core's
[`diffTrees`](https://real-a11y.dev/guide/core-concepts#tree-diffing) — what
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

Options: `redact` (as above), plus `focusBefore` / `focusAfter` — pass the
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
