---
id: R50
suite: regression
scenario: "Extension: the TIMELINE view — record, stop, clear and copy focus moves and announcements as you use the page"
area: Extension
type: Manual
priority: P1
status: Active
validFrom: "extension ≥ 0.1.22. On 0.1.21 or earlier there is no TIMELINE view, so this row is Blocked, not Fail. Load unpacked from packages/extension/dist"
validUntil: ""
expected: "deleting the focused draft records focus / focus (none) / announce, in order, as it happens; Stop records nothing more; Copy puts exactly those lines on the clipboard, as recordTimeline prints them; clicking a line outlines its element without moving focus; a navigation ends the recording and keeps its lines, none clickable; switching back to A11Y finds Chrome's tree as it was; no new permission prompt on update"
notion: ""
---

## Steps

Serve `packages/extension/e2e/fixtures/timeline.html` (any static server, or
the e2e harness's), and open it with the side panel open on it.

1. Click **TIMELINE** in the tree's toolbar. Note the row selected in Chrome's
   tree first, and anything expanded
2. Press **● Record**. On the page, click **Delete draft**
3. Watch the panel's lines as you click, then press **■ Stop**
4. Press **New draft** on the page, or Tab to it
5. Press **Copy**, and paste into a text editor
6. Press **● Record** again, Tab to **New draft** on the page, then click its
   line in the panel
7. Navigate the tab to another page (type any URL) while still recording
8. Click **A11Y**
9. Update an installed copy of the previous release to this build
   (`chrome://extensions` → Load unpacked over it, or the packed `.zip`)

## Expected

- **2–3** — the lines arrive as you click, before Stop, exactly:
  ```
  focus     button "Delete draft"
  focus     (none)
  announce  status "Draft deleted."
  ```
  and the status reads _Stopped — 3 lines._
- **4** — no new line: a stopped recording records nothing
- **5** — the clipboard holds exactly the three lines above, no header, as
  `recordTimeline` in `@real-a11y-dev/testing` prints them
- **6** — Record starts a new list. Clicking `focus     button "New draft"`
  outlines the button on the page and scrolls to it; focus stays where it was
  on the page, and no new focus line appears
- **7** — the status reads _Recording ended: the page navigated. 1 line._; the
  line stays, and is no longer clickable
- **8** — Chrome's tree comes back with the same row selected and the same rows
  open, without a new read
- **9** — Chrome asks for no new permission

## Why this exists

The A11Y and TAB views show a page at one moment, so focus dropping to nothing
after a delete, or a status shown and cleared, never reaches them: a manual
tester learnt of either with a screen reader running, or not at all. This view
is the one place the sequence shows, and the sequence is its whole claim: a
line out of order is a wrong answer. Copy is pinned to `recordTimeline`'s lines
so a finding made by hand pastes straight into a test.

Step 6 guards the one way the view could change what it records: outlining a
line's node by focusing it, as a TAB row's selection does, would record a focus
move the panel made. Step 9 guards the release rule that a new permission is a
release decision: the recorder runs in the content script that already runs on
every page, and needs none.
