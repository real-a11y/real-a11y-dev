# @real-a11y-dev/semantic-navigator-ui

Preact tree rendering components for [Semantic Navigator](https://real-a11y.dev).

Provides the interactive tree view UI used by the inspector, the React wrapper, the Storybook addon, and the Chrome extension. Built with Preact for minimal bundle size — the `TreeView` entry point measures ~5 KB gzipped (excluding `preact` and `@real-a11y-dev/core`, which consumers usually share).

## Installation

```bash
npm install @real-a11y-dev/semantic-navigator-ui
```

## Components

### TreeView

Main tree container. Extracts the tree from a root DOM element and renders it with full keyboard navigation, search, and interaction support.

```tsx
import { TreeView } from "@real-a11y-dev/semantic-navigator-ui";

<TreeView
  root={document.body}
  initialViewMode="a11y"
  interactive={true}
  theme="auto"
  onNodeSelect={(node) => console.log(node)}
  onAction={(request) => console.log(request)}
/>
```

### TreePanel

Controlled counterpart to `TreeView`. Renders a pre-extracted `ExtractionResult` with full interactivity (search, filter, expand/collapse, tab sequence) but does **not** observe or extract from the DOM itself — all DOM side-effects are proxied back to the caller via callbacks. Used by the Storybook addon manager panel, where the tree data crosses the iframe boundary as serialized JSON and there is no live DOM root to observe.

### TreeToolbar

Search bar, DOM/A11Y view toggle, expand/collapse controls, and the diff checkpoint button.

### TreeNode

Single tree node with expand/collapse toggle, label rendering (DOM or A11Y mode), state badges, and action button.

## Diff mode

The toolbar's checkpoint button (`⎌`) captures the tree as it is right now. Interact with the page, and rows that appeared or changed since are marked in place — useful for answering "what did opening this menu actually do to the accessibility tree?". Click it again to clear.

The marking is not color-only: added rows carry a `+` and changed rows a `~`, each paired with visually-hidden text so the status is announced, and a forced-colors fallback swaps the tint for a border. Nodes that were **removed** are listed in a `<details>` below the tree rather than as rows — their elements are gone from the DOM, so there is nothing to highlight, focus, or act on.

Switching between DOM and A11Y view drops the baseline: they are different extractions, so a checkpoint from one is not comparable against the other.

Pass `enableDiff={false}` to hide the button. The building block is also exported on its own, for hosts that drive the baseline themselves:

```ts
import { buildTreeDiffView } from "@real-a11y-dev/semantic-navigator-ui";

const view = buildTreeDiffView(baseline, current);
view.status.get(nodeId); // "added" | "changed" | undefined
view.removed; // SemanticNode[] — gone from the current tree
```

`TreePanel` accepts the result as its `diff` prop.

> This is the in-page, interaction-scoped diff. It is keyed on live node identity, so it dies on navigation. For a diff that survives navigation and gates CI, use the snapshot fingerprint diff in [`@real-a11y-dev/snapshot`](../snapshot) / the MCP checkpoint tools.

## Keyboard navigation

Follows the [WAI-ARIA TreeView pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/):

- Arrow keys for navigation
- Enter to activate
- Space to toggle expand/collapse
- Home/End to jump
- Type-ahead search

## Styling

Self-contained CSS with CSS custom properties for theming. No Tailwind or framework dependencies.

```ts
import "@real-a11y-dev/semantic-navigator-ui/styles";
```

Supports light, dark, and auto (system preference) themes.

## License

MIT
