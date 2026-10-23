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

`root` takes a ref, as here, or the element itself. A ref is read after every render, so a root behind a loading state attaches once it mounts. When the root can mount, or be replaced, without the component that holds the panel re-rendering, for example inside another component, pass the element from a callback ref kept in state: `const [root, setRoot] = useState<HTMLElement | null>(null)` and `<main ref={setRoot}>`. The hooks take either form too.

## What's in the box

- `<SemanticNavigator />` — drop-in tree panel (inline or floating mode, Shadow DOM isolated)
- `useSemanticTree(rootRef)` — subscribe to the live accessibility tree
- `useActiveModal(rootRef)` — detect open dialogs for `aria-live` announcements

## Docs

Full API reference, props tables, and integration recipes at **[real-a11y.dev/packages/react](https://real-a11y.dev/packages/react)**.

React 19 + Next.js? See the [Next.js recipe](https://real-a11y.dev/recipes/nextjs).

## License

MIT
