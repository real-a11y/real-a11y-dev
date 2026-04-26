# @real-a11y-dev/react

Native React integration for [Real A11y](https://real-a11y.dev) — hooks and a component for mounting the Semantic Navigator panel in React apps.

```sh
npm install -D @real-a11y-dev/react
```

## Quick start

```tsx
import { useRef } from "react";
import { SemanticNavigator } from "@real-a11y-dev/react";

function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rootRef}>
      <YourApp />
      <SemanticNavigator root={rootRef} floating highlightOnHover />
    </div>
  );
}
```

## What's in the box

- `<SemanticNavigator />` — drop-in tree panel (inline or floating mode, Shadow DOM isolated)
- `useSemanticTree(rootRef)` — subscribe to the live accessibility tree
- `useActiveModal(rootRef)` — detect open dialogs for `aria-live` announcements

## Docs

Full API reference, props tables, and integration recipes at **[real-a11y.dev/packages/react](https://real-a11y.dev/packages/react)**.

React 19 + Next.js? See the [Next.js recipe](https://real-a11y.dev/recipes/nextjs).

## License

MIT
