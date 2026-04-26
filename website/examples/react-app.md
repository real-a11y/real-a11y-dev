# Example: React App

A Vite + React 18 application demonstrating `@real-a11y-dev/react` hooks and the `<SemanticNavigator />` component.

**Source:** [`examples/react-app/`](https://github.com/real-a11y/real-a11y-dev/tree/main/examples/react-app)

## What it shows

- `<SemanticNavigator />` mounted alongside the app in a split-panel layout
- `useSemanticTree()` powering a live "issues" badge (unlabeled buttons, missing headings)
- `useActiveModal()` announcing when a dialog is open via an `aria-live` region
- Runtime mode switching (A11y / DOM) via props
- Shadow DOM isolation — host app CSS does not affect the panel

## Run it locally

```sh
git clone https://github.com/real-a11y/real-a11y-dev.git
cd real-a11y
pnpm install
pnpm --filter @real-a11y-dev/example-react dev
```

Opens at `http://localhost:5175`.

## Key code

### Split-panel layout

```tsx
// examples/react-app/src/App.tsx
import { useRef, useState } from "react";
import { SemanticNavigator } from "@real-a11y-dev/react";
import { DemoApp } from "./DemoApp";

export function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<"a11y" | "dom">("a11y");

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", height: "100vh" }}>
      <div ref={rootRef} style={{ overflow: "auto", padding: 24 }}>
        <DemoApp />
      </div>
      <aside style={{ borderLeft: "1px solid #eee", overflow: "hidden" }}>
        <div style={{ padding: "8px 12px", borderBottom: "1px solid #eee" }}>
          <button onClick={() => setMode(m => m === "a11y" ? "dom" : "a11y")}>
            Mode: {mode}
          </button>
        </div>
        <SemanticNavigator
          root={rootRef}
          mode={mode}
          highlightOnHover
          style={{ height: "calc(100% - 41px)" }}
        />
      </aside>
    </div>
  );
}
```

### Issues badge with `useSemanticTree`

```tsx
// examples/react-app/src/IssuesBadge.tsx
import { useSemanticTree } from "@real-a11y-dev/react";
import { findAllByRole } from "@real-a11y-dev/core";

export function IssuesBadge({ rootRef }) {
  const tree = useSemanticTree(rootRef);

  const unlabeled = tree
    ? findAllByRole(tree, "button").filter(b => !b.a11y.name).length +
      findAllByRole(tree, "link").filter(l => !l.a11y.name).length
    : 0;

  if (unlabeled === 0) return null;

  return (
    <span
      role="status"
      style={{ background: "#f00", color: "#fff", borderRadius: 12, padding: "2px 8px" }}
    >
      {unlabeled} A11y {unlabeled === 1 ? "issue" : "issues"}
    </span>
  );
}
```

### Modal announcer with `useActiveModal`

```tsx
// examples/react-app/src/ModalAnnouncer.tsx
import { useActiveModal } from "@real-a11y-dev/react";

export function ModalAnnouncer({ rootRef }) {
  const modal = useActiveModal(rootRef);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {modal ? `Dialog open: ${modal.a11y.name || "unnamed dialog"}` : ""}
    </div>
  );
}
```
