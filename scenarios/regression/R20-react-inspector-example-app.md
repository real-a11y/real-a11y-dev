---
id: R20
suite: regression
scenario: "React inspector in the example app — mount, mode switching, picker, late-mounted root"
area: React/Inspector
type: Manual
priority: P1
status: Active
validFrom: "react ≥ 0.1.0-beta.11 · inspector ≥ 0.1.0-beta.11. Run via `pnpm --filter @real-a11y-dev/example-react-app dev`"
validUntil: ""
expected: "panel renders in-app; mode prop switches the view; picker works; a root that mounts later still populates"
twin: D7
covers:
  - packages.@real-a11y-dev/react
  - packages.@real-a11y-dev/inspector
notion: "https://app.notion.com/p/3aa1c354b0b581a1a986c736aa69c290"
---

## Steps

```bash
pnpm --filter @real-a11y-dev/example-react-app dev
```

1. Load the app — does the inspector panel render in-page?
2. Switch the `mode` prop across its values; confirm the view changes
3. Change `mode` **at runtime** (not just at mount)
4. Use the element picker: pick an element in the app, land on the right tree node.
   Pick something that reacts before `click` — a dropdown trigger, a focusable input —
   and confirm the app itself does not react: nothing opens and focus does not move
5. Mount a component **after** the panel is already up (behind a toggle or a lazy
   route) — does its subtree appear?
6. Mount the inspector's own root late, after first paint
7. Change props that feed the navigator and confirm it re-reads
8. Open the browser console throughout

## Expected

- **1** — renders in-app with no extra setup beyond the documented drop-in
- **2/3** — the `mode` prop switches the view, including after mount. A prop honoured
  only on first render is a bug that looks like a working feature
- **4** — the picker resolves to the correct node, and picking does not activate it.
  Before `inspector 0.1.0-beta.12` only the `click` was cancelled, so on a run against
  an earlier release a menu opening here is the known defect, not a new one
- **5/6** — a root or subtree that mounts later still populates. It must not require a
  remount or a manual refresh
- **7** — live prop changes are reflected
- **8** — no errors, and specifically no hydration warnings

## Why this exists

The late-mount cases (5, 6) are the realistic ones and the ones that have regressed:
React apps routinely mount the inspector before the content it should inspect exists.
An implementation that reads the tree once at mount looks perfect in a demo where
everything is already rendered, and shows an empty panel in every real app.

Step 3 separates "reads the prop" from "subscribes to the prop" — a distinction
invisible unless you change it after mount.
