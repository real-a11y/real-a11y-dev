# Spike report: native a11y tree via CDP → `ExtractionResult`

**Status:** Feasibility confirmed (with caveats) · **PR:** [#197](https://github.com/real-a11y/real-a11y-dev/pull/197) · **Code:** `packages/browser/spike/native-tree/`

Companion to [`native-tree.md`](./native-tree.md) and [`native-tree-v2.md`](./native-tree-v2.md). This spike runs Chromium, calls `Accessibility.getFullAXTree`, normalizes into today's `SemanticNode` / `ExtractionResult`, and checks the RFC's hard claims against a fixture (`video`/`audio` controls, password + email fields).

```bash
pnpm --filter @real-a11y-dev/browser run test:spike
pnpm --filter @real-a11y-dev/testing run test:spike
# optional raw CDP dump:
node --experimental-strip-types packages/browser/spike/native-tree/probe.mts
```

---

## Verdict

| Claim | Result |
|---|---|
| CDP exposes UA-shadow media controls the DOM producer cannot see | **Confirmed** |
| AX nodes can be normalized into something `serialize`-shaped | **Confirmed** (with fake `dom`/`interaction` placeholders) |
| `backendDOMNodeId` → `DOM.resolveNode` works for author DOM (id / tag enrichment) | **Confirmed** (after `DOM.getDocument`) |
| Native path needs redaction beyond “trust AX” | **Confirmed** — password AX value is masked; email AX `value` is plaintext; DOM enrich returns password plaintext |
| Today's required `dom` / `interaction` on `SemanticNode` is the wrong long-term shape | **Confirmed** — spike had to invent empty facets |

**Recommendation:** proceed with the v2 plan (AccNode + native producer in `@real-a11y-dev/browser`; `testing/playwright` consumes it). Read-path feasibility is confirmed for both producer and Playwright-adapter consumer. Action-dispatch (Phase 2) is still unproven and should be its own spike later. No separate `@real-a11y-dev/playwright` package is required.

---

## What we ran

Fixture (`spike/native-tree/fixture.html`): heading, paragraph, button, password input (`value="s3cret-value"`), email input, `<video controls>`, `<audio controls>`.

Normalized native tree (Chrome `147.0.7727.15`, representative run):

```
heading "Spike fixture" (level 1)
paragraph
button "Save"
video "Unable to play media."
  group "buffering"
  slider "video time scrubber"
  button "play"
  button "enter full screen"
  button "show more media controls"
  button "mute"
audio
  button "play"
  slider "audio time scrubber"
  slider "volume"
  button "mute"
textbox "Password"
textbox "Email"
```

Light DOM on the same page: `video.shadowRoot === null`, `childElementCount === 0` — controls are invisible to any in-page / jsdom walk. That is the forcing function from the RFC, reproduced mechanically.

---

## Findings (mapped to RFC risks)

### 1. Forcing function — media controls

`getFullAXTree` returns `Video` / `Audio` with descendants `button "play"`, `button "mute"`, `slider "video time scrubber"`, etc., nested under ignored/`none`/`generic` wrappers. Normalization that **drops ignored noise and re-parents** surviving children yields a usable tree. Child order after re-parenting is not guaranteed to match DevTools visual order — acceptable for audits; document if we ever assert order under media.

Load-state name `"Unable to play media."` appears when the media source is not playable — exactly the version/load drift called out in #197 §5.4. Normalization should canonicalize or strip load-state media names for baselines.

### 2. One model, two producers — shape pressure

`serializeTree` from `@real-a11y-dev/serialize` cannot be called from plain Node on an `ExtractionResult` today (`instanceof Element` throws when `Element` is undefined). The spike uses a tiny ExtractionResult-only serializer; product code should fix `toTree` to feature-detect `Element` (small cleanup, not a blocker).

More importantly: building a valid `SemanticNode` required **empty `dom` / `interaction` / `ui`** for pure AX nodes (UA controls often resolve poorly). That is live evidence for v2's optional facets — do not ship a native producer that lies with `tagName: ""` forever.

### 3. Stable ids / DOM enrichment

- Almost every AX node carries `backendDOMNodeId`.
- `DOM.pushNodesByBackendIdsToFrontend` requires `DOM.getDocument` first (probe initially failed without it).
- `DOM.resolveNode` + `Runtime.callFunctionOn` recovers `tagName` / `type` / `autocomplete` / `.value` for author-DOM nodes (`BUTTON`, `INPUT`, …).
- Some backend ids (UA-shadow internals) fail resolve — expected; those nodes stay AX-only (`ax-*` ids, no `dom` facet).

Id scheme used in the spike: `ax-dom-<backendDOMNodeId>` when present, else `ax-<nodeId>`. A production producer should prefer the shared DOM `id-generator` when resolve succeeds, so DOM↔native ids can align for the same element.

### 4. Redaction (ship gate)

| Source | Password field | Email field |
|---|---|---|
| AX `name` | `"Password "` (label) | `"Email "` |
| AX `value` | `••••••••••••` (masked by Chromium) | `user@example.com` (**plaintext**) |
| DOM enrich `.value` | `s3cret-value` (**plaintext**) | `user@example.com` |

So: **you cannot “just serialize AX” and assume secrets are safe.** Chromium masks password AX values, but (a) other fields' AX values are live user data, and (b) any DOM enrichment path sees password plaintext. Production native mode must apply the same sensitive-field policy as the DOM producer **before** returning the tree — and should generally **omit AX `value` from the canonical model** (or redact by field type), since serialize/audit today key off name/role, not raw value.

### 5. Vocabulary / noise

Roles seen: `Video`, `Audio`, `StaticText`, `InlineTextBox`, `none`, `generic`, plus normal ARIA roles. Spike maps `Video`→`video`, `Audio`→`audio`, drops `StaticText` / `InlineTextBox` / ignored / `none` / `RootWebArea`. This matches the RFC normalizer sketch and keeps output close to the DOM producer's printed vocabulary (#193 already moved DOM toward `video`/`audio`).

### 6. What this spike did **not** cover (at first)

Originally deferred: CDP **action dispatch**, root scoping, Chrome milestone drift, extension debugger, parity corpus.

**Spike 3 (below) closed the action-dispatch question.** Remaining: rootSelector / iframes, baseline pinning corpus, extension `chrome.debugger`.

---

## Spike 3 — CDP action dispatch (Phase 2)

**Code:** `packages/browser/spike/native-tree/dispatch.ts` + `dispatch.spike.test.ts`  
**Run:** `pnpm --filter @real-a11y-dev/browser run test:spike`

| Action | Target | Result |
|---|---|---|
| Click | Author-DOM `button "Save"` via `backendDOMNodeId` → `DOM.resolveNode` → `Runtime.callFunctionOn` → `element.click()` | **Works** — fixture click counter increments |
| Type | Author-DOM `textbox "Email"` — prototype `value` setter + `input`/`change` | **Works** — `#email` value updates |
| Click | UA-shadow `button "play"` (media control) | **Resolves and click() succeeds** — element is an `INPUT` inside `#document-fragment` (`inShadow: true`). CDP is privileged where page JS (`video.shadowRoot === null`) is not |

### Implications for the RFC

1. **Phase 2 ActionBackend is feasible** for author-DOM nodes with the same id-resolution path as enrichment (`backendDOMNodeId` → resolve → Runtime). No need for a wholly separate targeting scheme for the common case.
2. **Media UA controls are interactable over CDP**, not only readable — stronger than the original “read fidelity only” framing. Product priority can still be structure-first; dispatch to scrubber/play is optional polish, not a blocker.
3. Prefer `Runtime.callFunctionOn` for the first ActionBackend (mirrors today’s in-page dispatcher semantics). Keep `Input.dispatchMouseEvent` as a follow-up for pages that ignore programmatic `click()`.
4. Redaction still applies on any path that reads `.value` during enrich/type.

---

## Spike 4 — real-app HTML/ARIA corpus (not just media)

**Code:** `packages/browser/spike/native-tree/corpus/`  
**Run:** `pnpm --filter @real-a11y-dev/browser run test:spike`

Media proved *why* CDP exists. This spike asks whether native mode is credible on an **app-shell-shaped page**: landmarks, forms (text/email/password/radio/checkbox/select/textarea/number/range/file), lists, tables, images, `<details>`, `<dialog>`, ARIA tabs/switch/progressbar/alert, author open shadow DOM — plus video as one section among many.

### Method

1. Load `corpus/app-shell.html` in Chromium.
2. Serialize **native** (`nativeTreeFromPage`) and **DOM** (page-bundle `auditSnapshot`) with the dialog closed.
3. Diff role+name **multisets** (order-insensitive) — `parity.ts`.
4. Separately open `<dialog>` and confirm both producers scope to the modal (inert background).

### Results (Chrome 147, representative)

| Metric | Value |
|---|---|
| DOM pairs | 71 |
| Native pairs | 76 |
| Shared | 63 |
| **Overlap vs DOM** | **~89%** |

Native still uniquely adds media UA controls (`button "play"`, scrubber, …) — forcing function intact. Author shadow button `"Shadow action"` appears on the native side.

### Real asymmetries the corpus surfaces (normalizer work, not blockers)

| Pattern | DOM producer | Native (after spike normalizer) | Takeaway |
|---|---|---|---|
| List item names | `listitem "Alpha"` | Needs StaticText→parent name promotion (now in spike) | Dropping `StaticText` without promoting names loses content |
| List markers | (folded into name) | `ListMarker` noise | Drop in normalizer |
| `<form>` | `form` | Often absent as a role | Vocabulary — don't require byte-identical structure |
| `<input type=file>` | `textbox "Attach"` | `button "Attach"` | Map/canonicalize |
| `<details>` | `group "Advanced"` | `DisclosureTriangle "Advanced"` | Map to disclosure/group |
| Table caption | `table` + `caption "…"` | `table "Team roster"` | Name placement differs |
| Open `<dialog>` | Tree collapses to dialog | Same | **Both** honor modality — capture corpus with dialog closed |

### Opinion for the RFC

- **Yes — native must be validated on a real-app corpus, not only media.** Spike 4 is that gate; ~89% role+name overlap on a dense app shell is strong evidence the producer is generally usable.
- **Do not expect 100% pair equality.** Chromium vocabulary (`DisclosureTriangle`, `menulistpopup`, file-as-button) and name placement differ. Production success = aggressive normalization + mode-stamped baselines + parity CI on this corpus (and more fixtures), not identical trees.
- **Live sites (GitHub, etc.)** are useful smoke tests later; fixtures are the CI contract (stable, offline, intentional coverage).
- Remaining gaps to grow the corpus: iframes, portals/React modals, virtualized lists, canvas, SVG icons, contenteditable surfaces.

---

## Spike 5 — extension `chrome.debugger` native mode

**Code:** `packages/extension/spike/debugger-native/` · **Run:** `pnpm --filter @real-a11y-dev/semantic-navigator-extension run test:spike`

Tests the ordering question raised against v3 ("why a desktop app — why not the extension with native tree?"). A minimal MV3 test extension attaches `chrome.debugger` from its service worker; the Playwright test loads it into full Chromium (new headless via the `chromium` channel — extensions don't load in the headless shell) and drives the worker with `serviceWorker.evaluate`.

| Claim | Result |
|---|---|
| SW reads `getFullAXTree` over `chrome.debugger` — UA-shadow media controls included | **Confirmed** — `video` with `button "play"`, scrubber, mute, visible from the extension |
| Tree-dispatch over `chrome.debugger` (`backendDOMNodeId` → resolve → `callFunctionOn`) | **Confirmed** — counter task completed in one attached session; `role=status` update read back through the tree |
| "Third CDP transport" cost | **Avoidable by construction** — `native-core.ts` targets a 1-method `CdpTransport`; the *same module* over `chrome.debugger.sendCommand` and Playwright `CDPSession` produced **byte-identical** serialized trees |
| Debugger exclusivity | **Confirmed** — second attach: `"Another debugger is already attached to the tab with id: …"` (the DevTools-conflict class). Playwright's pipe-level client coexisted fine — exclusivity is among debugger-class clients per tab, not all CDP consumers |
| §5.4 name drift | Reproduces here: authored `aria-label` replaced by `"Unable to play media."` on unplayable source |

**Not answered (dogfood gates, not feasibility gates):** banner UX during deliberate audit sessions (invisible headless), MV3 service-worker suspension across long sessions (test is seconds), real-world DevTools-conflict frequency.

**Consequence:** extension-native moves from "Phase 6, with demand" to a Phase-1-adjacent product decision; the Electron desktop shell is gated on its outcome. Recorded in `native-tree-v3.md` (revision note).

---

## Playwright adapter consumer spike

**Code:** `packages/testing/spike/playwright-native/` · **Run:** `pnpm --filter @real-a11y-dev/testing run test:spike`

v2 clarifies that `#197`'s "testing stays DOM" means **jsdom**, not `testing/playwright`. This spike proves the adapter can consume native without a new package:

| `attachSpike({ tree })` | Result on the media fixture |
|---|---|
| `"native"` (CDP via `nativeTreeFromPage`) | `video` with `button "play"`, scrubber, mute, … |
| `"dom"` (today's page-bundle `attach()`) | `video` / `audio` as **leaves** — no UA controls |

Same handle shape (`auditSnapshot()`); different producer. Product API target: `attach(page, { tree: "native" | "dom" })` calling `browser.nativeTree(page)` — **not** `@real-a11y-dev/playwright`.

---

## Code layout (throwaway-friendly)

```
packages/browser/spike/native-tree/
  fixture.html
  normalize.ts
  from-page.ts
  dispatch.ts / dispatch.spike.test.ts
  native-tree.spike.test.ts
  probe.mts
  corpus/
    app-shell.html             # real-app HTML/ARIA patterns
    parity.ts                  # role+name multiset diff
    corpus.spike.test.ts       # DOM↔native overlap + modality
packages/testing/spike/playwright-native/
  attach-native.ts
  playwright-native.spike.test.ts
packages/extension/spike/debugger-native/
  native-core.ts               # transport-agnostic read/normalize/click
  sw.ts                        # chrome.debugger plumbing (MV3 service worker)
  manifest.json / fixture.html
  debugger-native.spike.test.ts
```

`pnpm test:spike` is **opt-in** — not part of default `vitest` / `pnpm verify`. Keep it that way until the producer graduates out of `spike/`.

---

## Decisions this spike supports

1. **Proceed** with native producer in `@real-a11y-dev/browser` (read path is feasible).
2. **Break** `SemanticNode` toward optional `dom` / `interaction` (v2) — spike had to fake them.
3. **Treat redaction as a Phase-1 ship gate**, including AX `value` and DOM enrich.
4. **Wire `testing/playwright` as a consumer** of `browser.nativeTree` (`attach({ tree })`) — not a second producer, not a new package.
5. **Phase 2 ActionBackend is feasible** via CDP resolve + `Runtime.callFunctionOn` for author-DOM; UA media controls are also reachable over CDP (privileged), unlike in-page.
6. **Require a real-app corpus parity harness** (Spike 4) before defaulting cli/mcp/testing/playwright to native — media-only spikes are necessary but not sufficient. ~89% role+name overlap on an app shell is the bar to beat and improve via normalization.
7. **Fix** `serialize`'s `instanceof Element` guard so Node consumers can serialize an `ExtractionResult` without jsdom (small follow-up).

---

*Chrome under test: Playwright Chromium `147.0.7727.15` (headless shell). Re-run `test:spike` after Chrome bumps to refresh the sample tree.*
