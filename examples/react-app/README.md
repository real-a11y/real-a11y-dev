# React app example — `@real-a11y-dev/react`

A small React 18 app using the `<SemanticNavigator />` component and the `useSemanticTree` / `useActiveModal` hooks.

## What this shows

- Mounting the `<SemanticNavigator />` component alongside a real React app
- `useSemanticTree(rootRef)` — subscribes to DOM mutations via `useSyncExternalStore`, re-renders the tree automatically when the app mutates
- `useActiveModal(rootRef)` — rendering a live "modal is open" announcer driven by the accessibility tree
- Computing an issues-count badge (unlabeled interactives, missing landmarks) from the tree using `@real-a11y-dev/core` query helpers

## Run it

From the repo root:

```bash
pnpm install
pnpm --filter @real-a11y-dev/example-react dev
```

## Key files

- [`src/main.tsx`](./src/main.tsx) — app entry
- [`src/App.tsx`](./src/App.tsx) — layout + `<SemanticNavigator />`
- [`src/DemoApp.tsx`](./src/DemoApp.tsx) — the sample app being inspected
- [`src/ModalAnnouncer.tsx`](./src/ModalAnnouncer.tsx) — `useActiveModal` demo
- [`src/IssuesBadge.tsx`](./src/IssuesBadge.tsx) — `useSemanticTree` + query helpers demo

## See also

- [`@real-a11y-dev/react` package docs](../../packages/react)
