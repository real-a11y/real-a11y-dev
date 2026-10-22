---
id: D9
suite: dogfood
scenario: "Storybook addon from npm in a fresh Storybook project"
area: Storybook
type: Manual
priority: P2
status: Active
validFrom: "storybook-addon ≥ 0.1.0-beta.11 from the registry on the `beta` tag. Record the exact Storybook version used — addon APIs move between majors, and the panel's layout broke in a minor (10.1.0)"
validUntil: ""
expected: "installs per the docs, the panel appears, and it tracks stories — the addon's exports subpaths resolve in a real SB build"
twin: R21
covers:
  - packages.@real-a11y-dev/storybook-addon
notion: "https://app.notion.com/p/3aa1c354b0b581f69748dd227ccfb841"
---

## Steps

A fresh Storybook project, installing from the registry and following only the published docs.
`storybook init` expects an app to add itself to, so scaffold one first:

```bash
npm create vite@latest sb -- --template react-ts
cd sb && npm install
npx storybook@latest init
```

Then install the addon with the command the docs give, as written.

1. Register the addon exactly as the docs describe
2. `npm run storybook` — does the panel appear in the addons tray? Select it, then click
   **Controls** with the mouse: the tray stays usable and Controls becomes selected
3. Switch between stories whose trees **differ** — the init template's Header "Logged In" ↔
   "Logged Out", and Page "Logged In", whose play function changes the DOM. Within the Button
   group every story is the same `button "Button"` tree, so a stale panel looks identical
4. Change the **`label`** control by clicking the Controls tab with the panel open, then
   switching back. `primary`, `size` and `backgroundColor` change only class or style, which
   the A11Y view does not show. Then switch the panel to **DOM**, go to Controls and back,
   select **DOM** again if the panel came back on A11Y, and reload the canvas. Log the mode of
   every tree the manager receives — row labels follow the pressed toggle whatever the tree, so
   this is the only way to see a mismatch:
   `__STORYBOOK_ADDONS_CHANNEL__.on('real-a11y/semantic-navigator/tree-updated',(p)=>console.log(p.mode))`
5. `npm run build-storybook`, serve the static output, repeat 2–4
6. Check the browser console in both dev and static builds, against a **baseline**: the same
   project with the addon's line removed. Storybook logs warnings of its own; only the
   difference is the addon's
7. Try with the **latest** Storybook, record the exact version, and keep one run on the
   previous major as a control
8. With **another** addon tab selected, and again with the addon panel hidden, count the
   addon's events for three seconds on a story whose text changes. Run this in the
   **manager's** console — the top-level Storybook page, not the preview iframe, which is
   the side that emits them:
   `let n=0; __STORYBOOK_ADDONS_CHANNEL__.on('real-a11y/semantic-navigator/tree-updated',()=>n++); setTimeout(()=>console.log(n),3000)`
9. Note anything the docs omit that you needed
10. `npm ls @real-a11y-dev/testing` — the addon should not have brought it in

## Expected

- The addon registers per the docs, with no undocumented extra config
- The panel appears and tracks stories and controls
- **2/4** — selecting the panel never takes the tray away: a mouse click on Controls selects
  it. On storybook-addon 0.1.0-beta.19 with Storybook 10.1 or later the panel paints over the
  tab bar — the known defect the beta.19 dogfood filed, fixed in the first release after it
- **4** — every tree the panel logs matches its pressed toggle: `dom` under DOM, `a11y` under
  A11Y. After the tab switch it is still on DOM on Storybook 10.1 and later; on Storybook 9 it
  comes back on A11Y, as it always has. After the reload it is still on DOM, on every version.
  On 0.1.0-beta.19, Storybook 9 comes back on A11Y over `dom` trees, and every version logs
  `a11y` under DOM after the reload (known defects, fixed in the first release after it)
- **The static build works** — this is where the addon's `exports` subpaths get resolved by
  Storybook's production builder
- No console errors from the addon in either mode — nothing beyond the baseline's
- The docs match the Storybook version people will actually be on
- **8** — `0` both times: the docs promise no extract and no `postMessage` while another tab is
  active. On 0.1.0-beta.19 it streams with another tab selected on Storybook 10.1 or later,
  and with the panel hidden on every version (known defect, fixed in the first release after
  it)
- Step 10 prints `(empty)`, from the first release after `0.1.0-beta.17`: the addon has no
  runtime dependency of its own. Up to `0.1.0-beta.17` it listed `@real-a11y-dev/testing`,
  which it never imported, so there `npm ls` shows it — that is the old behaviour, not a fail

## Why this exists

Step 5 is the reason this row is worth its P2. Storybook's dev server and its production builder
resolve subpath exports through different paths, so an addon can work perfectly in `storybook`
and fail in `build-storybook` — and the static build is what teams deploy and share. A failure
there is invisible to anyone who only ever runs dev.

Step 7 exists because Storybook majors move fast and break addon APIs; a doc pinned to a version
nobody installs any more is a doc that doesn't work, even though nothing about our code changed.
The beta.19 dogfood showed a **minor** is enough: Storybook 10.1.0 stopped positioning the tab
panel and started rendering every addon panel as active, which put the panel over the tab bar
and kept it extracting in the background. Neither showed in a run that switched tabs by
keyboard, changed only style-only controls, or stayed inside the Button stories — which is why
steps 2–4 now say which interaction and which stories, and step 8 measures the laziness the docs
promise. The mode check in step 4 came with the fix for both: a panel that goes idle has to ask
for its tree again, and the beta.19 panel never said in which mode — so a canvas reload restarted
the preview in A11Y under a DOM toggle, and on Storybook 9 a tab switch brought the panel back on
A11Y over a DOM-mode tree.
