# @real-a11y-dev/browser

## 0.1.0-beta.11

### Minor Changes

- 9d080eb: `BrowserSession.act()` — the write side of the native producer.

  The native tree was read-only; now `session.act(request)` dispatches a **click**, **type**, or **focus** against one of its nodes, over CDP. It rides the producer's id scheme: every native node id encodes its Chromium `backendDOMNodeId` (`ax-dom-<n>`), so `act` parses the id, resolves it to the live DOM element (`DOM.resolveNode`), and dispatches (`Runtime.callFunctionOn`) — using the same prototype value-setter + `input`/`change` sequence the DOM engine does, so framework-controlled inputs register the change.

  ```ts
  const tree = await session.nativeTree();
  const node = [...tree.nodes.values()].find((n) => n.a11y.name === "Save");
  await session.act({ nodeId: node.id, action: "click" }); // { success: true }
  ```

  Safety is enforced by construction, matching the read path: an `ActionResult` never carries the value typed into a field or any field content (the in-page function returns only a structural marker), and CDP errors are surfaced as content-free strings. A node with no backing DOM element (`ax-<n>`, e.g. a synthesized document root) is refused. Actions beyond click/type/focus are rejected with a clear message rather than guessed at.

  `act` is added to the `A11ySession` interface. `CdpActionBackend` and `backendNodeIdFrom` are exported for callers driving their own CDP session. Chromium only.

- cf426d3: Add the **native accessibility-tree producer**: `browser.nativeTree()` reads Chromium's own tree over CDP (`Accessibility.getFullAXTree`) and normalizes it into the same `ExtractionResult` model the DOM producer emits, stamped `source.producer === "native"`. This is the second producer from the native-tree RFC (#197) — one canonical model, two producers.

  It surfaces structure no in-page walk can reach, most visibly a `<video controls>`'s user-agent-shadow controls (play, scrubber, mute). Vocabulary (which nodes survive, sibling order, role map, name promotion) comes from core's shared `normalizeNativeAX`, so `serialize` / `audit` / diff treat native and DOM trees identically.

  - New API: `BrowserSession.nativeTree(): Promise<ExtractionResult>` (added to the `A11ySession` interface), plus the standalone `nativeTree(page)` and the pure, unit-testable `buildNativeTree(rawNodes, enrichment?, chrome?)`.
  - **Read-only (Phase 1):** every node carries `a11y`, and a `dom` facet when a DOM node backs it; there is deliberately **no `interaction` facet** — CDP action dispatch is a later phase, and a read-only tree lies less by omitting it.
  - **Redaction is enforced by construction (RFC finding R1):** the producer never reads any element's live `.value`, drops the AX `value` field, and the `dom` facet copies only an allowlist of structural / accessibility attributes (never `value`). Proven by a test that builds the tree from a real recorded payload carrying real email/password secrets and asserts they appear nowhere in the output.
  - Enrichment is a single batched `DOM.getDocument` walk (RFC finding R3), not per-node round-trips.

- e2eca34: New package `@real-a11y-dev/browser` — the browser driver, extracted from `@real-a11y-dev/mcp` (the `BrowserSession`) and `@real-a11y-dev/testing` (the injected page-bundle and its IIFE build). It is the one place that touches Playwright: `BrowserSession` drives a real Chromium and injects the page-bundle that installs `window.__realA11y__`. Deps: `@real-a11y-dev/audit` + `@real-a11y-dev/serialize` + `@real-a11y-dev/core`, with an optional `playwright` peer.

  This completes the platform re-layering. The CLI, the MCP server, and the testing Playwright adapter now all drive the browser through this single package, so a tree captured by any of them is byte-for-byte identical — the bundle is built and resolved in exactly one place.

  - **`@real-a11y-dev/mcp`** imports `BrowserSession` from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/testing` dependency entirely** — the page-bundle was its last tie to the test-helper package. It also **removes the `./browser` subpath export**: import `BrowserSession` / `A11ySession` / `OpenOptions` / … from `@real-a11y-dev/browser` instead of `@real-a11y-dev/mcp/browser`.
  - **`@real-a11y-dev/cli`** imports the browser session from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/mcp` dependency** (it only wrapped mcp for the browser). Installing the CLI no longer pulls in the MCP SDK.
  - **`@real-a11y-dev/testing`** keeps its public API unchanged — `@real-a11y-dev/testing/playwright`'s `attach()` behaves identically. Internally its adapter now injects `@real-a11y-dev/browser`'s page-bundle (via the exported `PAGE_BUNDLE_PATH`) instead of building its own.

  Verified byte-for-byte against the CLI, MCP, and testing e2e suites.

- 0680dc9: Add **tree checkpoints** to the MCP server — the interaction diff. `checkpoint_tree` captures the current accessibility tree; after an interaction, `diff_tree` reports exactly which nodes were added, removed, or changed, plus where focus moved.

  Where the snapshot checkpoints answer _"what accessibility problems changed?"_, these answer _"what did that click change?"_ — making an interaction's effect legible: that opening a dialog added a `dialog` node **and** moved focus into it, or that a "Load more" button appended twelve links but left focus stranded.

  The captured tree lives **inside the page** — `@real-a11y-dev/browser`'s page-bundle gains `checkpointTree` / `diffSinceCheckpoint`, built on core's `diffTrees` and serialize's `serializeTreeDiff` — because node identities are realm-bound, so only the rendered diff ever crosses the boundary. That makes a tree checkpoint **page-instance-bound**: it is discarded on navigation, the deliberate asymmetry with snapshot checkpoints, which survive it. `diff_tree` re-extracts with the root the checkpoint was captured with unless you override it, so the comparison stays like-for-like.

### Patch Changes

- Updated dependencies [1d0eef0]
- Updated dependencies [7f93f92]
- Updated dependencies [6a658fe]
- Updated dependencies [beae032]
- Updated dependencies [cafe048]
- Updated dependencies [725fcc0]
- Updated dependencies [96cb0ee]
- Updated dependencies [f2532e5]
- Updated dependencies [ad8edc1]
- Updated dependencies [d657f66]
- Updated dependencies [1c8a523]
- Updated dependencies [d693a00]
- Updated dependencies [d693a00]
- Updated dependencies [907c68e]
- Updated dependencies [19e9fc2]
- Updated dependencies [a32632a]
- Updated dependencies [4fe0c7b]
- Updated dependencies [8c2a8fa]
- Updated dependencies [2915bc7]
- Updated dependencies [77b4bf2]
- Updated dependencies [22abf6b]
  - @real-a11y-dev/serialize@0.1.0-beta.11
  - @real-a11y-dev/core@0.1.0-beta.11
  - @real-a11y-dev/audit@0.1.0-beta.11
