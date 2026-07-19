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

## Data model

Every node in both the DOM and accessibility trees uses the `SemanticNode` interface:

```ts
interface SemanticNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
  dom: { tagName, attributes, textContent, descendantText, isHidden };
  a11y: { role, name, description, states, properties, isExposedToAT };
  interaction: { isInteractive, actions, isFocusable, isEditable };
  ui: { expanded, highlighted, matchesFilter, selected };
}
```

## License

MIT
