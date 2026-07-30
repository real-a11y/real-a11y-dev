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

**SPA navigation**

4. Navigate client-side (a router link, no full reload) — does the panel follow?
5. Act on a control that exists only on the new route
6. Trigger a hash change and a `pushState` — the panel should keep up without a full
   re-read

**Back / forward (bfcache)**

7. Full-page navigate away, then press **Back**
8. Read the panel: is it showing the restored page or the one you left?
9. Act on a control on the restored page
10. Forward, then Back again

## Expected

- **2** — iframe subtrees render under their iframe node, not as a separate root or a
  blank
- **3/5/9** — actions hit elements on the **currently shown** page
- **4/6** — the panel tracks client-side navigation; it must not require a manual
  reload
- **8** — the panel shows the **restored** page. This is the one that breaks

## Why this exists

bfcache restore (7–10) is the highest-value case here and the least likely to be
tried. On Back, Chrome restores the old document without firing the load events a
naive implementation listens for — so the panel keeps rendering the page you left
while the user looks at a different one. Every action then lands on the wrong
document, or on nothing, and the panel gives no indication anything is wrong.

Step 9 is the specific check: reading a stale tree is confusing, but _acting_ on a
stale tree mutates a page the user isn't looking at.
