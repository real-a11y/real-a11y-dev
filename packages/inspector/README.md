# @real-a11y-dev/inspector

Framework-agnostic interactive accessibility tree panel. Embed into any app with Shadow DOM isolation.

## Installation

```bash
npm install @real-a11y-dev/inspector
```

## Usage

```ts
import { createInspector } from "@real-a11y-dev/inspector";

const inspector = createInspector({
  root: document.getElementById("app"),        // Element to extract tree from
  container: document.getElementById("panel"),  // Where to render the tree
  viewMode: "a11y",    // "dom" | "a11y" | "tab"
  interactive: true,   // Enable click/navigate/focus actions
  theme: "auto",       // "light" | "dark" | "auto"
  onNodeSelect: (node) => {
    console.log("Selected:", node.a11y.role, node.a11y.name);
  },
  onAction: (request, result) => {
    console.log("Action:", request.action, result.success);
  },
});

// Mount the tree view
inspector.mount();

// Switch view mode
inspector.setViewMode("dom");

// Clean up
inspector.destroy();
```

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `root` | `Element` | required | The DOM element to extract the tree from |
| `container` | `Element` | required | The element to render the tree view into |
| `viewMode` | `"dom" \| "a11y" \| "tab"` | `"a11y"` | Initial tree view mode |
| `interactive` | `boolean` | `true` | Enable interactive actions (click, navigate, etc.) |
| `theme` | `"light" \| "dark" \| "auto"` | `"auto"` | Color theme |
| `mount` | `"shadow" \| "light"` | `"shadow"` | Shadow DOM isolation (recommended) or light DOM |
| `highlightOnHover` | `boolean` | `false` | Highlight DOM element on tree node hover |
| `scrollHostOnSelect` | `boolean` | `false` | Scroll element into view on select |
| `focusHostOnActivate` | `boolean` | `false` | Move focus to element on activate |
| `onNodeSelect` | `(node) => void` | — | Callback when a node is selected |
| `onAction` | `(request, result) => void` | — | Callback when an action is dispatched |

## License

MIT
