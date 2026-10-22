---
id: R21
suite: regression
scenario: "Storybook addon in the example — panel shows the tree and tracks story/control changes"
area: Storybook
type: Manual
priority: P2
status: Active
validFrom: "storybook-addon ≥ 0.1.0-beta.11. Step 7 (static build-storybook) is the step that exercises the addon's exports subpaths for real"
validUntil: ""
expected: "the a11y panel renders per story and updates when controls change the DOM"
twin: D9
covers:
  - packages.@real-a11y-dev/storybook-addon
notion: "https://app.notion.com/p/3aa1c354b0b5811995bec631b35d4c46"
---

## Steps

```bash
pnpm --filter @real-a11y-dev/example-storybook storybook
```

1. Open any story — does the a11y panel appear in the addons tray? Select it, then click
   another addon tab (Controls) **with the mouse** — does the tray stay usable?
2. Switch between stories whose trees differ; the panel should re-read each one
3. Change a **control** that alters the rendered DOM (a label, a `disabled` toggle) by
   clicking the Controls tab with the panel open, then back — does the panel update? Then
   switch the panel to **DOM**, go to Controls and back, and reload the canvas, logging each
   tree's mode in the manager console (twin: D9 step 4)
4. A story whose content renders asynchronously
5. A story with **multiple roots** / no single wrapper element
6. A story rendering into a portal (a modal or tooltip)
7. `pnpm --filter @real-a11y-dev/example-storybook build-storybook`, then serve the
   static build and repeat 1–3
8. With another addon tab selected, and with the addon panel hidden, count
   `real-a11y/semantic-navigator/tree-updated` events on the channel for three seconds on
   a story whose content changes (twin: D9 step 8)

## Expected

- **1** — the panel renders per story with no per-story configuration, and selecting it
  never takes the tray away: the mouse click selects Controls. The example takes
  `storybook ^10.6.0`, which is always 10.1 or later, so up to storybook-addon
  0.1.0-beta.19 the panel covered the tab bar on every run — the defect the beta.19
  dogfood filed
- **2/3** — it tracks story and control changes rather than showing the first story's
  tree forever, and comes back in the mode it was left in: **DOM** after the tab switch
  and after the reload, with every tree it logs saying `dom`
- **4** — late content appears
- **5** — a multi-rooted story is handled, not silently truncated to the first root
- **6** — portal content is reachable
- **7** — works in the **static build** too, which is where the addon's `exports`
  subpaths actually get resolved by a real Storybook builder
- **8** — `0` both times. The addon promises no extraction while another tab is active;
  up to 0.1.0-beta.19 it extracted regardless — with another tab selected on Storybook
  10.1 and later, and with the panel hidden on every version

## Why this exists

Step 7 is the one that catches packaging problems the dev server hides: Storybook's dev
mode and its production builder resolve subpath exports differently, so an addon can
work all day in `storybook` and fail in `build-storybook` — which is what most teams
deploy.

Steps 3 and 5 cover the two ways the panel goes quietly stale: not subscribing to
control changes, and picking the first root of a multi-rooted story and ignoring the
rest.
