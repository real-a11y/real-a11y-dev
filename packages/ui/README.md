# @real-a11y-dev/semantic-navigator-ui

Preact tree rendering components for [Semantic Navigator](https://github.com/real-a11y/semantic-navigator).

Provides the interactive tree view UI used by both the Chrome extension and the npm package. Built with Preact (3KB gzipped) for minimal bundle size.

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
