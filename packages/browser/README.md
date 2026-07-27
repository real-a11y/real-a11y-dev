# @real-a11y-dev/browser

Drive a real browser for Real A11y. This package is the **one way** the toolkit extracts an accessibility tree from a live Chromium — a Playwright-based `BrowserSession` plus the pre-built page-bundle it injects. The CLI and the MCP server both drive the browser through it.

```sh
npm install @real-a11y-dev/browser
# a real browser is required:
npm install playwright   # optional peer
```

Why a real browser and not jsdom? The extraction engine relies on `getComputedStyle` and layout to decide what is actually exposed to assistive tech — visibility, focusability, computed roles. A server-side jsdom can't reproduce that faithfully, so an audit that matters needs a real Chromium.

## `BrowserSession`

```ts
import { BrowserSession } from "@real-a11y-dev/browser";

const session = new BrowserSession({ headless: true });
await session.open("https://example.com");

const snapshot = await session.snapshot();
// { findings, tree, outline, tabOrder }

await session.close();
```

`BrowserSession` launches Chromium with Playwright, injects the page-bundle (which sets `window.__realA11y__`), and routes every query through `page.evaluate()`. `playwright` is an **optional peer dependency**, imported lazily — importing this package never forces playwright to load, so browser-free code paths stay light.

### Launching a specific Chrome binary

`BrowserSessionOptions.executablePath` launches a given browser binary instead of Playwright's bundled Chromium (ignored when `cdpEndpoint` is set — an already-running browser is the browser):

```ts
const session = new BrowserSession({ executablePath: "/path/to/chrome" });
```

This package also exports the read side of the contract the CLI's `real-a11y install` writes to (see `@real-a11y-dev/cli`): `resolveChromeExecutable({ explicitPath?, env? })` returns `{ executablePath, source }` by checking, in order, an explicit path, the `REAL_A11Y_CHROME_PATH` env var, then the `install` cache manifest (`chromeCacheDir()` / `readChromeManifest()`) — or `undefined` if nothing is configured, so the caller falls back to Playwright's own Chromium. Never throws for the soft (manifest) case; throws for an explicit path or env var that doesn't exist on disk.

## The native producer — `nativeTree()`

Everything above uses the **DOM producer**: the page-bundle walks the light DOM in-page. This package also hosts the **native producer**, which reads Chromium's own accessibility tree over CDP and normalizes it into the *same* `ExtractionResult` model — one canonical model, two producers.

```ts
const tree = await session.nativeTree();
// ExtractionResult with source.producer === "native"
// — feed it to serialize / audit / diff exactly like a DOM tree
```

Why a second producer: Chromium exposes structure no in-page walk can reach — most visibly a `<video controls>`'s play/scrubber/mute controls, which live in a closed user-agent shadow root. The vocabulary (which nodes survive, sibling order, role map, name promotion) comes from core's shared `normalizeNativeAX`, so native and DOM trees are directly comparable.

The **read** side is redaction-safe by construction — the producer never reads any element's live `.value`, drops the AX `value` field, and the `dom` facet copies only an allowlist of structural / accessibility attributes, so a user's field values never enter the tree. Nodes carry `a11y`, and a `dom` facet when a DOM node backs them. `buildNativeTree(rawNodes, enrichment?, chrome?)` is exported as the pure, browserless core of the producer.

The `dom` facet also carries a **CSS locator**, so a native finding says *where*. The DOM producer derives one on demand from the live element it still holds; the native producer runs in Node with nothing but a CDP snapshot, so it computes the path during the single `DOM.getDocument` walk it already makes — the parent and sibling links exist there and nowhere else. Both use the same builder (`buildCssPath` from `@real-a11y-dev/core`) against their own node shape, so `#panel > div > img:nth-of-type(2)` means the same thing whichever producer found the problem. Without it a native `audit` reported real defects with no address at all.

One case has no honest answer, and is treated as one: this walk pierces shadow roots and the in-page walk doesn't, so native alone reaches elements with no whole-document selector. Their path stops at the boundary — `button:nth-of-type(2)`, not a `#document-fragment > button` that would look queryable and match nothing.

### Acting on the native tree — `session.act()`

The native tree is no longer read-only: `session.act(request)` dispatches a **click**, **type**, or **focus** against a node, over CDP. It works because every native node id encodes its Chromium `backendDOMNodeId` (`ax-dom-<n>`): `act` parses the id, resolves it back to the live DOM element (`DOM.resolveNode`), and dispatches (`Runtime.callFunctionOn`).

What gets dispatched matters as much as where. The in-page functions (`src/page-actions.ts`) mirror the dispatcher `@real-a11y-dev/core` uses in the extension and Storybook panel, because real pages need all of it:

- **click** fires the full `pointerdown → mousedown → pointerup → mouseup → click` sequence, not `element.click()` — jsaction / Material-ripple handlers gate on the sequence and ignore a bare click. A click on a composite-widget wrapper (`treeitem`, `menuitem`, `option`, `tab`, `row`, …) is redirected to the interactive descendant that owns the handler, since a delegated `event.target.closest(…)` walk goes *upward* and would otherwise miss it.
- **type** writes through the element's own prototype value setter plus `input`/`change`, so framework-controlled inputs (React et al.) see it. On a contenteditable it fires a cancelable `beforeinput` first and only writes `textContent` when nothing handled it — model-driven editors (ProseMirror, Lexical, Draft) insert from `beforeinput` into their own document model and would revert a raw write.
- **focus** reports whether the target actually accepts text entry (an allow-list of input types), so a caller knows whether a `type` can follow.

These functions are serialized to the page as source text, so each is written self-contained — see the module docstring for that constraint, and `page-actions.test.ts` for the parity tests that hold them level with core.

```ts
const tree = await session.nativeTree();
const button = [...tree.nodes.values()].find(
  (n) => n.a11y.role === "button" && n.a11y.name === "Save",
);
await session.act({ nodeId: button.id, action: "click" });
// → { success: true }
```

`session.currentUrl()` returns where the page is **now** — a click can navigate, so the URL `open()` returned goes stale the moment a step follows a link or submits a form. It returns `undefined` when no page is open.

The write path holds the same redaction discipline as the read path: an `ActionResult` **never** carries the value typed into a field or any of the field's content — the in-page function returns only a structural marker, and errors are content-free. A node with no backing DOM element (`ax-<n>` — a synthesized document root) is refused rather than guessed at. `CdpActionBackend` and `backendNodeIdFrom` are exported for callers that hold their own CDP session.

### Parity harness

`pnpm --filter @real-a11y-dev/browser test:e2e` runs the two producers against a corpus of fixture pages in real Chromium and measures how much of the DOM tree the native tree covers (role+name overlap). Because the two are never byte-identical — Chromium vocabulary differences, plus the UA-shadow media controls only native sees — the harness asserts an overlap **floor** and logs the actual watermark, rather than equality. It runs as an **advisory** CI step for now (see `e2e/native-parity.e2e.test.ts`); divergences are a two-way signal that catch DOM-producer gaps *and* native-normalizer regressions.

## The page-bundle

The injected bundle is built here (`dist/page-bundle.iife.global.js`) from the serializers (`@real-a11y-dev/serialize`), the findings engine (`@real-a11y-dev/audit`), and the query helpers (`@real-a11y-dev/core`). It's an IIFE that installs `window.__realA11y__` with the snapshot/assertion helpers so any caller can invoke them by name inside the page.

Because the bundle ships in this package, both drivers resolve the exact same file:

- `BrowserSession` reads it from its own `dist/`.
- The `@real-a11y-dev/testing/playwright` adapter imports the exported `PAGE_BUNDLE_PATH` and injects the same bundle.

One bundle, one home — so a tree captured through the CLI, the MCP server, or the Playwright adapter is identical.

## Design

This package is **the only place that touches Playwright**. Everything above it in the stack is a pure, browserless engine (`core` extraction, `serialize` text, `audit` findings, `snapshot` diffs); everything that needs a live page — the CLI, the MCP server, the testing Playwright adapter — composes `browser`. Isolating the real-browser concern here means a consumer that only needs the engine never pulls Playwright into its dependency graph.
