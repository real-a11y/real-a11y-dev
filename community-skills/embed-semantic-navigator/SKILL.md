---
name: embed-semantic-navigator
description: >-
  Embed the Real A11y Semantic Navigator panel in an app with
  @real-a11y-dev/react (SemanticNavigator, hooks) or @real-a11y-dev/inspector
  (createInspector). Use for Next.js / Vite / vanilla embeds and keeping the
  panel out of production bundles.
---

# Embed Semantic Navigator

Docs: https://real-a11y.dev/packages/react ·
https://real-a11y.dev/packages/inspector ·
https://real-a11y.dev/guide/panel-features ·
https://real-a11y.dev/guide/getting-started#keep-it-out-of-production

## Choose the package

| Stack | Package |
| --- | --- |
| React | `@real-a11y-dev/react` |
| Any other / vanilla | `@real-a11y-dev/inspector` |

Install as a **devDependency**. Do not ship the panel to end users.

## Keep it out of production

A top-level static import is not tree-shaken away by wrapping `if (import.meta.env.DEV)`.
**Lazy-import** the panel (dynamic `import()`) behind a DEV / explicit flag so
production builds drop it.

## React

```tsx
import { lazy, Suspense, useRef } from "react";

const SemanticNavigator = lazy(() =>
  import("@real-a11y-dev/react").then((m) => ({ default: m.SemanticNavigator })),
);

export function DevA11yPanel() {
  const root = useRef<HTMLElement>(null);
  if (!import.meta.env.DEV) return null;
  return (
    <Suspense fallback={null}>
      <SemanticNavigator root={root} mode="a11y" />
    </Suspense>
  );
}
```

Also available: `useSemanticTree`, `useActiveModal`. Prefer floating props for
overlays; inline layout for split-pane debugging.

Next.js App Router: client-only mount; verify **production** build has no
`window is not defined` / hydration errors (SSR risk is invisible in a Vite SPA).
Recipe: https://real-a11y.dev/recipes/nextjs

## Vanilla / any framework

```ts
import { createInspector } from "@real-a11y-dev/inspector";

const inspector = createInspector({
  root: document.getElementById("app"),
  container: document.getElementById("tree-panel"),
  viewMode: "a11y", // "dom" | "a11y" | "tab"
  theme: "auto",
});
inspector.mount();
// inspector.setRoot / setViewMode / refresh / getTree
```

Prefer `mount: "shadow"` when available. Host side-effects (`highlightOnHover`,
etc.) stay opt-in.

## Related

- Storybook → `a11y-in-storybook`
- Assert on trees in tests → `a11y-snapshot-tests`
