# @real-a11y-dev/core

Tree extraction, data model, and interaction engine for [Semantic Navigator](https://github.com/real-a11y/semantic-navigator).

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

### DOM observation

```ts
import { DomObserver } from "@real-a11y-dev/core";

const observer = new DomObserver(document.body, (mutations) => {
  // Re-extract tree on DOM changes
  console.log("Tree changed:", mutations);
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
  dom: { tagName, attributes, textContent, isHidden };
  a11y: { role, name, description, states, properties, isExposedToAT };
  interaction: { isInteractive, actions, isFocusable, isEditable };
  ui: { expanded, highlighted, matchesFilter, selected };
}
```

## License

MIT
