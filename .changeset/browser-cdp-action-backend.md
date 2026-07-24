---
"@real-a11y-dev/browser": minor
---

`BrowserSession.act()` — the write side of the native producer.

The native tree was read-only; now `session.act(request)` dispatches a **click**, **type**, or **focus** against one of its nodes, over CDP. It rides the producer's id scheme: every native node id encodes its Chromium `backendDOMNodeId` (`ax-dom-<n>`), so `act` parses the id, resolves it to the live DOM element (`DOM.resolveNode`), and dispatches (`Runtime.callFunctionOn`) — using the same prototype value-setter + `input`/`change` sequence the DOM engine does, so framework-controlled inputs register the change.

```ts
const tree = await session.nativeTree();
const node = [...tree.nodes.values()].find((n) => n.a11y.name === "Save");
await session.act({ nodeId: node.id, action: "click" }); // { success: true }
```

Safety is enforced by construction, matching the read path: an `ActionResult` never carries the value typed into a field or any field content (the in-page function returns only a structural marker), and CDP errors are surfaced as content-free strings. A node with no backing DOM element (`ax-<n>`, e.g. a synthesized document root) is refused. Actions beyond click/type/focus are rejected with a clear message rather than guessed at.

`act` is added to the `A11ySession` interface. `CdpActionBackend` and `backendNodeIdFrom` are exported for callers driving their own CDP session. Chromium only.
