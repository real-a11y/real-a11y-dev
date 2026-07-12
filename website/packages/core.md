---
title: "@real-a11y-dev/core — tree extraction engine"
description: The zero-dependency extraction engine every Real A11y package builds on. Accessibility + DOM tree walk, role map, ANDC name computation, actions, queries.
---

# @real-a11y-dev/core

> **TL;DR** — Extracts a browser-accurate accessibility tree from any DOM element, as plain data (`Map<string, SemanticNode>`). Zero runtime dependencies. Reach for this when you're **building your own tooling** on top of the engine; for apps, use one of the wrapper packages.

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
// tree: { nodes: Map<string, SemanticNode>; rootId: string }
```

Resolves ARIA roles, computes accessible names via the full ANDC algorithm, detects hidden subtrees, and maps interaction capabilities.

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

**`NodeChange`:**

```ts
interface NodeChange {
  id: string;
  before: Partial<SemanticNode>;
  after: Partial<SemanticNode>;
  fields: string[]; // e.g. ["a11y.name", "a11y.states.expanded"]
}
```

---

## DOM observation

### `DomObserver`

Watches a DOM subtree for mutations and calls a callback. Rapid mutations are
debounced, and a max-wait ceiling ensures the callback still fires on a stream
that never goes quiet (streaming responses, progress bars, animated content)
instead of the debounce deferring it forever.

```ts
import { DomObserver } from "@real-a11y-dev/core";

const observer = new DomObserver(
  root,
  () => {
    console.log("DOM changed, re-extract");
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

## Types

```ts
import type {
  SemanticNode,
  SemanticTree,
  SemanticNavigatorConfig,
  FindByRoleOptions,
  OutlineEntry,
  NodeChange,
  TreeDiff,
  LinearizeOptions,
  QueryInput,
  TreeMode,
  ActionType,
} from "@real-a11y-dev/core";
```
