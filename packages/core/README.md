# @real-a11y-dev/core

Tree extraction, data model, and interaction engine for [Semantic Navigator](https://github.com/real-a11y/real-a11y-dev).

This package has zero UI dependencies. It handles DOM traversal, accessibility tree computation, role mapping, interaction dispatching, DOM observation, and search.

## Installation

```bash
npm install @real-a11y-dev/core
```

## API

### Tree extraction

```ts
import { extractDomTree, extractA11yTree } from "@real-a11y-dev/core";

// Extract full DOM tree
const { nodes, rootId } = extractDomTree(document.body);

// Extract accessibility tree (filters out generic/hidden nodes)
const { nodes: a11yNodes, rootId: a11yRootId } = extractA11yTree(document.body);
```

### Role mapping

```ts
import { getImplicitRole, isHiddenFromAT, getHeadingLevel } from "@real-a11y-dev/core";

getImplicitRole(element);    // "button", "link", "navigation", etc.
isHiddenFromAT(element);     // true if aria-hidden, role=presentation, etc.
getHeadingLevel(element);    // 1-6 for headings, null otherwise
```

Media elements follow the browser's native tree rather than the (silent)
HTML-AAM mapping: `<video>` → `"video"` and `<audio>` → `"audio"`, matching
the internal roles Chromium exposes in DevTools. Media nodes are leaves —
fallback content and `<track>`/`<source>` metadata never become tree nodes —
and each carries a `properties.captions` flag (`"true"`/`"false"`) reflecting
whether a captions or subtitles track is present (the WCAG 1.2.2 signal).
With native `controls` the media element is reported focusable.

### Interaction dispatching

```ts
import { ActionDispatcher, getElementRefs } from "@real-a11y-dev/core";

const dispatcher = new ActionDispatcher(getElementRefs());

dispatcher.dispatch({ nodeId: "sn-42", action: "click" });
dispatcher.dispatch({ nodeId: "sn-15", action: "type", payload: { value: "hello" } });
dispatcher.dispatch({ nodeId: "sn-3", action: "navigate" });
```

### Live tree extraction

`LiveTreeExtractor` keeps a previous tree in memory and re-extracts only the
subtrees that changed, falling back to a full extraction when a mutation has
non-local accessibility effects (portal/modal scope changes, `aria-labelledby`,
`id`, etc.). It is used by the extension and React hook under the hood.

```ts
import { LiveTreeExtractor, DomObserver } from "@real-a11y-dev/core";

const extractor = new LiveTreeExtractor(document.body, { mode: "a11y" });
const observer = new DomObserver(document.body, (change) => {
  const tree = extractor.refresh(change);
  console.log("Tree updated:", tree);
});

observer.start();
```

`mode` is `"a11y"` (default) or `"dom"`. `refresh(change)` accepts the
`TreeChange` payload from a `DomObserver` callback, or no argument for a full
re-extract.

### DOM observation

```ts
import { DomObserver, type TreeChange } from "@real-a11y-dev/core";

const observer = new DomObserver(document.body, (change?: TreeChange) => {
  // `change.mutations` has the underlying MutationRecords,
  // `change.dirtyRoots` has synthetic roots for input/change events.
  console.log("Tree changed:", change);
});

observer.start();
observer.stop();
```

### Search

```ts
import { searchTree, applySearchFilter } from "@real-a11y-dev/core";

// Find matching node IDs (includes ancestor path)
const matchedIds = searchTree(nodes, "button", "dom");

// Apply filter to node UI state, returns direct match count
const count = applySearchFilter(nodes, "navigation", "a11y");
```

### Native AX vocabulary

Normalize a Chromium CDP `Accessibility.getFullAXTree` payload into the
engine's vocabulary — pure functions (no CDP, no DOM globals), so they run in
Node, jsdom, browsers, and extension service workers alike. This is the single
shared normalization every native-tree consumer imports (the drop-list, the
Blink→engine role map, and name promotion off dropped `StaticText` children),
versioned via `NATIVE_AX_VOCABULARY_VERSION` because Chromium's tree shifts
across milestones.

```ts
import { normalizeNativeAX, serializeNativeAX } from "@real-a11y-dev/core";

// nodes: the raw `nodes` array returned by Accessibility.getFullAXTree
const tree = normalizeNativeAX(nodes);
serializeNativeAX(tree);
// main
//   heading "Native AX fixture"
//   video "Product tour"
//     button "play"
//     slider "video time scrubber"
```

Sibling order follows each parent's `childIds` (Chromium's own document
order), ignored/`generic`/`none` wrappers are flattened with descendants
re-parented to the nearest kept ancestor, and each kept node carries its
`backendDOMNodeId` for CDP enrichment or action dispatch.

## Data model

Every node in both the DOM and accessibility trees uses the `SemanticNode` interface. It is **accessibility-first**: `a11y` is always present, while `dom`, `interaction`, and `ui` are **optional facets**.

```ts
interface SemanticNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
  a11y: { role, name, description, states, properties, isExposedToAT };
  dom?: { tagName, attributes, textContent, descendantText, isHidden };
  interaction?: { isInteractive, actions, isFocusable, isEditable };
  ui?: { expanded, highlighted, matchesFilter, selected };
}
```

The DOM producer (`extractDomTree` / `extractA11yTree` / `LiveTreeExtractor`) fills **every** facet, so trees you get from this package have them all. The facets are optional because a future native (CDP) producer yields nodes with no backing light-DOM element — `dom` / `interaction` are absent there, and `ui` is panel-only. If you only ever handle DOM-produced trees, narrow once to `DomSemanticNode` (all facets required) at your boundary instead of guarding each read:

```ts
import type { DomSemanticNode } from "@real-a11y-dev/core";

const node = tree.nodes.get(id) as DomSemanticNode | undefined;
node?.dom.tagName; // no per-field guard needed
```

Each `ExtractionResult` also carries a `source: { producer: "dom" | "native"; chrome? }` provenance stamp, so serializers and snapshots can label their output and never silently compare a DOM baseline against a native one.

## License

MIT
