---
title: "@real-a11y-dev/core — tree extraction engine"
description: The zero-dependency extraction engine every Real A11y package builds on. Accessibility + DOM tree walk, role map, ANDC name computation, actions, queries.
---

# @real-a11y-dev/core

> **TL;DR** — Extracts a browser-accurate accessibility tree from any DOM element, as plain data (`Map<string, SemanticNode>`). Zero runtime dependencies. Reach for this when you're **building your own tooling** on top of the engine; for apps, use one of the wrapper packages.

> **Want a ready-made tool, not a custom build?** Audit from the shell with [`@real-a11y-dev/cli`](/packages/cli), or give an AI agent accessibility audits via [`@real-a11y-dev/mcp`](/packages/mcp) — both sit on this layer already, so you don't have to build them.

The extraction engine. Every other package is built on top of this.

## Install

```sh
# Most apps — dev-only (used in tests or behind a dev gate)
npm install -D @real-a11y-dev/core

# Library authors / tools that ship core at runtime — regular dep or peer
npm install @real-a11y-dev/core
```

`@real-a11y-dev/core` has no runtime dependencies. It uses standard DOM APIs only.

::: tip Which type of dependency do I need?
- **`-D` (dev)** is the right default for most apps — you're using `core` inside tests, Storybook, or a dev-only audit panel gated by `import.meta.env.DEV` / `process.env.NODE_ENV`. See [Keep it out of production](/guide/getting-started#keep-it-out-of-production).
- **Regular `dependency`** if you're publishing your own package that uses `core` at runtime (e.g. a new audit tool on top of the engine).
- **`peerDependency`** if you're publishing a library that composes `core` with other Real A11y packages — lets consumers share a single copy.
:::

---

## Extraction

### `extractA11yTree(root)`

Extracts the accessibility tree from a DOM element.

```ts
import { extractA11yTree } from "@real-a11y-dev/core";

const tree = extractA11yTree(document.getElementById("app"));
// tree: { nodes: Map<string, SemanticNode>; rootId: string; focusedId?: string }
```

Resolves ARIA roles, computes accessible names via the full ANDC algorithm, detects hidden subtrees, and maps interaction capabilities.

Media elements mirror the browser's native accessibility tree: `<video>` and `<audio>` get the `video` / `audio` roles Chromium shows in DevTools (ARIA defines no media roles, so a strict HTML-AAM mapping would hide them as `generic`). Media nodes are leaves — unrendered fallback content and `<track>`/`<source>` metadata never become tree nodes — and each carries a `properties.captions` flag (`"true"` / `"false"`) telling you whether the element ships a captions or subtitles track (the WCAG 1.2.2 signal). A media element with native `controls` is reported focusable; its play/seek/volume buttons live in a closed user-agent shadow root that no in-page extractor can reach.

`focusedId` is the id of the element that held focus at extraction time, when it's inside the extracted subtree — absent when focus rested on `<body>`/`<html>` (nothing meaningfully focused) or fell outside the tree. The serializers in [`@real-a11y-dev/testing`](/packages/testing/snapshots#focus-marker) render it as a `[focused]` marker.

### `extractDomTree(root)`

Same shape as `extractA11yTree`, but uses raw tag names as roles instead of ARIA roles. Useful when you want to audit DOM structure rather than accessibility semantics.

```ts
import { extractDomTree } from "@real-a11y-dev/core";

const tree = extractDomTree(document.querySelector("main"));
```

---

## Query helpers

### `findByRole(tree, role, options?)`

Returns the first `SemanticNode` matching the given role, or `null`.

```ts
import { extractA11yTree, findByRole } from "@real-a11y-dev/core";

const tree = extractA11yTree(root);
const submitBtn = findByRole(tree, "button", { name: /submit/i });
```

**Options:**

| Option | Type | Description |
|---|---|---|
| `name` | `string \| RegExp` | Filter by accessible name. String: exact match (case/whitespace-normalized). RegExp: `.test()`. |
| `level` | `number` | Filter by heading level (1–6). |
| `checked` | `boolean` | Filter by `aria-checked` state. |
| `expanded` | `boolean` | Filter by `aria-expanded` state. |
| `selected` | `boolean` | Filter by `aria-selected` state. |
| `pressed` | `boolean` | Filter by `aria-pressed` state. |
| `disabled` | `boolean` | Filter by `aria-disabled` state. |
| `includeHidden` | `boolean` | Include nodes in `aria-hidden` subtrees (default: false). |

### `findAllByRole(tree, role, options?)`

Returns all matching nodes as `SemanticNode[]`.

```ts
const headings = findAllByRole(tree, "heading", { level: 2 });
```

---

## Tree traversal

### `linearize(tree, options?)`

Returns all nodes in pre-order (DOM order), skipping hidden nodes by default.

```ts
import { linearize } from "@real-a11y-dev/core";

const nodes = linearize(tree);
// SemanticNode[] in DOM order
```

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `includeHidden` | `boolean` | `false` | Include `aria-hidden` subtrees |

---

## Structure queries

### `getOutline(tree)`

Returns heading nodes as a flat outline list.

```ts
import { getOutline } from "@real-a11y-dev/core";

const outline = getOutline(tree);
// [{ id, level, name }, ...]
```

### `getTabSequence(tree)`

Returns focusable nodes in computed tab order.

```ts
import { getTabSequence } from "@real-a11y-dev/core";

const sequence = getTabSequence(tree);
// SemanticNode[] — positive tabindex ascending, then natural order
```

---

## Disclosure-pair index

### `buildControlsIndex(nodes)`

Resolves the `aria-controls` relationship across a tree and returns adjacency maps in both directions, so callers can render cross-links between disclosure triggers (button, tab, combobox) and the elements they open (menu, panel, listbox).

```ts
import { extractA11yTree, buildControlsIndex } from "@real-a11y-dev/core";

const tree = extractA11yTree(root);
const { forward, reverse, inferred } = buildControlsIndex(tree.nodes);

// forward.get(triggerNodeId) → tree-node ids the trigger controls
// reverse.get(controlledNodeId) → tree-node ids of triggers pointing at it
// inferred.has(triggerNodeId) → true when the link came from the heuristic
//                               fallback rather than an explicit aria-controls
```

The lookup happens entirely in tree-node id space — DOM ids are resolved internally so callers never deal with them.

**Two link sources, merged into the same maps:**

1. **Explicit `aria-controls`** — the principled relationship. Always preferred.
2. **Heuristic fallback** — for triggers that expose `aria-haspopup` + `aria-expanded="true"` but no `aria-controls`, paired with the next visible element of the matching role (`aria-haspopup="menu"` → `role="menu"`, `aria-haspopup="listbox"` → `role="listbox"`, etc.). Common in apps that skip `aria-controls`. Conservative by design: skipped when the trigger already has `aria-controls`, won't poach an element that's already an explicit target, and excludes hidden candidates.

The `inferred` set lists trigger ids whose link came from the heuristic — render those cross-links with a "likely" affordance (different style, hedged tooltip) instead of presenting them as ground truth.

### `ControlsIndex`

```ts
interface ControlsIndex {
  /** trigger tree-node id → tree-node ids it controls */
  forward: Map<string, string[]>;
  /** controlled tree-node id → tree-node ids of triggers pointing at it */
  reverse: Map<string, string[]>;
  /** subset of `forward` keys whose link came from the heuristic */
  inferred: Set<string>;
}
```

---

## Tree diffing

### `diffTrees(before, after)`

Compares two tree snapshots and returns what changed.

```ts
import { diffTrees } from "@real-a11y-dev/core";

const before = extractA11yTree(root);
// ...user interaction...
const after = extractA11yTree(root);

const diff = diffTrees(before, after);
// { added: SemanticNode[], removed: SemanticNode[], changed: NodeChange[] }
```

Node ids come from a per-DOM-node `WeakMap`, so the same element keeps its id
across extractions — that's what makes this an identity-aware comparison rather
than a text diff. It also means `diffTrees` only works **within one live
document**: ids don't survive serialization, so two separately-captured
snapshots can't be compared this way (for that, use the
[CLI's](/packages/cli) artifact diff).

**`NodeChange`:**

```ts
interface NodeChange {
  id: string;
  before: SemanticNode;
  after: SemanticNode;
  /** Dot-paths that differ, e.g. ["a11y.name", "a11y.states.expanded"] */
  changes: string[];
}
```

To render a diff as a committable change list (`+ option "Spain"`,
`~ combobox "Country": a11y.states.expanded false → true`), pass it to
`serializeTreeDiff` from `@real-a11y-dev/serialize`.

---

## DOM observation

### `DomObserver`

Watches a DOM subtree for mutations and calls a callback. Rapid mutations are
debounced, and a max-wait ceiling ensures the callback still fires on a stream
that never goes quiet (streaming responses, progress bars, animated content)
instead of the debounce deferring it forever.

The callback receives a `TreeChange` object containing the accumulated
`MutationRecord`s and any synthetic dirty roots produced by `input`/`change`
events (which MutationObserver cannot see natively).

```ts
import { DomObserver, type TreeChange } from "@real-a11y-dev/core";

const observer = new DomObserver(
  root,
  (change?: TreeChange) => {
    console.log("DOM changed, re-extract", change);
  },
  200, // debounce: wait 200ms of quiet before firing
  undefined, // internalIds: mutations to ignore (defaults to the overlay set)
  1000, // maxWaitMs: flush at least this often during a continuous stream
);

observer.start();
// Later:
observer.stop();
```

---

## Live tree extraction

### `LiveTreeExtractor`

Stateful extractor that keeps the previous tree in memory and re-extracts only
the subtrees that changed, falling back to a full extraction when a mutation
has non-local accessibility effects (portal/modal scope changes, `id`,
`aria-labelledby`, `aria-describedby`, `for`, etc.).

Used by the Chrome extension, React hook, and Storybook addon to keep the tree
fresh during typing or small DOM updates without paying the cost of a full page
walk every time.

```ts
import { LiveTreeExtractor, DomObserver } from "@real-a11y-dev/core";

const extractor = new LiveTreeExtractor(document.body, { mode: "a11y" });

const observer = new DomObserver(document.body, (change) => {
  const tree = extractor.refresh(change);
  // tree is the same shape as extractA11yTree/ extractDomTree
});

observer.start();
```

`mode` is `"a11y"` (default) or `"dom"`. Call `extractor.extract()` for an
unconditional full re-extract, or `extractor.setMode(mode)` to switch views.

---

## Types

```ts
import type {
  SemanticNode,
  ExtractionResult,
  SemanticNavigatorConfig,
  FindByRoleOptions,
  OutlineEntry,
  NodeChange,
  TreeDiff,
  LinearizeOptions,
  QueryInput,
  TreeViewMode,
  ActionType,
  TreeChange,
  LiveTreeExtractorOptions,
} from "@real-a11y-dev/core";
```
