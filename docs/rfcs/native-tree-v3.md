# RFC v3: The unified architecture — one model, two producers, five surfaces, one desktop

**Status:** Draft for discussion · **Supersedes nothing — completes:** [`native-tree.md`](./native-tree.md) (v1, the framing) + [`native-tree-v2.md`](./native-tree-v2.md) (the model break) + [`native-tree-spike.md`](./native-tree-spike.md) (the evidence) · **Stage:** Beta (breaking changes acceptable)

## What v3 adds

1. An **independent verification pass** over the v2 spikes (re-run in a second environment, on a *different* Chromium build) — plus six review findings that sharpen the plan before code graduates out of `spike/`.
2. The **Desktop Semantic Navigator** ("the tree *is* the interface") designed into the architecture as a first-class surface — not a bolt-on. Its engine is the same `A11ySession` the CLI and MCP already share; the desktop app is a *frontend*, not a fourth extraction path.
3. The **complete per-tool decision table** — every package in the workspace, what it consumes, what changes, what never changes.

v1 answered *"native vs custom?"* (neither — one model, two producers). v2 answered *"what shape must the model be?"* (accessibility-first, optional facets). v3 answers *"how does the whole product line sit on top?"*

> **Revision 1 (Spike 5).** The first draft parked extension-native at "Phase 6, only with demand," weighting the debugger banner heavily. Challenged in review ("why a desktop app — why not the extension with native tree?"), we spiked it: `packages/extension/spike/debugger-native/` proves an MV3 service worker reads the full native tree (UA-shadow controls included) **and dispatches through it** over `chrome.debugger`, and that the same transport-agnostic module runs byte-identically over `chrome.debugger.sendCommand` and Playwright's `CDPSession` — killing the "third transport" cost by construction. Feasibility is settled; what remains are dogfood questions (banner tolerance in deliberate sessions, MV3 suspension across long sessions, real DevTools-conflict frequency). **Consequence:** extension-native is promoted to a Phase-1-adjacent product decision, and the Electron shell (§4.5 step 2) is *gated on its outcome* — if extension-native dogfoods well and users don't need owned/recordable sessions, Electron never gets built; `real-a11y navigate` (§4.5 step 1) remains the thin bet either way. Sections below are annotated where this changes them.

> **Revision 2 (after Phase 1+2 shipped — scope discipline).** With A–G merged (native read + `A11ySession.act()`) and the read producer live across testing/cli/mcp, three course corrections landed in review, tightening the product surface:
>
> 1. **Two *co-equal* producers — no blanket default flip.** The DOM and native producers are different tools, not better/worse: DOM keeps `rootSelector` scoping, tab order, and the jsdom/in-page path; native adds UA-shadow fidelity but is whole-document, tab-order-less, and Chromium-only. Flipping every default to native and demoting `--producer dom` to an "escape hatch" (v2 Q3 / §5 Phase 3) would make scoping + tab order + the testing path silently second-class. **Decision: keep both first-class; default stays `dom` (universal, fully-featured); `native` is an explicit opt-in for fidelity.** The only candidate for a native *default* is the **`audit` command specifically** (fidelity = correctness there) — reconsidered later, per-command, gated on the parity harness, never a blanket flip. **This retires Phase 3 (I₁/I₂/I₃) as "flip + demote."**
> 2. **The Desktop track closes.** Spike 5 showed the *extension* can read + dispatch the native tree, so once extension-native ships (PR H) it owns the "tree *is* the interface" product at full fidelity, in any tab, zero install — the Electron shell's only remaining edge (owned/recordable sessions) is speculative. **Decision: drop the Electron shell (§4.5 step 2) outright; `real-a11y navigate` (§4.5 step 1 / PR J) is deferred, not deleted** — build it only if the "watch/record an agent complete a task through the tree" use case shows real demand, and even then only the CLI command, never Electron.
> 3. **The MCP stays audit-first — it is not a browser-automation server (answers Q8).** Exposing `open_page + tree + click + type` is, in *shape*, Playwright MCP. Our differentiation is that interaction serves **accessibility auditing**, not automation: findings, the `compare_producers` fidelity oracle, checkpoint/diff over `v1:` fingerprints, redaction as a ship gate. **Decision: if `act` lands in MCP, it is scoped to *interaction-driven re-audit* — "change state, then re-audit / `diff_tree` the result" (what did that click change for a screen reader?)** — pairing with the existing `checkpoint_tree`→`diff_tree`. It is **not** a general open+click+type+snapshot automation surface; that lane belongs to Playwright MCP and we don't compete there. The "eyes-closed" *product* lives in the CLI `navigate` panel and the extension curtain, never as a pile of automation tools in the MCP.

---

## 1. Spike review — verified, with findings

The full spike suite was re-run from scratch in a clean environment: **25/25 tests pass** (`browser` 21, `testing` 4). Corpus parity reproduced **exactly** — 71 DOM pairs / 76 native / 63 shared = **88.7% overlap** — on a *different Chromium build* than the report's Chrome 147. Same drop-list, same asymmetries (`disclosuretriangle`, file-input-as-button, table-caption naming). That is early evidence the normalizer's output is more stable across milestones than raw `getFullAXTree` — the exact property §5.3 of v2 needs.

The desktop-navigator flow also reproduces: checkout completed via `/api/tree` + `/api/click` only, status live-region read back through the tree, page never seen.

**Verdict: ratify v2 §10 in full.** And fix these six things while promoting spike → product:

| # | Finding | Severity | Resolution |
|---|---|---|---|
| **R1** | **Redaction happens after the secret crosses CDP.** The enrichment `Runtime.callFunctionOn` returns raw `el.value` (password plaintext) to Node, and only *then* Node-side code decides `[redacted]`. The wire, the CDP session, and the Node heap all see the secret. | **Ship gate** | Move the sensitivity decision *into the evaluated function*: classify in-page (type/autocomplete/`isSensitiveField` policy from core) and return `value: null, sensitive: true` — plaintext never leaves the page. This is what v2 §5.2 "in-browser redaction" must literally mean. |
| **R2** | `ax-dom-<backendDOMNodeId>` ids are **session-scoped** — backend ids do not survive reload/navigation, so cross-run diffs and checkpoints break. | High | Already designed in v2 §5.1: on successful DOM resolve, run the shared `id-generator`; keep `ax-*` only for unresolvable UA internals (which also never carry `interaction`). v3 adds: **stamp both** (`id` canonical + `axRef` transient) so the ActionBackend can target without re-walking. |
| **R3** | Enrichment is **O(n) sequential CDP round-trips** (one `DOM.resolveNode` + one `callFunctionOn` per node). Fine for a fixture; pathological on a 3k-node app. | Medium | Batch: single `DOM.pushNodesByBackendIdsToFrontend` for all ids, then one `callFunctionOn` over an array of handles (or `Runtime.evaluate` with `__realA11y__`-style helper). Budget: ≤3 round-trips per snapshot. |
| **R4** | **Three normalizer copies** now exist: `browser.ts#serializeNativeAX` (the `nativeAX()` oracle), `spike/native-tree/normalize.ts`, and `spike/desktop-navigator/session.ts#normalize`. Already drifting (drop-lists differ by `ListMarker`, `Ignored`). | Medium | One module: `packages/browser/src/native/normalize.ts` exporting the **versioned vocabulary table** (drop-list + role map + name-promotion rules). `nativeAX()`, `nativeTree()`, and the desktop session all consume it. The vocabulary table is itself test-covered against the pinned-Chromium corpus. |
| **R5** | v2 puts `source` (producer provenance) on **every node** *and* the tree. A tree never mixes producers; per-node stamps are pure weight. | Low | Provenance lives on `ExtractionResult.source` only (`{ producer, chrome? }`). Serializers stamp it into snapshot headers from there. |
| **R6** | The desktop spike's panel server is **unauthenticated localhost HTTP** — any local process can drive an audited (possibly authenticated) browser session. Plus it echoed exception text to clients (CodeQL `js/stack-trace-exposure`, fixed in this PR). | High for product | Fine for a test-only spike; the product protocol (§4.3) requires loopback bind + per-session bearer token + origin-checked WebSocket upgrade + generic client errors. In Electron packaging, prefer IPC and skip TCP entirely. |

---

## 2. The architecture (the one picture)

```
┌────────────────────────── Layer 4 — surfaces ──────────────────────────────┐
│  in-page: inspector · react · storybook-addon    [DOM producer, forever]  │
│  jsdom:   testing (vitest/jest)                  [DOM producer, forever]  │
│  extension (curtain, any tab)                    [DOM; debugger = later]  │
│  cli · mcp                                       [native default*]        │
│  testing/playwright  attach(page,{tree})         [native default*]        │
│  DESKTOP NAVIGATOR (daemon + panel / Electron)   [native + CDP actions]   │
└──────────────┬───────────────────────────────┬─────────────────────────────┘
               │ reads ExtractionResult        │ dispatches ActionRequest
┌──────────────▼────────────┐   ┌──────────────▼──────────────────────────────┐
│ Layer 3 — shared session   │   │ Layer 3' — ActionBackend (one contract)     │
│ A11ySession (browser pkg)  │   │  · DomActionBackend  = ActionDispatcher +   │
│  open/allowedOrigins/      │   │    ElementRefMap (in-page, today's code)    │
│  storageState/device/      │   │  · CdpActionBackend  = backendDOMNodeId →   │
│  snapshot/nativeTree/act   │   │    DOM.resolveNode → Runtime.callFunctionOn │
└──────────────┬────────────┘   └──────────────▲──────────────────────────────┘
               │ chooses producer               │ targets via id / axRef
┌──────────────▼─────────────────────────────────────────────────────────────┐
│ Layer 2 — producers (two, only two)                                        │
│  DOM producer   (core):    light-DOM walk · jsdom + in-page · LiveTree     │
│  Native producer(browser): getFullAXTree → normalize.ts (versioned vocab)  │
│                            → batched DOM enrich (R3) → in-page redact (R1) │
└──────────────┬─────────────────────────────────────────────────────────────┘
               │ both emit
┌──────────────▼─────────────────────────────────────────────────────────────┐
│ Layer 1 — canonical model (core):  AccNode / SemanticNode (reshaped, v2)   │
│  a11y required · dom?/interaction? optional · ui? panel-only               │
│  ExtractionResult.source = { producer, chrome? }   (R5)                    │
├─────────────────────────────────────────────────────────────────────────────┤
│ Layer 0 — single-model consumers: serialize · audit · validate · snapshot  │
│  diff/baselines/contract — mode-stamped, cross-mode diff refused           │
└─────────────────────────────────────────────────────────────────────────────┘
     * after Phase-1 gates: in-page redaction (R1) + parity harness green
```

The load-bearing rule, unchanged since v1: **producers are plural, the model is singular.** Everything below Layer 2 is producer-blind; everything above Layer 3 is engine-blind. The desktop app drops into Layer 4 without adding a single new extraction or serialization path.

---

## 3. Per-tool decision table (all of them)

| Package | Layer | Producer | Actions | What changes in Phase 1–2 | What never changes |
|---|---|---|---|---|---|
| `core` | 1 + 2 | *is* the DOM producer | *is* DomActionBackend | Model reshape (v2 §2, R5); export sensitivity policy for reuse in native redaction (R1) | Zero-dep, jsdom-safe, **no CDP** |
| `browser` | 2 + 3 | *is* the native producer | *is* CdpActionBackend (Phase 2) | `nativeAX()` → `nativeTree(): ExtractionResult`; `src/native/{normalize,enrich,redact}.ts` (R1/R3/R4); session grows `act()` | Owns Playwright/CDP; the only package that speaks protocol |
| `serialize` | 0 | consumes model | — | Fix `instanceof Element` guard (spike §2); print `source` header | One serializer, no `/native` |
| `audit` | 0 | consumes model | — | Tolerate absent `dom` facet in messages | Rules stay producer-blind |
| `validate` | 0 | consumes model | — | Engine-vocabulary allowlist for computed roles (`video`/`audio`/…, seeded by #193) | Authored `role="video"` still errors |
| `snapshot` | 0 | consumes model | — | Stamp `source` in `a11y-snapshot.json`; **refuse cross-mode diff** (error, not mismatch) | Fingerprint algorithm |
| `cli` | 4 | native (default after gates) | CdpActionBackend | `--tree dom` escape hatch; later `navigate` command (§4.5) | Exit codes, formats |
| `mcp` | 4 | native (default after gates) | CdpActionBackend | `get_native_tree`/`compare_trees` graduate from oracle to producer/parity duty | Tool surface stays model-shaped |
| `testing` (jsdom) | 4 | DOM | DomActionBackend | Nothing | **DOM forever** — no browser exists |
| `testing/playwright` | 4 | native (default after gates) | n/a (assertions) | `attach(page, { tree })` consuming `browser.nativeTree()` | Not a second producer; no new package |
| `inspector` / `react` / `storybook-addon` / `ui` | 4 | DOM | DomActionBackend | Nothing (model reshape only) | **In-page forever** — no CDP channel to self |
| `extension` | 4 | DOM (default) | DomActionBackend | *(Rev 1)* debugger-native mode feasibility proven by Spike 5; opt-in promotion decided on dogfood gates after Phase 1 (imports the shared vocabulary module — R4) | Curtain + any-tab; DOM producer stays the zero-setup default |
| **`desktop`** (new, private) | 4 | **native** | **CdpActionBackend** | §4 — daemon + panel; Electron shell later | Never re-implements extraction/normalize/dispatch |

---

## 4. The Desktop Semantic Navigator — designed in, not bolted on

### 4.1 Product thesis (from the spike, kept verbatim)

> **The accessibility tree is the interface.** Hide the visual page. Click, type, and complete tasks through roles and names. If the page doesn't make sense as a tree, it doesn't make sense.

The extension already sells this with the curtain — but capped at DOM-producer fidelity. The desktop app is the **full-fidelity** version: native tree (UA-shadow media controls included) *plus* CDP action dispatch, which the spike proved works even on controls page JS cannot see. Interaction *is* this product — unlike cli/mcp snapshots, tree-dispatch is justified here on day one.

### 4.2 The one engine rule

The desktop app introduces **zero new extraction machinery**:

```
Desktop panel (renderer)
   │  panel protocol (§4.3)
   ▼
Navigator daemon (Node)
   └── A11ySession (@real-a11y-dev/browser)     ← the same class cli/mcp use
        ├── nativeTree()      → ExtractionResult (Layer 2, native producer)
        ├── act(ActionRequest) → CdpActionBackend (Layer 3')
        ├── allowedOrigins / storageState / device — already designed
        └── Chromium: launch(headless) | connectOverCDP(user's Chrome)
```

Both session modes matter to the product:

- **Launched** (headless + curtain): clean audit sessions, reproducible, CI-recordable.
- **`connectOverCDP`** to the user's running Chrome: *"audit the tab I'm already on"* — the desktop answer to the extension's strongest feature, but at native fidelity and **without** the `chrome.debugger` banner tax (the user opted into `--remote-debugging-port` explicitly).

### 4.3 Panel protocol v0 (fixes R6)

WebSocket JSON-RPC on loopback, spiritually the spike's `/api/tree` + `/api/click` grown up:

- **Bind** `127.0.0.1`, random port; **auth** per-session bearer token minted at daemon start, required on upgrade; **origin-check** the upgrade request.
- **Requests:** `tree()`, `act(ActionRequest)`, `open(url)`, `session.info()`.
- **Events (server-push):** `tree.updated` (the reason WS beats polling HTTP), `focus.changed`, `finding.added`.
- **Errors:** generic client-facing messages; details server-log only (the CodeQL rule from this PR, now a protocol invariant).
- **Redaction:** applied at the producer (R1) — the protocol never carries plaintext secrets, so the panel renderer needs no trust.
- In Electron packaging, the same request/event contract rides **IPC** instead of TCP — protocol v0 is transport-agnostic by construction.

Live updates strategy: **MVP = re-extract after every dispatched action + on `Page.loadEventFired`** (what the spike does, proven). Enhancement: CDP `Accessibility.nodesUpdated` / `loadComplete` (experimental domain events) as an incremental trigger — verify per pinned milestone before relying on them; they are an optimization, never a correctness dependency.

### 4.4 Renderer

`@real-a11y-dev/ui` (Preact tree components) is already the shared panel across inspector, React wrapper, Storybook addon, and extension. The desktop renderer is the **fifth consumer** of the same components — tree view, role/name rows, findings badges — plus desktop-only chrome (session bar, connect dialog, curtain state). No new tree-rendering code.

### 4.5 Packaging ladder (ship value early, brand later)

1. **Phase 4a — `real-a11y navigate <url>`**: the CLI starts the daemon, prints the tokened panel URL, opens the default browser. The "desktop app" MVP is a command — zero install friction, reuses the CLI's distribution. (The spike's `run.mts` note, productionized.)
2. **Phase 4b — `packages/desktop` (private)**: Electron shell = daemon in main process + panel in renderer over IPC. Adds: session persistence, audit-session recording/export (checkpoint timeline → shareable report), tray/dock presence. *(Rev 1: gated on the extension-native dogfood — build only if users need owned/recordable sessions beyond what 4a + extension-native cover.)*
3. **Not chosen:** Tauri (system webview) — lighter, but the team's stack, the `ui` package, and the IPC/debug story all favor Electron; revisit only if bundle size becomes a real objection.

### 4.6 What the desktop app is *not*

- Not a screen-reader emulator (no speech, no rotor — same honesty as the extension docs).
- Not a fourth producer or a second protocol client stack — if a feature needs new extraction behavior, it lands in `browser`/`core`, never in `desktop`.
- Not a replacement for the extension: the extension keeps "any tab, zero setup"; the desktop owns "full fidelity, real sessions, act through the tree."

---

## 5. Roadmap (v2's phases, desktop threaded in)

> **Execution:** the phase list below is the *what*; the PR-by-PR breakdown with dependency graph and living checkbox tracker is [`native-tree-execution.md`](./native-tree-execution.md).

- **Phase 0 — ratify:** v2 model break + this doc's R1–R6 + desktop-as-frontend principle.
- **Phase 1 — model + native read:** AccNode reshape; `browser.nativeTree()` with **one** normalizer (R4), batched enrich (R3), in-page redaction (R1), tree-level provenance (R5); parity harness in CI on the corpus (gate = current 88.7%, must not regress; grow corpus: iframes, portals, virtualized lists, contenteditable).
- **Phase 2 — act:** CdpActionBackend graduating the dispatch spike; `A11ySession.act()`; stable-id scheme (R2).
- **Phase 3 — defaults flip:** cli / mcp / testing-playwright → native when Phase-1 gates green; mode-stamped baselines regen; `--tree` demoted to escape hatch.
- **Phase 4 — Navigator:** 4a `real-a11y navigate` (daemon + panel protocol v0 + `ui` renderer); 4b Electron shell + session recording.
- **Phase 5 — parity as permanent CI** + corpus growth; retire `nativeAX()` oracle in favor of producer + harness.
- ~~**Phase 6 (optional) — extension `chrome.debugger` native mode** — only with demonstrated demand.~~ *(Rev 1: superseded — Spike 5 settled feasibility. Extension-native becomes a **Phase-1-adjacent decision**: after the shared vocabulary module (R4) lands, ship it behind a dev flag and dogfood the three open gates — banner tolerance, MV3 suspension handling, DevTools-conflict frequency. Its outcome gates Phase 4b.)*

---

## 6. Decisions

**Ratified from v1/v2 (unchanged):** one model, two producers; native producer in `browser`; no `serialize/native`, no `core/native`, no new Playwright package; jsdom + in-page stay DOM forever; mode-stamped baselines, cross-mode diff refused; parity harness gates default flips; redaction is a ship gate.

**New in v3 — recommended answers to v2's open questions:**

1. **Model break** (v2 Q1): **yes** — the spikes' fake facets are the proof.
2. **Rename** (v2 Q2): **keep `SemanticNode`** as the public name with the reshaped contract; 14 packages + examples + docs reference it, and the churn buys nothing (`AccNode` remains the internal design name).
3. **Default timing** (v2 Q3): ~~flip immediately when gates pass.~~ **Superseded by Revision 2** — no blanket flip; two co-equal producers, `dom` stays the default, native is an explicit opt-in. A native default is reconsidered only for the `audit` command, per-command, gated on parity.
4. **Normalization strictness** (v2 Q4): aggressive, via the versioned vocabulary table (R4) — the cross-build reproduction in §1 says this works.
5. **Extension native** (v2 Q5): *(Rev 1)* no longer "defer" — Spike 5 proved read + dispatch + shared transport module. Ship behind a dev flag after Phase 1; promote on dogfood evidence (banner / MV3 lifecycle / DevTools conflicts), not demand speculation.
6. **Playwright package** (v2 Q6): never for native.

**New open questions for v3:**

7. **Desktop shell**: ~~ratify the packaging ladder (CLI-served panel → Electron) vs Electron-first?~~ **Resolved by Revision 2** — Electron dropped; `real-a11y navigate` (CLI panel) deferred until the "watch/record an agent through the tree" need is demonstrated. Extension-native (PR H) is expected to own the interactive product.
8. **Protocol transport**: ~~WS JSON-RPC as specified, or align with MCP so agent tooling can drive the daemon too?~~ **Resolved by Revision 2** — the MCP stays audit-first and does **not** become a browser-automation host; `act` in MCP is scoped to interaction-driven re-audit, not general automation (we don't compete with Playwright MCP). If `navigate` is ever built, its panel protocol is the WS JSON-RPC as specified — a human-panel channel, distinct from the MCP audit surface.
9. **Session recording format**: reuse `snapshot`'s checkpoint artifacts as the timeline unit (recommended — one diff engine), or a new event-log format?
10. **`connectOverCDP` UX**: how much hand-holding for `--remote-debugging-port` (launch-helper? deep link?) before it's a real "audit my Chrome" story?

---

*Grounding: every claim in §1 re-verified this session by running `test:spike` / `test:spike:desktop` / `testing test:spike` from a clean checkout (25/25 green, parity 63/71/76 = 88.7% reproduced on a different Chromium build than the report's Chrome 147). Sources: `packages/browser/src/browser.ts` (`A11ySession`, `nativeAX`, `connectOverCDP`, origin allowlist, storage state), `packages/core/src/types.ts`, `packages/testing/src/playwright.ts` (`attach`), `packages/ui` (shared Preact panel), the four spike suites under `packages/browser/spike/` + `packages/testing/spike/`, and RFCs v1/v2 in this directory.*
