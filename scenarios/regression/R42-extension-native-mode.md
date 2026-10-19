---
id: R42
suite: regression
scenario: "Extension: native mode — on by default, the note about Chrome's debugging bar, Settings, and the native tree"
area: Extension
type: Manual
priority: P0
status: Active
validFrom: "extension ≥ 0.1.16. On 0.1.15 or earlier there is no native mode, so this row is Blocked, not Fail. Load unpacked from packages/extension/dist"
validUntil: ""
expected: "a fresh profile reads the native tree with nothing asked, and Chrome's bar names the extension; a note explains the bar once; Settings holds the choice of tree, leaving the toolbar at most one DOM button; Turn off and Settings turn native mode off, and nothing attaches while it is off; the setting survives reopening the panel and restarting Chrome; Cancel on the bar is respected; a change in one window holds in every window, and each window's panel shows only its own window's tab, or a popup opened from it; page focus selects its row in Chrome's tree without the bar, inside frames too; what a click through the tree loads a moment later, and a change inside a shown frame with Follow page changes on, reach Chrome's tree without Refresh; its state badges take the in-page tree's colours"
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
   shows the native tree, **Settings ▾** has **Chrome's tree** pressed under
   **Show**, and the toolbar has no **DOM** button: the in-page tree's
   **DOM / A11Y / TAB** views show only with that tree. While it reads, Chrome's
   bar appears across every window: “Semantic Navigator” started debugging this
   browser. The bar comes and goes, because native mode attaches only to read or
   act.
2. A note below the toolbar explains the bar, with **Got it** and **Turn off**. Press
   **Got it**: the note goes, and focus moves to the tree. Close and reopen the panel,
   then quit Chrome and start it again: the note doesn't come back, and each time the
   native tree arrives without a click.
3. Open a page with a `<video controls>` element. The native tree shows the player's
   own controls (play, mute, the timeline); choose **In-page tree** in **Settings ▾**
   and they are gone, because they live in the browser's own shadow tree, which the
   DOM walk can't see. Settings stays open, and the toolbar now shows the
   **DOM / A11Y / TAB** views, with the only **DOM** button in it.
4. Back on **Chrome's tree**, act through the tree: activate a button, type into a
   text field. The page's own handlers run.
5. Arm the picker (⦿, or `Ctrl`/`Cmd`+`Shift`+`C`). The debugger stays attached while
   a pick is armed, so the bar stays up: press its **Cancel**. The pick ends with
   nothing selected. Navigate the tab to another page: nothing attaches by itself, and
   the native tree says auto-refresh is paused because you cancelled Chrome's
   debugging bar. **↻** (Refresh native tree) reads the new page, and the bar comes
   back for that read.

**Turning it off**

6. Make the side panel as narrow as Chrome lets it, and open **Settings ▾**, next
   to the page's title: it is fully on screen, and so is everything in it. **Read
   pages through Chrome (recommended)** is checked, with a line about the bar under
   it, and **Show** (**Chrome's tree** / **In-page tree**) below that. Uncheck it.
   The panel shows the in-page tree, **Show** goes, focus stays on the switch, and
   the bar does not come back while you browse.
7. Close and reopen the panel, then quit Chrome and start it again: still the
   in-page tree, and still no bar.
8. Check the switch again: the panel reads the page natively at once, and the bar
   appears for that read.
9. Remove the extension, load it again, and open the panel on a page. In the note,
   press **Turn off**: the in-page tree shows, the note goes, and the bar doesn't
   come back. Settings shows the switch unchecked.

**With a screen reader** (VoiceOver / NVDA)

10. Open the panel on a page with the screen reader running. When the native tree
    arrives, it announces that Chrome shows a bar while the panel reads a page, and
    points to the note below the toolbar. Move to the note: it is announced as a note
    about Chrome's debugging bar, and its text reads out. In Settings, the switch
    announces as a checkbox, "Read pages through Chrome (recommended)", with the line
    about the bar as its description; **Show** announces as a group, and its two
    buttons as toggle buttons, one pressed.

**Two windows** — each Chrome window has its own side panel

11. Open a second Chrome window and the side panel in both, each on an ordinary
    page. Turn native mode off in one window's Settings: the other window's panel
    returns to the in-page tree by itself.
12. Turn it back on in the first window: the other window's panel says Chrome's tree
    is in Settings again, but nothing is read there until you choose **Chrome's
    tree** in its **Settings ▾**. Then click around the second window and switch
    tabs there: the first window's panel keeps its own page's title, tree and
    announcements. From the first window's page, open a popup (in the console,
    `window.open(location.href, "", "popup")`): the first window's panel shows it.
    Click into that panel: it stays on the popup, and **×** closes the popup, not
    the page. Open the popup again, then click the first window's page: the panel
    shows its own tab again.

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
18. On a page with a disabled button and a checked checkbox, both trees show
    **disabled** in red and **checked** in green, and only a frame row with nothing
    read under it says **embedded**.

## Expected

- **The native tree with nothing asked** (step 1), and Chrome's bar names the
  extension
- The note explains the bar once; **Got it** is remembered across reopening the panel
  and restarting Chrome
- The native tree is Chromium's own: the media controls in step 3 are there, and
  absent from the in-page tree
- **At most one DOM button** (steps 1 and 3): which tree shows is chosen in
  Settings, under **Show**, so the toolbar has no **DOM** while Chrome's tree shows,
  and only the in-page tree's DOM view once that tree does
- **Cancel is respected** (step 5): no automatic read attaches again on that tab until
  you refresh it yourself
- **Off means off** (steps 6–9): no bar while it is off, across reopening the panel
  and restarting Chrome; turning it back on reads at once
- The note and the switch work by keyboard alone, and a screen reader hears what the
  bar is, not only the buttons
- **A change in one window holds in every window** (steps 11–12), and nothing reads
  natively in a window where nobody pressed anything
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
- **The two trees look alike** (step 18): the same state badge is the same colour in
  both, and **embedded** marks only a frame nothing was read from

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
