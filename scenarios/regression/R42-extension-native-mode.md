---
id: R42
suite: regression
scenario: "Extension: Chrome's tree — read with nothing asked, the note about Chrome's debugging bar, a refused attach, Settings, and the TAB view"
area: Extension
type: Manual
priority: P0
status: Active
validFrom: "extension ≥ 0.1.16. On 0.1.15 or earlier there is no native mode, so this row is Blocked, not Fail. A step marked 'extension ≤ 0.1.17' runs only up to 0.1.17, which also had an in-page tree and a switch to stop reading through Chrome, and one marked 'from 0.1.18' only from then. Load unpacked from packages/extension/dist"
validUntil: ""
expected: "a fresh profile reads Chrome's tree with nothing asked, and Chrome's bar names the extension; a note explains the bar once; from 0.1.18, where Chrome refuses the attach the panel says why and the TAB view still lists the tab order, a profile that turned reading through Chrome off reads Chrome's tree after the update, and Settings holds Show full names alone; Cancel on the bar is respected; each window's panel shows only its own window's tab, or a popup opened from it; page focus selects its row in Chrome's tree without the bar, inside frames too; what a click through the tree loads a moment later, and a change inside a shown frame with Follow page changes on, reach Chrome's tree without Refresh; its state badges take the shared panel's colours; its TAB view lists the page's tab stops in the order Tab visits them, with no bar; up to 0.1.17, Turn off and the Settings switch stop the reads, and nothing attaches while it is off"
twin: D6
notion: ""
---

## Steps

```bash
pnpm --filter @real-a11y-dev/semantic-navigator-extension build
```

Load `packages/extension/dist` unpacked, as in **R17**. Removing the extension clears
its settings and the note, and reloading it keeps them, so **remove the extension and
load it again** before step 1, step 10 and step 11, and after step 7.

**Out of the box**

1. Open the side panel on an ordinary `https://` page. Nothing is asked: the panel
   shows Chrome's tree, with **A11Y / TAB** in its toolbar (from 0.1.18; see
   step 19), and no **DOM** button anywhere. (Extension ≤ 0.1.17: **Settings ▾**
   has **Chrome's tree** pressed under **Show**, and Chrome's tree has no TAB.)
   While it reads, Chrome's bar appears across every window: “Semantic
   Navigator” started debugging this browser. The bar comes and goes, because
   the extension attaches only to read or act.
2. A note below the toolbar explains the bar, with **Got it** alone (extension
   ≤ 0.1.17: and **Turn off**). Press **Got it**: the note goes, and focus moves
   to the tree. Close and reopen the panel, then quit Chrome and start it again:
   the note doesn't come back, and each time Chrome's tree arrives without a
   click.
3. Open a page with a `<video controls>` element. Chrome's tree shows the
   player's own controls (play, mute, the timeline), which live in the browser's
   own shadow tree, where no walk of the page from inside it can see them.
   (Extension ≤ 0.1.17: choose **In-page tree** in **Settings ▾** and they are
   gone; Settings stays open, and the toolbar shows the in-page tree's
   **DOM / A11Y / TAB** views, with the only **DOM** button in it. Choose
   **Chrome's tree** again before step 4.)
4. Act through the tree: activate a button, type into a text field. The page's
   own handlers run.
5. Arm the picker (⦿, or `Ctrl`/`Cmd`+`Shift`+`C`). The debugger stays attached while
   a pick is armed, so the bar stays up: press its **Cancel**. The pick ends with
   nothing selected. Navigate the tab to another page: nothing attaches by itself, and
   the native tree says auto-refresh is paused because you cancelled Chrome's
   debugging bar. **↻** (Refresh native tree) reads the new page, and the bar comes
   back for that read.

**Where Chrome won't attach** (from 0.1.18)

6. Open DevTools on a page, docked to its tab, then open the side panel on it,
   or press **↻**: the panel says DevTools is attached and Chrome allows only one
   debugger client at a time, and shows no other tree in its place. Chrome's bar
   doesn't appear. Press **TAB**: the page's tab stops are listed, still with no
   bar. Close DevTools and press **↻**: Chrome's tree is read, and the bar comes
   up for it.
7. Remove the extension, load extension 0.1.17 unpacked, and uncheck **Read
   pages through Chrome (recommended)** in **Settings ▾**. Then build this
   version into the same `dist` folder and press the reload icon on
   `chrome://extensions`, which keeps the extension's storage. Open the panel on
   a page: Chrome's tree is read with nothing asked, and nothing offers an
   in-page tree.

**Settings**

8. Make the side panel as narrow as Chrome lets it, and open **Settings ▾**, next
   to the page's title: it is fully on screen, and so is everything in it. From
   0.1.18 it holds **Show full names** alone. (Extension ≤ 0.1.17: **Read pages
   through Chrome (recommended)** is checked, with a line about the bar under
   it, and **Show** (**Chrome's tree** / **In-page tree**) below that, then
   **Show full names**.)

**Turning it off** (extension ≤ 0.1.17 only)

9. In **Settings ▾**, uncheck **Read pages through Chrome (recommended)**. The
   panel shows the in-page tree, **Show** goes while **Show full names** stays,
   focus stays on the switch, and the bar does not come back while you browse.
   Close and reopen the panel, then quit Chrome and start it again: still the
   in-page tree, and still no bar. Check the switch again: the panel reads the
   page natively at once, and the bar appears for that read.
10. Remove the extension, load it again, and open the panel on a page. In the
    note, press **Turn off**: the in-page tree shows, the note goes, and the bar
    doesn't come back. Settings shows the switch unchecked.

**With a screen reader** (VoiceOver / NVDA)

11. Open the panel on a page with the screen reader running. When Chrome's tree
    arrives, it announces that Chrome shows a bar while the panel reads a page,
    and points to the note below the toolbar. Move to the note: it is announced
    as a note about Chrome's debugging bar, and its text reads out. In Settings,
    **Show full names** announces as a checkbox, with its hint as its
    description. (Extension ≤ 0.1.17: the switch announces as a checkbox, "Read
    pages through Chrome (recommended)", with the line about the bar as its
    description; **Show** announces as a group, and its two buttons as toggle
    buttons, one pressed.)

**Two windows** — each Chrome window has its own side panel

12. Open a second Chrome window and the side panel in both, each on an ordinary
    page. Click around the second window and switch tabs there: the first
    window's panel keeps its own page's title, tree and announcements. From the
    first window's page, open a popup (in the console,
    `window.open(location.href, "", "popup")`): the first window's panel shows
    it. Click into that panel: it stays on the popup, and **×** closes the
    popup, not the page. Open the popup again, then click the first window's
    page: the panel shows its own tab again. (Extension ≤ 0.1.17: turning
    native mode off in one window's Settings returns the other window's panel to
    the in-page tree by itself; turning it back on says Chrome's tree is in
    Settings again there, and reads nothing until you choose it.)

**Focus sync**

13. On **Chrome's tree**, click into the page and press `Tab` a few times: each
    press selects the focused element's row, opening the rows above it and
    scrolling to it, and Chrome's bar doesn't appear for it. Press **Focus sync**
    in the toolbar, which then reads **Focus OFF**, and press `Tab` on the page
    again: the selection stays where it was. Press it once more, and `Tab` is
    followed again.
14. Open a page with an `<iframe>`, a cross-origin one if you can (an embedded
    video or map). Once the frame has loaded, press **↻** (Refresh native tree),
    since a frame that loads after the tree was read, as a lazy embed below the
    fold does, is numbered only by the next read, and wait for Chrome's bar to
    go. Then click into the page and `Tab` into the frame: the focused element's
    row is selected under the frame's row, and Chrome's bar doesn't appear for it.
    `Tab` back out: the top document's rows are followed again.
15. Do the same on a page with frames that have no address of their own, two of
    them if you can: a rich-text editor that edits inside an `<iframe>` (classic
    TinyMCE, CKEditor 4), or the two frames **R19**'s console snippet makes. Press
    **↻**, then click or `Tab` into each frame in turn.

**Keeping up with the page**

16. On **Chrome's tree**, find a button that loads something a moment later (a
    "Load more" or "Show replies" button, or, on Google Calendar, **Create contact**
    in the contacts side panel, which is a frame). Double-click its row, or select
    it and press `Enter`. What loads shows in the tree within a few seconds, with no
    **↻**, and a form that loads inside a frame shows under the frame's row. Then,
    with **⟳** off, click such a button on the page itself, not in the tree: what it
    loads shows the same way. On a page that doesn't change by itself, click some
    text that does nothing: Chrome's bar doesn't come up for it.
17. Press **⟳** (Follow page changes) in the native toolbar: it stays highlighted
    while on. Change something inside a frame on the page yourself, such as typing
    into an embedded editor or opening an embedded map's menu: the frame's rows
    update shortly after you stop. Press **⟳** again to turn it off.
18. On a page with a disabled button and a checked checkbox, Chrome's tree shows
    **disabled** in red and **checked** in green, as the inspector's panel does,
    and only a frame row with nothing read under it says **embedded**.

**Tab order** (from 0.1.18; on 0.1.17 or earlier Chrome's tree has no **TAB**,
and the tab order is only in the in-page tree)

19. On **Chrome's tree**, on a page with a positive `tabindex` if you can, and no
    iframe, shadow root or focus trap, which the list doesn't model (or
    `packages/extension/e2e/fixtures/tab-order.html`, served over http), wait for
    Chrome's bar to go, then press **TAB** in the native toolbar. The tree gives
    way to the page's tab stops, numbered in the order `Tab` visits them, a
    positive `tabindex` first, and Chrome's bar doesn't come up for it. The list
    may say _Reading the page's tab order…_ for a moment first: while the A11Y
    view shows, the page isn't read for it. Click into
    the page and press `Tab` through it: focus visits the stops in the list's
    order. Type in the search box: the list narrows, and the count says how many
    stops are left. Select a stop: the page outlines and focuses it. Arm the
    picker and pick an element: the panel goes back to Chrome's tree, with that
    row selected. Press **TAB** again, then **A11Y**: the tree is back, as you
    left it. With **TAB** on, open **Copy ▾**: it offers **Tab sequence**, and
    the report it copies says its producer is the extension's in-page walk.

## Expected

- **Chrome's tree with nothing asked** (step 1), and Chrome's bar names the
  extension
- The note explains the bar once; **Got it** is remembered across reopening the panel
  and restarting Chrome
- Chrome's tree is Chromium's own: the media controls in step 3 are there
  (extension ≤ 0.1.17: and absent from the in-page tree)
- **No DOM button** (step 1), from 0.1.18 (extension ≤ 0.1.17: at most one, the
  in-page tree's, once that tree shows)
- **Cancel is respected** (step 5): no automatic read attaches again on that tab until
  you refresh it yourself
- **A refused attach says why** (step 6), from 0.1.18: no other tree in its
  place, no bar, and the TAB view still lists the tab order
- **An old "off" no longer counts** (step 7), from 0.1.18: Chrome's tree is read
  with nothing asked
- **Settings fits the panel** (step 8), and holds **Show full names** alone from
  0.1.18
- **Off means off** (steps 9–10, extension ≤ 0.1.17 only): no bar while it is
  off, across reopening the panel and restarting Chrome; turning it back on reads
  at once
- The note and Settings work by keyboard alone, and a screen reader hears what the
  bar is, not only the buttons
- **Each window's panel shows its own window's tab** (step 12): another window's
  tabs never show in it, and a popup opened from it shows there until it closes or
  you go back to the window's page, and stays while you use the panel itself
- **Page focus selects its row in Chrome's tree** (step 13) with no bar, and
  **Focus OFF** stops it; inside a frame too (step 14), under that frame's row
- **Each blank frame is followed under its own row** (step 15): focus in the first
  selects a row under the first frame's row, focus in the second under the second's,
  never the other way round
- **Chrome's tree keeps up** (steps 16–17): what a click loads a moment later, made
  through the tree or on the page itself, reaches it without **↻**, inside a frame
  too, and a click that changes nothing on a quiet page reads nothing; with
  **Follow page changes** on, so does a change made inside a frame the page shows
- **Chrome's tree looks like the other panels** (step 18): the same state badge
  is the same colour, and **embedded** marks only a frame nothing was read from
- **Chrome's tree shows the tab order** (step 19): its TAB view lists the stops in
  the order `Tab` visits them, with no bar, a selected stop gets the page's focus,
  a pick goes back to the tree, and **Copy ▾** offers the tab sequence, named as
  the in-page walk's

## Why this exists

`chrome.debugger` is the most sensitive thing this extension does. While it is
attached Chrome puts a bar across every window, and the permission is why every
existing user re-consents on the update that adds it. Chrome's tree is the side
panel's tree, so that bar is among the first things a new user sees the extension
do, and the note is the extension's only word about it. A bar the note doesn't
explain, a bar that came back after Cancel, or, up to 0.1.17, an "off" that still
attached is the failure this row exists to catch.

The e2e suite drives the panel's side of all this in Chromium
(`packages/extension/e2e/store-build.test.ts`), but headless Chromium has no
debugging bar, no restart, and no screen reader, which are exactly what a user meets
first.

Steps 6 and 7 are here because, from 0.1.18, there is no in-page tree to fall back
on: where Chrome refuses the attach, the panel's message is all it shows, and the
TAB view the one part still working; and a profile that turned reading through
Chrome off on 0.1.17 must not be left with nothing to show.

Step 12 is here because each window has its own side panel, which has to show its
own window's tab and no other's.

Step 19 is here because Chrome's tree carries no tab order (`tabindex` never reaches
a native node): its TAB view is the in-page reading's, the one part of Chrome's tree
that never attaches. Up to 0.1.17, seeing a page's tab order meant switching to the
in-page tree.
