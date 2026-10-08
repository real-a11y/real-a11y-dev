---
id: R42
suite: regression
scenario: "Extension: native mode — the first-connect question, the native tree, and Chrome's debugging bar"
area: Extension
type: Manual
priority: P0
status: Active
validFrom: "extension ≥ the first release after 0.1.15. Native mode and the first-connect question are both in the `Unreleased` section of packages/extension/CHANGELOG.md until then; on 0.1.15 or earlier there is no native mode, so this row is Blocked, not Fail. Load unpacked from packages/extension/dist"
validUntil: ""
expected: "a profile that never answered is asked before anything attaches; Use native mode reads the native tree and Chrome's bar names the extension; Keep the DOM tree or Esc never attaches; either answer survives reopening the panel and restarting Chrome; Cancel on the bar is respected; Disable detaches"
twin: D6
notion: ""
---

## Steps

```bash
pnpm --filter @real-a11y-dev/semantic-navigator-extension build
```

Load `packages/extension/dist` unpacked, as in **R17**. The panel asks only while the
setting has never been answered, and removing the extension clears it, so **remove the
extension and load it again** before step 1 and before step 8. Reloading it keeps the
answer.

**Saying yes**

1. Open the side panel on an ordinary `https://` page. When the page connects, a
   dialog named **Native mode** opens over the DOM tree, with focus on **Use native
   mode**, and Chrome shows no debugging bar. Press `Tab` a few times: focus stays on
   the dialog's two buttons.
2. Press **Use native mode**. The panel shows the native tree, and while it reads,
   Chrome's bar appears across every window: “Semantic Navigator” started debugging
   this browser. The bar comes and goes, because native mode attaches only to read or
   act. The toolbar now has a **DOM / NATIVE** toggle with NATIVE pressed, and
   **Disable native mode** next to it.
3. Close the side panel and open it again on the same page: no question, and the
   native tree arrives without a click. Quit Chrome, start it again and open the
   panel: the same.
4. Open a page with a `<video controls>` element. The native tree shows the player's
   own controls (play, mute, the timeline); press **DOM** and they are gone, because
   they live in the browser's own shadow tree, which the DOM walk can't see.
5. Back on **NATIVE**, act through the tree: activate a button, type into a text
   field. The page's own handlers run.
6. Arm the picker (⦿, or `Ctrl`/`Cmd`+`Shift`+`C`). The debugger stays attached while
   a pick is armed, so the bar stays up: press its **Cancel**. The pick ends with
   nothing selected. Navigate the tab to another page: nothing attaches by itself, and
   the native tree says auto-refresh is paused because you cancelled Chrome's
   debugging bar. **↻** (Refresh native tree) reads the new page, and the bar comes
   back for that read.
7. Press **Disable native mode**. The panel shows the DOM tree, the bar does not come
   back while you browse, and the toolbar shows **Enable native mode…** again.

**Saying no**

8. Remove the extension, load it again, and open the panel on a page. The question
   opens: press `Esc`. The DOM tree shows, and Chrome's bar never appears.
9. Close and reopen the panel, and switch tabs: no question.
10. Press **Enable native mode…**. The same question opens; **Use native mode** turns
    native mode on as in step 2.

**With a screen reader** (VoiceOver / NVDA)

11. Repeat step 1 on a profile that never answered. The screen reader announces a
    dialog named "Native mode", reads its explanation (the bar Chrome shows, and the
    DOM tree as the other answer), and lands on the "Use native mode" button.

## Expected

- **Nothing attaches before the answer.** No bar until **Use native mode**, and none
  at all on the "no" path (steps 8–9)
- Either answer is remembered across reopening the panel, switching tabs and
  restarting Chrome; the question never comes back on its own
- The native tree is Chromium's own: the media controls in step 4 are there, and
  absent from the DOM tree
- **Cancel is respected** (step 6): no automatic read attaches again on that tab until
  you refresh it yourself
- **Disable** detaches, and the bar stays away
- The question is usable by keyboard alone, and a screen reader hears what it asks,
  not only its buttons

## Why this exists

`chrome.debugger` is the most sensitive thing this extension does. While it is
attached Chrome puts a bar across every window, and the permission is why every
existing user re-consents on the update that adds it. The first-connect question is
the extension's own consent step for it, so order is the point of this row: a read
that ran before the answer, a "no" that still attached, or a bar that came back after
Cancel is the failure it exists to catch.

The e2e suite drives the panel's side of all this in Chromium
(`packages/extension/e2e/native-opt-in.test.ts` for the question), but headless
Chromium has no debugging bar, no restart, and no screen reader, which are exactly
what a user meets first. Step 11 is here because the question's explanation reaches
a screen reader only as the dialog's description: focus lands on a button, so without
it a screen-reader user would hear "Native mode, dialog, Use native mode" and nothing
about the bar they are agreeing to.
