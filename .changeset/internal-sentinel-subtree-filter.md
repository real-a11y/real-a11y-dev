---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

Treat a mutation anywhere inside one of the panel's own overlay elements as internal, not just one on the overlay's root element.

The live observer ignores the elements it injects itself — the focus highlight and the screen curtain — so that drawing them cannot trigger the re-extract → re-render → re-redraw loop the filter exists to break. It recognised them by id, and only a text change consulted the ancestor chain. An attribute change was matched against the changed element alone, and a child being added or removed was matched against the moved nodes alone, so neither saw that the element it happened on sits _inside_ an overlay:

```js
// Both of these read as a page mutation and schedule a re-extraction.
curtainLabel.className = "visible"; // attributes, inside #__sn-curtain
highlightFrame.appendChild(corner); // childList, inside #__sn-highlight
```

All three mutation kinds now climb from the changed node, so an overlay's whole subtree is internal.

Nothing changes for a panel that uses the built-in overlays as they are. The curtain does have inner elements, but they are built before it is attached — so the observer never sees those records — and nothing mutates them afterwards. What this does fix is `DomObserver`'s fourth argument, the caller's own set of sentinel ids: an element registered there was only shielded at its root, and any attribute or child change below it still re-armed the observer against the overlay the caller registered to be ignored.

`cli` and `mcp` are left out: they read Chromium's own accessibility tree over CDP and never construct a `DomObserver`.
