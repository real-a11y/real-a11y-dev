---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/mcp": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": minor
"@real-a11y-dev/testing": minor
---

The DOM tree producer now decides modality the way Chromium's own accessibility tree does. Only a `<dialog>` opened with `showModal()` (the `:modal` pseudo-class) scopes the tree **exclusively** to itself. `aria-modal="true"` alone no longer does: the dialog joins the tree as an ordinary overlay, and the page behind it stays.

`aria-modal` is a claim the author makes to assistive tech, not a state the browser enforces, and Chromium does not prune for it. Treating it as modal made the DOM producer disagree with the native one in two ways seen on a real site:

- **A closed drawer blanked the whole page.** A mobile nav left mounted while closed, as `role="dialog" aria-modal="true" aria-hidden="true"` and translated off-screen, passed the CSS visibility check and won the modal scope. Everything inside it is `aria-hidden`, so the page extracted as an **empty tree**: the extension showed nothing, `tabs` printed `(nothing focusable)`, and `real-a11y tree` (native) showed the full page.
- **A cookie bar took over an interactive page.** A bottom consent bar marked `role="alertdialog" aria-modal="true"`, with the page still fully usable, collapsed the tree and the tab order to the banner's four buttons.

Relatedly, an overlay that assistive tech cannot reach (inside `aria-hidden="true"` or `inert`) no longer widens a component root to `document.body`. That closed drawer used to turn every component snapshot on the page into a whole-page snapshot, although nothing in it appears in the tree.

Modal libraries still come out right, because they remove the background themselves: Radix and MUI set `aria-hidden` on the siblings, and Headless UI makes them `inert`. The walk already drops both, the same way Chromium does.

### Breaking change

Tree, tab-order and snapshot output changes wherever an `aria-modal="true"` dialog is open **and** nothing hides the background. That is most common in jsdom tests that fake a modal with the attribute alone. jsdom has no `showModal()`, so it cannot open a native modal at all. Those trees now contain the page as well as the dialog.

**Migration.** Make the fixture modal the way a real page is: set `inert` (or `aria-hidden="true"`) on the content behind the dialog when it opens. Then re-record your snapshots (`vitest -u`). If the component under test really does leave its background exposed, the new output is what a screen reader on Chrome gets, and that gap is in the component, not the baseline.
