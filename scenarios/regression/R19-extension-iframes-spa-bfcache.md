---
id: R19
suite: regression
scenario: "Extension: iframes, SPA navigation, and back/forward (bfcache) restore"
area: Extension
type: Manual
priority: P1
status: Active
validFrom: "extension ≥ 0.1.8. Manual only — bfcache restore cannot be reproduced reliably in an automated harness"
validUntil: ""
expected: "iframe subtrees appear under their iframe node; after Back the panel shows the RESTORED page and actions hit the right elements"
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
