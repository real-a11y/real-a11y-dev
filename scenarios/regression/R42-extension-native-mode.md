---
id: R42
suite: regression
scenario: "Extension: native mode — on by default, the note about Chrome's debugging bar, Settings, and the native tree"
area: Extension
type: Manual
priority: P0
status: Active
validFrom: "extension ≥ the first release after 0.1.15. Native mode is in the `Unreleased` section of packages/extension/CHANGELOG.md until then; on 0.1.15 or earlier there is no native mode, so this row is Blocked, not Fail. Load unpacked from packages/extension/dist"
validUntil: ""
expected: "a fresh profile reads the native tree with nothing asked, and Chrome's bar names the extension; a note explains the bar once; Turn off and Settings turn native mode off, and nothing attaches while it is off; the setting survives reopening the panel and restarting Chrome; Cancel on the bar is respected; a change in one window holds in every window"
twin: D6
notion: ""
---

## Steps

```bash
pnpm --filter @real-a11y-dev/semantic-navigator-extension build
```

Load `packages/extension/dist` unpacked, as in **R17**. Removing the extension clears
its settings and the note, and reloading it keeps them, so **remove the extension and
load it again** before step 1, step 9 and step 10.

**Out of the box**

1. Open the side panel on an ordinary `https://` page. Nothing is asked: the panel
   shows the native tree, the toolbar's **DOM / NATIVE** toggle has NATIVE pressed,
   and while it reads, Chrome's bar appears across every window: “Semantic
   Navigator” started debugging this browser. The bar comes and goes, because native
   mode attaches only to read or act.
2. A note below the toolbar explains the bar, with **Got it** and **Turn off**. Press
   **Got it**: the note goes, and focus moves to the tree. Close and reopen the panel,
   then quit Chrome and start it again: the note doesn't come back, and each time the
   native tree arrives without a click.
3. Open a page with a `<video controls>` element. The native tree shows the player's
   own controls (play, mute, the timeline); press **DOM** and they are gone, because
   they live in the browser's own shadow tree, which the DOM walk can't see.
4. Back on **NATIVE**, act through the tree: activate a button, type into a text
   field. The page's own handlers run.
5. Arm the picker (⦿, or `Ctrl`/`Cmd`+`Shift`+`C`). The debugger stays attached while
   a pick is armed, so the bar stays up: press its **Cancel**. The pick ends with
   nothing selected. Navigate the tab to another page: nothing attaches by itself, and
   the native tree says auto-refresh is paused because you cancelled Chrome's
   debugging bar. **↻** (Refresh native tree) reads the new page, and the bar comes
   back for that read.

**Turning it off**

6. Open **Settings ▾**, next to the page's title: **Read pages through Chrome
   (recommended)** is checked, with a line about the bar under it. Uncheck it. The
   panel shows the DOM tree, the **DOM / NATIVE** toggle goes, focus stays on the
   switch, and the bar does not come back while you browse. Make the side panel as
   narrow as Chrome lets it: **Settings ▾** is still fully on screen.
7. Close and reopen the panel, then quit Chrome and start it again: still the DOM
   tree, and still no bar.
8. Check the switch again: the panel reads the page natively at once, and the bar
   appears for that read.
9. Remove the extension, load it again, and open the panel on a page. In the note,
   press **Turn off**: the DOM tree shows, the note goes, and the bar doesn't come
   back. Settings shows the switch unchecked.

**With a screen reader** (VoiceOver / NVDA)

10. Open the panel on a page with the screen reader running. When the native tree
    arrives, it announces that Chrome shows a bar while the panel reads a page, and
    points to the note below the toolbar. Move to the note: it is announced as a note
    about Chrome's debugging bar, and its text reads out. In Settings, the switch
    announces as a checkbox, "Read pages through Chrome (recommended)", with the line
    about the bar as its description.

**Two windows** — each Chrome window has its own side panel

11. Open a second Chrome window and the side panel in both, each on an ordinary
    page. Turn native mode off in one window's Settings: the other window's panel
    returns to the DOM tree by itself.
12. Turn it back on in the first window: the other window's toolbar shows the
    **DOM / NATIVE** toggle again, but nothing is read there until you press NATIVE.

## Expected

- **The native tree with nothing asked** (step 1), and Chrome's bar names the
  extension
- The note explains the bar once; **Got it** is remembered across reopening the panel
  and restarting Chrome
- The native tree is Chromium's own: the media controls in step 3 are there, and
  absent from the DOM tree
- **Cancel is respected** (step 5): no automatic read attaches again on that tab until
  you refresh it yourself
- **Off means off** (steps 6–9): no bar while it is off, across reopening the panel
  and restarting Chrome; turning it back on reads at once
- The note and the switch work by keyboard alone, and a screen reader hears what the
  bar is, not only the buttons
- **A change in one window holds in every window** (steps 11–12), and nothing reads
  natively in a window where nobody pressed anything

## Why this exists

`chrome.debugger` is the most sensitive thing this extension does. While it is
attached Chrome puts a bar across every window, and the permission is why every
existing user re-consents on the update that adds it. Native mode is on by default,
so that bar is among the first things a new user sees the extension do, and the note
is the extension's only word about it. A bar the note doesn't explain, an "off" that
still attaches, or a bar that came back after Cancel is the failure this row exists to
catch.

The e2e suite drives the panel's side of all this in Chromium
(`packages/extension/e2e/native-on-by-default.test.ts`), but headless Chromium has no
debugging bar, no restart, and no screen reader, which are exactly what a user meets
first.

Steps 11–12 are here because each window has its own side panel, and a setting
changed in one has to reach panels already open in the others.
