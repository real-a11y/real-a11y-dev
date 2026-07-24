---
title: "@real-a11y-dev/react — SemanticNavigator + hooks"
description: Drop-in React component and useSemanticTree / useActiveModal hooks. Concurrent-mode safe, SSR-safe in floating mode, works with Next.js App Router.
---

# @real-a11y-dev/react

> **TL;DR** — `<SemanticNavigator />` component plus `useSemanticTree()` / `useActiveModal()` hooks. Built on `useSyncExternalStore` for concurrent-mode safety, SSR-safe in floating mode. Reach for this when your app is **React** — for anything else use [`@real-a11y-dev/inspector`](/packages/inspector).

Native React integration — hooks and a component. Built on `useSyncExternalStore` for React 18 concurrent-mode safety.

## Install

```sh
npm install -D @real-a11y-dev/react
```

**Peer dependencies:** `react >= 18`, `react-dom >= 18`

::: tip Install as a dev dependency
`@real-a11y-dev/react` bundles a tree extractor and a Preact-based renderer (~40 KB gzipped). It's a developer audit tool, not runtime infrastructure — keep it in `devDependencies` and gate `<SemanticNavigator />` on a build flag so it never ships to end users.

See [Keep it out of production](/guide/getting-started#keep-it-out-of-production) for the common Vite / Next.js / vanilla gating patterns.
:::

---

## `<SemanticNavigator />`

Drop-in tree panel component. Renders into a Shadow DOM by default.

```tsx
import { useRef } from "react";
import { SemanticNavigator } from "@real-a11y-dev/react";

function App() {
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={rootRef}>
      <YourApp />
      <SemanticNavigator
        root={rootRef}
        mode="a11y"
      />
    </div>
  );
}
```

### Props

| Prop | Type | Default | Description |
|---|---|---|---|
| `root` | `RefObject<Element \| null>` | — | **Required.** Ref to the DOM element to observe. |
| `mode` | `"a11y" \| "dom"` | `"a11y"` | Tree extraction mode. Can be changed at runtime. |
| `mount` | `"shadow" \| "light"` | `"shadow"` | Shadow DOM isolation mode. |
| `theme` | `"light" \| "dark" \| "auto"` | `"auto"` | Panel color theme. |
| `interactive` | `boolean` | `true` | Enable interactive actions on tree nodes. |
| `highlightOnHover` | `boolean` | `false` | Highlight host element on tree node hover. |
| `scrollHostOnSelect` | `boolean` | `false` | Scroll host element into view on selection. |
| `focusHostOnActivate` | `boolean` | `false` | Focus host element on action activation. |
| `enablePicker` | `boolean` | `false` | Surface a DevTools-style element picker (⦿ button + Ctrl/Cmd+Shift+C). |
| `styleNonce` | `string` | — | CSP nonce for injected styles (mount-only — not updated on later prop changes). |
| `onNodeSelect` | `(node: SemanticNode) => void` | — | Called when a tree node is selected. |
| `onAction` | `(request: ActionRequest, result: ActionResult) => void` | — | Called after an interactive action is dispatched. |
| `className` | `string` | — | Class name applied to the host `<div>` (inline mode only). |
| `style` | `CSSProperties` | — | Inline styles for the host `<div>` (inline mode only). |
| `floating` | `boolean` | `false` | Render as a fixed-position, draggable, resizable, collapsible panel portaled into `document.body` instead of an inline div. |
| `panelTitle` | `string` | `"Semantic Navigator"` | Title shown in the floating panel's title bar. |
| `panelWidth` | `number` | `380` | Initial floating panel width in px. |
| `panelHeight` | `number` | `420` | Initial floating panel height in px. |
| `panelGap` | `number` | `16` | Gap between the floating panel and the viewport edges in px. |

The component creates its own internal `<div>` host and passes it to `createInspector`. Changing `root`, `mount`, `theme`, `interactive`, `highlightOnHover`, `scrollHostOnSelect`, `focusHostOnActivate`, or `enablePicker` remounts the navigator (selection, expansion, and other in-panel UI state reset); changing `mode` uses the imperative `setViewMode()` API without remounting. `styleNonce` is applied when the stylesheet is first injected and is not updated on later prop changes (shadow mount reuses the host shadow root; light mount injects `#sn-styles` into `document.head` once). `onNodeSelect` / `onAction` always invoke the latest callback the parent passed (stable wrappers over refs — recreating the prop each render does not leave a stale closure).

::: tip Why `highlightOnHover` / `scrollHostOnSelect` / `focusHostOnActivate` default to false
`<SemanticNavigator />` renders into the same document as your app, so activating a tree row could steal focus from the panel or scroll the page underneath you. The panel itself stays fully interactive either way — row selection, cross-link chip navigation, keyboard movement — what's gated is the side effect on the *real* DOM element. See [Panel interaction vs. host side effects](/guide/panel-features#panel-interaction-vs-host-side-effects) for the full rationale and when to flip them on.
:::

---

## `useSemanticTree(rootRef, options?)`

Subscribes to the semantic tree for a given DOM element. Re-renders whenever the DOM mutates and the debounce settles.

```tsx
import { useRef } from "react";
import { useSemanticTree } from "@real-a11y-dev/react";
import { findByRole } from "@real-a11y-dev/core";

function FocusAnnouncer({ rootRef }) {
  const tree = useSemanticTree(rootRef, { mode: "a11y" });

  const dialog = tree ? findByRole(tree, "dialog") : null;

  return (
    <div aria-live="polite">
      {dialog ? `Dialog open: ${dialog.a11y.name}` : null}
    </div>
  );
}
```

**Returns:** `ExtractionResult | null` — `null` before the first extraction.

**Options:**

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `"a11y" \| "dom"` | `"a11y"` | Tree extraction mode. |
| `debounceMs` | `number` | `300` | Debounce delay for DOM mutation callbacks. |

### Concurrent-mode safety

`useSemanticTree` uses `useSyncExternalStore` internally. The subscription and snapshot functions satisfy React 18's requirements:

- Snapshot is stable when the tree hasn't changed.
- Subscription calls the listener synchronously on mutation flush.
- No tearing between render and paint.

---

## `useActiveModal(rootRef)`

Convenience hook — returns the active modal node (`dialog` or `alertdialog`) or `null`.

```tsx
import { useActiveModal } from "@real-a11y-dev/react";

function ModalGuard({ rootRef }) {
  const modal = useActiveModal(rootRef);

  if (!modal) return null;

  return (
    <div role="status">
      Modal open: {modal.a11y.name || "(no name — add aria-labelledby)"}
    </div>
  );
}
```

**Returns:** `SemanticNode | null`

### Announcing modal opens in an `aria-live` region

A static `role="status"` only announces the *current* state. To tell screen-reader users that a dialog *just opened*, wrap the output in a polite `aria-live` region so each change is announced:

```tsx
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

Drop this near the top of your layout alongside the `<SemanticNavigator />` host. Users of assistive tech get a courteous notification every time a dialog opens — useful when your app's own announcement logic is still under construction.

---

## Patterns

### Audit overlay in development

Gate the import itself so the inspector code is **tree-shaken from production bundles** (a top-level `SemanticNavigator` import prevents that — the reference survives even inside an `if (DEV)`).

```tsx
// DevAuditOverlay.tsx
import { lazy, Suspense, useRef } from "react";

const SemanticNavigator = lazy(() =>
  import("@real-a11y-dev/react").then((m) => ({ default: m.SemanticNavigator }))
);

export function DevAuditOverlay({ children }) {
  // Vite: `import.meta.env.DEV`. Webpack/Next: `process.env.NODE_ENV !== "production"`.
  if (!import.meta.env.DEV) return <>{children}</>;

  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={rootRef} style={{ display: "grid", gridTemplateColumns: "1fr 380px" }}>
      <div>{children}</div>
      <Suspense fallback={null}>
        <SemanticNavigator
          root={rootRef}
          mode="a11y"
          highlightOnHover
          style={{ height: "100vh", overflow: "hidden", borderLeft: "1px solid #eee" }}
        />
      </Suspense>
    </div>
  );
}
```

Production builds: the `DEV` branch is dead-code-eliminated and `@real-a11y-dev/react` never enters the final bundle. Dev builds: the inspector loads on demand as its own chunk.

### Reacting to tree changes

```tsx
import { useRef, useEffect } from "react";
import { useSemanticTree } from "@real-a11y-dev/react";
import { findAllByRole } from "@real-a11y-dev/core";

function A11yBadge({ rootRef }) {
  const tree = useSemanticTree(rootRef);

  const issues = tree
    ? findAllByRole(tree, "button").filter(
        (btn) => !btn.a11y.name
      )
    : [];

  if (issues.length === 0) return null;

  return (
    <div style={{ color: "red" }}>
      ⚠ {issues.length} unlabeled button(s)
    </div>
  );
}
```

---

## TypeScript

All hooks and components are fully typed. Import types from `@real-a11y-dev/core` for tree node types:

```ts
import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";
```

---

## See it running

- **Vite + React 18** — [`examples/react-app/`](/examples/react-app): split-panel layout with a mode toggle, `useSemanticTree` driving a live "issues" badge, and `useActiveModal` with an `aria-live` announcer.
- **Next.js (App Router + React 19)** — the [Next.js recipe](/recipes/nextjs) covers the client-component and SSR-gating patterns specific to Next.

---

## Panel features

`<SemanticNavigator />` exposes the same in-panel behaviors as the Chrome extension and Storybook addon — search, role filters, focus tracking, scoping, live region monitoring, keyboard navigation. The props on this component (`highlightOnHover`, `scrollHostOnSelect`, `focusHostOnActivate`, `mode`, `mount`) configure them.

→ [Panel features reference](/guide/panel-features)
