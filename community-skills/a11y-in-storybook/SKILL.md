---
name: a11y-in-storybook
description: >-
  Add the Real A11y Semantic Navigator Storybook addon
  (@real-a11y-dev/storybook-addon) so each story shows live a11y / DOM / tab
  views. Use when wiring Storybook 8 a11y tree panels or debugging addon build
  / export issues.
---

# Real A11y in Storybook

Docs: https://real-a11y.dev/packages/storybook-addon

## Install

Requires Storybook ≥ 8 and React ≥ 18 peers.

```sh
npm i -D @real-a11y-dev/storybook-addon@beta
```

Add to `.storybook/main.ts` `addons` — **no decorator** required:

```ts
addons: ["@real-a11y-dev/storybook-addon"],
```

## Use

1. Run Storybook, open a **story** (not a docs-only page).
2. Open the **Semantic Navigator** panel tab.
3. Switch A11y / DOM / Tab views; combine with Controls to see live updates.

The panel stays idle until the tab is opened (lazy extract). If it says
“Waiting for story…”, ensure you are on a story canvas with `#storybook-root`.

## Verify the static build

Dev can succeed while `build-storybook` fails on package `exports`. Always run:

```sh
npx build-storybook
```

React 19 + Storybook: follow https://real-a11y.dev/recipes/storybook-react-19
(`viteFinal` JSX) when needed.

## Limits

- No per-story addon params in the current beta surface — configure globally.
- Record the Storybook major version when filing issues.

## Related

- In-app embed (not Storybook) → `embed-semantic-navigator`
- Which surface → `choose-real-a11y-surface`
