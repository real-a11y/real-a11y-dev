# @real-a11y-dev/browser

## 0.1.0-beta.12

### Minor Changes

- 37f5859: `BrowserSession` page-state queries are now close-aware.

  `hasPage()` returns `false` once the tab has been closed, not just when no page was ever opened. `currentUrl()` and `currentEmulationKey()` route through it, so a closed tab reads as "no page" (`undefined` / `""`) instead of handing back the dead page's last URL or emulation signature. The internal page guard likewise throws "No page is open" for a closed page rather than returning a handle every operation on which would fail.

  This changes behavior for consumers that relied on `currentUrl()` surviving a page close (e.g. recording a final URL after a navigation that closed the tab) — read the URL before closing, or fall back to the URL you navigated to, as the MCP server does. The motivation is session reuse: a daemon that reuses a `BrowserSession` across runs must treat a closed tab as "open a fresh page", never as a live page to act on.

- 37f5859: `BrowserSession.currentEmulationKey()` — expose the current viewport/device emulation signature.

  `BrowserSession.currentUrl()` was already used to decide whether a reused session page matched a new target. `currentEmulationKey()` extends that with the resolved emulation state, so a caller can detect when a command with different `--viewport` / `--device` / `--color-scheme` / `--reduced-motion` flags needs a fresh context instead of silently reusing the wrong one.

  Returns `""` when no page is open. Like `currentUrl()`, it is not queued and reads cached state.

- 4e3c10a: `BrowserSession.currentUrl()` — where the page is **now**, which isn't necessarily where `open()` put it.

  A dispatched action can navigate (a click on a link or a submit button), so a caller that reports a URL after acting has to re-read it or it reports the address the run started from. `open()`'s return value is a snapshot of that moment and goes stale the instant a step navigates.

  ```ts
  const opened = await session.open(url);
  await session.act({ nodeId, action: "click" }); // may navigate
  session.currentUrl(); // where it actually ended up
  ```

  Returns `undefined` when no page is open. Not queued — it reads Playwright's cached location rather than touching the page, so it can't race the session's single-flight chain.

- b2ccee0: refactor(browser)!: drop `listByRole` from the injected page bundle

  **Potentially breaking for a caller that evaluates the IIFE directly.**
  `window.__realA11y__.listByRole(root, filter)` no longer exists. Everything
  routed through `BrowserSession` or `@real-a11y-dev/testing/playwright` is
  unaffected — neither ever called it. If you do call it in-page, import it from
  `@real-a11y-dev/audit` (or `@real-a11y-dev/testing`, which re-exports it) and run
  it in Node over an `ExtractionResult`, which is what both of our own surfaces now
  do.

  It had no in-page caller at all. Since the producer migration, `real-a11y list`
  and the MCP's `list_elements` both run the category listing in Node over
  Chromium's own tree; the only bundle exports the CLI and MCP still dispatch on
  are `checkpointTree` and `diffSinceCheckpoint`. So the listing — and, after the
  last release, its explanatory empty-category text — was injected into every
  audited page for nobody.

  Removing it takes the bundle from **9.96 kB → 9.59 kB** gzipped, which puts it
  back under the **10 KB** budget. The limit had been raised to 11 KB one release
  earlier purely to fit that text; this reverts it, so the budget is a real
  constraint again rather than a number that moves whenever it binds.

  Scope was decided by measurement, not instinct. Six other exports have no caller
  in this repo either (`findByRole`, `findAllByRole`, `getOutline`,
  `getTabSequence`, `linearize`, `A11yAssertionError`) — dropping all of them saved
  a further **0.07 kB**, because what stays pulls them in anyway. Seven breaking
  removals for 0.07 kB is a bad trade, so they stay.

  Also adds `src/page-bundle.test.ts`, which pins the bundle's exports against the
  consumer that names each one. Nothing described that surface before, which is how
  a dead export survived a migration: the names are resolved dynamically at both
  call sites (`ra[fn]`), so nothing typed connected them.

- 37f5859: `BrowserSession.open` gains `OpenOptions.allowedOrigins` for per-call origin pinning.

  `assertAllowedOrigin` is now public so the session daemon (and other callers) can reuse the same origin-gating logic. A non-empty per-call allowlist is intersected with the session-level list, so a single call cannot widen a pinned session's origins; an empty or absent per-call value falls back to the session-level list.

- 823d1cc: `real-a11y install` — download Chrome from Chrome for Testing (first time only), and use it for every launched session from then on:

  ```sh
  real-a11y install                           # latest Stable
  real-a11y install --channel beta            # track a channel
  real-a11y install --version 131.0.6778.87   # pin an exact build
  ```

  This replaces the `npx playwright install chromium` step (still supported) with a browser download that's independent of the Playwright package version — no more "Executable doesn't exist" from a global/local Playwright revision mismatch. Playwright remains the driver; only the browser binary changes.

  The CLI's browser-driving commands gain `--chrome-path <file>` to launch a specific binary (ignored with `--cdp`). Resolution precedence, shared by the CLI and the MCP server: `--chrome-path` > `REAL_A11Y_CHROME_PATH` env > the `real-a11y install` cache > Playwright's own bundled Chromium.

  `@real-a11y-dev/browser` gains `executablePath` on `BrowserSessionOptions`, plus `resolveChromeExecutable`/`readChromeManifest`/`chromeCacheDir` for anyone building their own installer or launch wiring. The MCP server picks up `REAL_A11Y_CHROME_PATH` and `REAL_A11Y_BROWSERS_DIR` the same way.

- 135ccc3: Add **act tools** to the MCP server — `click_element`, `type_text`, and `focus_element` — closing the `checkpoint_tree` → interact → `diff_tree` loop an agent previously couldn't complete alone. Each dispatches a real action over CDP through `A11ySession.act()`, the write side the native producer shipped and nothing drove.

  Targeting is deliberately **role + accessible name** (plus a 1-based `nth` for duplicates), never a CSS selector or node id. `@real-a11y-dev/browser` gains `resolveTarget`, which resolves the query against a **fresh** native tree immediately before each dispatch — node ids stay internal (the serializer invariant holds), staleness shrinks to the instant between resolve and act, and a control that role + name can't reach is surfaced as what it is: an accessibility finding, not a targeting inconvenience. Ambiguity errors list the candidates as copy-paste `nth=` lines; disabled targets are refused with the cause rather than clicked into a void.

  The R1 redaction discipline extends to the new write path's results: `type_text` never echoes the typed value — in success or failure — and backend CDP errors stay content-free.

- 43f085c: fix(mcp): a checkpoint diff across two different pages no longer dumps a structural summary

  Checkpoints deliberately survive navigation, which makes it easy to check one
  route and diff another — and the advisory structural summary then reports the
  whole page as rewritten. Hundreds of added and removed headings, landmarks and
  tab stops, none of which is a regression.

  `diff_findings` and `diff_checkpoints` now compare the two sides' addresses. When
  they are different pages, both name the two URLs and drop that section; findings
  still diff normally, since a `v1:` fingerprint keys on rule + role + locator, not
  on position.

  "Different page" means the path, query or fragment differs — **host, port and
  scheme are ignored on purpose**. Diffing prod against a preview is the headline
  workflow for these tools, and there the structural summary is the whole point.
  An unparseable address is never treated as a mismatch: dropping a section on a
  guess is worse than printing a noisy one.

  A checkpoint also now records where the page **is**, not where `open_page` landed.
  `click_element` can navigate, so those are different addresses — and recording
  the stale one left a diff across two genuinely different pages looking like one
  page twice. `A11ySession` gained `currentUrl()` (already on `BrowserSession`) so
  a consumer holding the interface can read it at extraction time.

- b304069: Findings from the native producer now say **where**.

  `audit` is rule · severity · locator, but `--producer native` (and MCP `producer: "native"`) reported every finding with no locator at all — a real defect with no address. The DOM producer derives the locator from a live `Element` it holds in an in-page map; the native producer runs in Node over a CDP snapshot and has no such element, so nothing was left to derive from.

  The path is now computed during the `DOM.getDocument` walk the native producer already makes — the only place it ever sees parent and sibling links, and free, since that walk was happening anyway. Both producers share one builder (`buildCssPath`, exported from `@real-a11y-dev/core` with `CssPathAdapter` and `DOM_ELEMENT_ADAPTER`), each supplying accessors for its own node shape, so `#panel > div > img:nth-of-type(2)` means the same thing whichever producer found the problem. `SemanticNode["dom"]` gains an optional `locator` to carry it. `list_elements` / `listByRole` gain native locators for the same reason, and the docs that said native had none are corrected.

  ```
  # before                          # after
  image-alt   locator: (none)       image-alt   locator: body > main > img
  image-alt   locator: (none)       image-alt   locator: #panel > div > img
  ```

  One case has no honest answer and is treated as one: the native walk pierces shadow roots and the in-page walk doesn't, so native alone reaches elements with no whole-document selector. Those paths stop at the boundary — `button:nth-of-type(2)`, not a `#document-fragment > button` that would look queryable and match nothing.

  **Native snapshots taken before this will not diff cleanly against ones taken after.** A finding's fingerprint includes its locator, so native findings that previously fingerprinted with an empty anchor now fingerprint with a real one: `real-a11y diff` will read a re-run of an unchanged page as every finding fixed and re-introduced. Re-baseline native artifacts once. DOM-producer artifacts are unaffected — their locators never changed.

- 0a41085: A Node-side tree checkpoint against the native producer — so acting and reporting finally speak the same language.

  `captureNativeCheckpoint(tree, url)` holds a native tree in Node; `diffNativeCheckpoint(checkpoint, after, afterUrl)` renders what changed. Both are pure, so the policy is unit-testable with no browser.

  The in-page checkpoint (`checkpointTree` / `diffSinceCheckpoint`, which `@real-a11y-dev/testing` still uses) is keyed by realm-bound WeakMap ids, so it dies with the page instance — and it diffs the **DOM** producer's tree while acting targets the **native** one. A user clicks `button "Attach"` and reads a diff in which that node is `textbox "Attach"`. Same element, two vocabularies. Holding the checkpoint here, against the same tree the targeting uses, removes that seam.

  **Detecting that the document was replaced** is the load-bearing part: a navigation makes the two trees' ids incomparable, and diffing anyway reports the whole page removed and a new one added. The obvious detector — comparing URLs — is wrong. Measured in real Chromium:

  | scenario               | shared ids | url changed | correct verdict |
  | ---------------------- | ---------- | ----------- | --------------- |
  | same-document mutation | 100%       | no          | diff            |
  | SPA `pushState`        | 14%        | **yes**     | **diff**        |
  | hash change            | 100%       | **yes**     | **diff**        |
  | reload (same URL)      | **0%**     | no          | **replaced**    |
  | real navigation        | 0%         | yes         | replaced        |

  A URL check gets three of five wrong — it suppresses the diff for a hash change and an SPA route change, where the document survived and the diff is exactly what was asked for, and it emits a garbage diff for a reload. Shared node ids get all five right, and not as a tuned threshold: a replaced document means Chromium allocates every `backendDOMNodeId` afresh, so the overlap is _exactly_ zero, while any same-document change keeps at least one element.

  Only **backend-derived** ids count. `buildNativeTree` also mints `ax-root` for the synthesized root it adds to any page with more than one top-level node — the ordinary `<header>`/`<main>`/`<footer>` shape — and that id is a constant, so two unrelated documents both carry it; counting it would make a navigation between two normal pages read as an in-place change. (`ax-<axNodeId>` collides across documents for the same reason.) A tree with no backend-derived ids reports "not replaced" rather than guessing.

  `documentWasReplaced` is exported for callers that want the signal alone; all five scenarios are pinned against real Chromium, on deliberately multi-rooted fixtures.

  Also: a native `ExtractionResult` now sets **`focusedId`**, promoted from Chromium's per-node `focused` AX property. Every focus-aware consumer reads the tree-level pointer — `serializeTree`'s `[focused]` marker and `serializeTreeDiff`'s focus-move line both resolve nodes through it — so without this a native tree knew where focus was and couldn't say so, and a `focus` action diffed to a bare `a11y.states.focused` flip instead of a focus move. When only the document is focused (nothing in the page is), it stays unset rather than naming a node the normalizer dropped.

- a4cfac8: Tab-order serialization is now number-free by default; numbering moves to a render-time step.

  `serializeTabSequence` used to render `01. link "Home"` / `02. button "Go"`. Inserting one focusable element near the top of the page renumbered every following line, so a committed snapshot's diff — and the reviewable unified-diff hunk of `real-a11y diff` — churned the whole view instead of showing the one inserted stop. Line order already conveys the sequence, so the serialized form is now just `link "Home"` / `button "Go"`: the canonical, diff-stable output you store and compare.

  For a human- or agent-read listing where an explicit "stop 7" helps, a new `numberTabStops(tabs)` export re-adds the `NN. ` prefix at **render time** (never stored):

  ```ts
  import {
    serializeTabSequence,
    numberTabStops,
  } from "@real-a11y-dev/serialize";
  numberTabStops(serializeTabSequence(root)); // 01. link "Home"  02. button "Go"
  ```

  Numbering is applied where output is read, not diffed: the CLI `tabs` terminal view, the MCP `get_tab_order` and `inspect_page` tools, and the extension's Markdown export (which stays numbered, matching its on-screen panel). It is absent where output is committed or diffed: `tabSequenceSnapshot()` in `@real-a11y-dev/testing`, the CLI `snapshot`/`inspect` artifacts and JSON, and the browser audit's `tabOrder`. (Also fixes an MCP snapshot summary that reported "0 tab stops" once lines were unnumbered.)

  **Breaking change.** Any committed snapshot of a tab sequence (vitest/jest `toMatchSnapshot`, an inline snapshot, or a golden file / CI artifact) will differ by the removed `NN. ` prefix on every line.

  **Migration.** Either re-generate the affected snapshots (`vitest -u`, `jest -u`, or re-capture the golden file), or wrap the value for display: `numberTabStops(tabSequenceSnapshot(root))`.

  Structural diffing tolerates the transition: `real-a11y diff` still strips leading `NN. ` numbers before comparing, so a base captured by an older numbered tool version diffs cleanly in findings, the multiset view, and the plain-language statements. The one exception is the tabs **hunk** view — a legacy numbered base shows a one-time full rewrite there until it is re-captured. That output is advisory and never gates.

### Patch Changes

- bbbcb04: `CdpActionBackend`: fix three cases where an action reported success but the page never reacted. The CDP write path was implemented independently of the in-page dispatcher `@real-a11y-dev/core` has used for a while in the extension and Storybook panel, and it was missing the hardening that dispatcher earned from real pages. Because a swallowed action still returns `{ success: true }`, the failure was silent: the MCP `click_element` / `type_text` tools reported success and the follow-up `diff_tree` read "(no changes)", which an agent takes as "the click did nothing" rather than "the click missed".

  - **click** dispatched `element.click()`, which fires `click` alone. Handlers that gate on a pointer sequence (jsaction, Material ripple) never ran. It now fires the full `pointerdown → mousedown → pointerup → mouseup → click`.
  - **click on a composite-widget wrapper** (`treeitem`, `menuitem`, `option`, `tab`, `row`, `gridcell`, `cell`) landed on the wrapper, so a delegated `event.target.closest(…)` handler walked upward, away from the descendant that owns the behavior, and no-op'd. The click is now redirected to that descendant, matching core.
  - **type into a contenteditable** wrote `textContent` unconditionally. Model-driven editors (ProseMirror, Lexical, Draft) insert into their own document model from `beforeinput` and then re-render, reverting the write — so the text landed and vanished. It now fires a cancelable `beforeinput` first and writes only when nothing handled it.

  `focus` also stops reporting `<input type="image">` (and any input type added in future) as a text field: the text-entry check was a deny-list and is now the same allow-list core uses.

  The code that runs in the page moves to `src/page-actions.ts`, serialized to CDP as source text — which is why those functions are written self-contained rather than sharing helpers. Parity tests run them and core's `ActionDispatcher` over identical fixtures and compare the observable result, so the two can't drift apart unnoticed. Two divergences are deliberate and documented: failures never carry page text (R1), and `focus` reports the field's real `type` where core always says `"text"`.

- Updated dependencies [e4e9c89]
- Updated dependencies [cd20458]
- Updated dependencies [229c5ac]
- Updated dependencies [c15960d]
- Updated dependencies [6785622]
- Updated dependencies [4aa1036]
- Updated dependencies [b304069]
- Updated dependencies [2f2ab7b]
- Updated dependencies [1ef740a]
- Updated dependencies [3b4967b]
- Updated dependencies [4d982ce]
- Updated dependencies [a4cfac8]
- Updated dependencies [3ab20f2]
  - @real-a11y-dev/core@0.1.0-beta.12
  - @real-a11y-dev/audit@0.1.0-beta.12
  - @real-a11y-dev/serialize@0.1.0-beta.12

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
