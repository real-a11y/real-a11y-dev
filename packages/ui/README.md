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

Search bar, DOM/A11Y view toggle, and expand/collapse controls.

### TreeNode

Single tree node with expand/collapse toggle, label rendering (DOM or A11Y mode), state badges, and action button.

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
