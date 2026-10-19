---
id: R19
suite: regression
scenario: "Extension: iframes, SPA navigation, and back/forward (bfcache) restore"
area: Extension
type: Manual
priority: P1
status: Active
validFrom: "extension ≥ 0.1.8; steps 15–19 from 0.1.16. Manual only — bfcache restore cannot be reproduced reliably in an automated harness"
validUntil: ""
expected: "iframe subtrees appear under their iframe node, blank and script-written frames included, each under its own; after Back the panel shows the RESTORED page and actions hit the right elements"
notion: "https://app.notion.com/p/3aa1c354b0b5811eaea8e3ddfde1467b"
---

## Steps

Use a real SPA with client-side routing and at least one same-origin iframe.

**Iframes**

1. Open a page with an iframe; find the iframe node in the tree
2. Expand it — does the iframe's own content appear beneath it?
3. Select a node **inside** the iframe and act on it
4. Collapse every top-frame subtree, then click into the page and **Tab** to a
   control inside the iframe. Watch what the panel selects _and_ what it expands

**SPA navigation**

5. Navigate client-side (a router link, no full reload) — does the panel follow?
6. Act on a control that exists only on the new route
7. Trigger a hash change and a `pushState` — the panel should keep up without a full
   re-read

**Back / forward (bfcache)**

8. Full-page navigate away, then press **Back**
9. Read the panel: is it showing the restored page or the one you left?
10. Act on a control on the restored page
11. Forward, then Back again

**Service-worker restart**

12. Back on the iframe page from step 1, expand an iframe subtree and select a node
    inside it
13. Kill the background worker: `chrome://extensions` → the extension's **service
    worker** link → close it. (Idling it out for ~30s works too.)
14. Cause a DOM change in the **top** frame only — type in a field, click a button.
    Do not touch anything inside the iframes

**Frames with no address of their own**

Use a page whose frames have no URL: a rich-text editor that edits inside an
`<iframe>` (the classic-mode TinyMCE and CKEditor 4 demos do; put two editors on
one page if the demo lets you), or any page you can paste this into the console of:

```js
for (const label of ["One", "Two"]) {
  const frame = document.createElement("iframe");
  frame.title = label;
  document.body.append(frame);
  frame.contentDocument.open();
  frame.contentDocument.write(`<button>${label} button</button>`);
  frame.contentDocument.close();
}
```

15. Show the **In-page tree** (Settings ▾) and expand each of those frames' nodes
16. Select a node inside one and act on it
17. Change what a frame shows — type in the editor, or run the snippet's three
    `contentDocument` lines again on one frame with another label
18. Find a sandboxed frame if the page has one (`<iframe sandbox>` without
    `allow-same-origin`, common around ads) and expand its node

**Hidden frames**

19. Open a news article with an embedded video or map: most such pages also
    load hidden ad and tracking frames, which
    `[...document.querySelectorAll("iframe")].filter((f) => !f.checkVisibility())`
    lists in the console. Show the **In-page tree** and expand the video's or
    map's iframe node

## Expected

- **2** — iframe subtrees render under their iframe node, not as a separate root or a
  blank
- **3/6/10** — actions hit elements on the **currently shown** page
- **4** — the panel selects the focused iframe node and expands **only** the path to
  it. No unrelated top-frame subtree opens along the way
- **5/7** — the panel tracks client-side navigation; it must not require a manual
  reload
- **9** — the panel shows the **restored** page. This is the one that breaks
- **14** — the iframe subtrees are still there after the tree redraws. They must not
  disappear and wait for you to interact inside each iframe to come back
- **15** — each frame's content sits under **its own** iframe node: `One button`
  under `One`, `Two button` under `Two`, never both under one or swapped. Before 0.1.16
  these nodes are empty, which is a Blocked, not a Fail
- **16** — the action lands in the frame the node is in
- **17** — the tree shows the new content, under the same iframe node, without a
  reload
- **18** — an empty iframe node. No content script runs in a sandboxed frame, so
  nothing inside it is read; it must not show another frame's content
- **19** — the embed's own content sits under its iframe node: the player's or
  the map's controls, not an ad's or a tracker's, and not nothing. A hidden
  frame's content hangs under no iframe node

## Why this exists

bfcache restore (8–11) is the highest-value case here and the least likely to be
tried. On Back, Chrome restores the old document without firing the load events a
naive implementation listens for — so the panel keeps rendering the page you left
while the user looks at a different one. Every action then lands on the wrong
document, or on nothing, and the panel gives no indication anything is wrong.

Step 10 is the specific check: reading a stale tree is confusing, but _acting_ on a
stale tree mutates a page the user isn't looking at.

Step 4 guards a quieter failure. Node ids are a per-frame counter, so an iframe's
`sn-3` is a different node from the top frame's `sn-3`. The panel used to receive
each focus event twice — once raw from the frame, once frame-prefixed from the
background — and the raw copy made it select and force-expand the ancestors of
whichever unrelated top-frame node happened to share that id. The prefixed copy then
corrected the selection, so the only surviving evidence is the subtree that opened on
its own. Watching what _expands_, not just what ends up selected, is the whole point
of the step.

Steps 12–14 cover the same "iframe subtrees are present" assertion under the one
condition the load / SPA / bfcache paths never reach. The background holds each
tab's per-frame trees in memory, so a worker restart drops them while the page's
content scripts keep running and stay silent until their own DOM next changes —
which meant the first top-frame change republished the page without any iframe.
Chrome restarts that worker on its own schedule, so this is a state users reach by
waiting, not by doing anything unusual.

Steps 15–18 are the frames the URL can't tell apart. An `about:blank` or `srcdoc`
frame, and one a script writes into, has no URL of its own: every one of them shows
the same, and their `<iframe>`s carry no `src` to compare it with. The panel used to
have no content script in them at all, so editors and many ad slots were empty
nodes. Now each frame says which `<iframe>` holds it, and the failure to look for is
the one a guess produces: two frames' content under one node, or under each other's.
Step 17 is its own check because writing a document over again (`document.open()`)
removes everything the content script had attached to the old one, with no
navigation to load a new script; the tree then goes on showing the document that is
gone. Step 18 is the boundary: a frame the panel can't read must stay empty rather
than be given a neighbour's subtree.

Step 19 is the frame a URL places loosely. A hidden frame's `<iframe>` has no
node in the tree, so the frame's URL names none exactly: it is matched without
its query string, or put under the first empty `<iframe>` as a last resort. Such
frames load before the embeds a page shows, and frames used to be placed one at
a time in the order they loaded, so a tracker took the video's node: its content
showed there, the video's was missing, and the tracker's changes counted as the
page's for Chrome's tree. Every frame now takes the `<iframe>` its URL names
before any is placed loosely.
