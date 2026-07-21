# RFC: Consuming the native accessibility tree (CDP) for browser-backed surfaces

**Status:** Draft for discussion · **Scope:** `core`, `browser`, `serialize`, `audit`, `validate`, `cli`, `mcp`, extension, `testing` · **Stage:** Beta (breaking changes acceptable)

## TL;DR — recommendation

Don't frame this as "native tree **vs** custom engine." Frame it as **one canonical node model (`SemanticNode`), two producers:**

- **DOM producer** — today's `@real-a11y-dev/core` walk. Runs in jsdom *and* in-page. Keep it.
- **Native producer** — new. Chromium DevTools Protocol `Accessibility.getFullAXTree` → normalized `SemanticNode`. Chromium + CDP only. Lives in `@real-a11y-dev/browser` (which already owns the CDP session), **not** in `core`.

Both emit the same `SemanticNode`, so `serialize` / `audit` / `validate` / diff / baselines / `toMatchA11yContract` stay **single-model**. Ship native behind a `--tree native|dom` flag, opt-in first, default per-surface later based on a parity harness. This is additive, not a rewrite, and it's the design that *doesn't* fork the downstream.

The proposed `@real-a11y-dev/serialize/native` subpath is **not needed** and the `@real-a11y-dev/core/native` subpath is in the **wrong package** — details below.

---

## 1. Context — where we are

The pitch today is *"one engine, every surface"*: `core` extracts a `SemanticNode` tree from the light DOM, and every surface (`cli`, `mcp`, extension side-panel, React `useSemanticTree`, Storybook addon, `testing`) renders/serializes/audits that same tree. Comparability across surfaces is the product's spine — a CLI baseline, a CI-diff-bot snapshot, a `toMatchA11yContract` assertion, and a jsdom unit test are interchangeable *because they serialize the same model*.

## 2. The forcing function

A user inspecting `<video controls>` in the panel saw a single `video "Product tour"` leaf, while Chrome DevTools shows a `Video` node **with children** — `button "play"`, `slider "volume"`, `slider "video time scrubber"`, `button "enter full screen"`. That gap is real and unfixable in-page:

- Native media controls live in a **closed user-agent shadow root**. `video.shadowRoot === null`; `chrome.dom.openOrClosedShadowRoot` only opens *author* roots; no page/extension script can traverse UA internals.
- DevTools sees them because it reads Blink's computed tree over CDP (`Accessibility.getFullAXTree`) — privileged, out-of-page.
- The one web API that would have exposed the computed tree to page JS — AOM's `getComputedAccessibleNode` — **never shipped** (perf: lazy AX tree; privacy: AT-presence fingerprinting; interop: engine-specific vocabularies). It's parked indefinitely.

So the in-page engine is already as faithful as the platform allows. To close the gap on `cli`/`mcp`/extension, we need the browser's own tree — which means CDP.

### Probe evidence (Chromium `getFullAXTree`, run this session)

```
* Video "Unable to play media."
    - generic
    - none [ignored]
* slider "video time scrubber"
* slider "audio time scrubber"
```

Two things this proves: (a) Chromium's tree carries the controls we can't otherwise reach; (b) its **vocabulary differs** from ours — internal `Video`/`Audio` roles, `InlineTextBox`, `[ignored]` nodes, and **load-state-dependent names** ("Unable to play media." before a source loads). Playwright's `ariaSnapshot`, by contrast, **omits media entirely** (no ARIA role). Three sources, three dialects.

## 3. The reframe — one model, two producers

The decision that keeps this safe is: **the canonical model stays `SemanticNode`**, and the native path is a second *producer* of that model, not a second *model*.

```
                         ┌─ DOM producer  (core walk; jsdom + in-page)
   SemanticNode  ◄───────┤
   (canonical)           └─ Native producer (browser: CDP getFullAXTree → normalize)
        │
        ├─ serialize   (one serializer, unchanged)
        ├─ audit       (findings on SemanticNode, unchanged)
        ├─ validate    (ARIA rules — see §5.5)
        └─ diff / baselines / checkpoints / contract  (unchanged)
```

The native producer's real job is an **adapter/normalizer**: `AXNode → SemanticNode`.

## 4. Package topology (concrete)

- **`@real-a11y-dev/core`** — stays the DOM producer + the `SemanticNode` type + the role vocabulary + serialize-compatible model. Zero-dep, jsdom-safe. **No `core/native` subpath**: the native producer needs a live CDP session, which `core` must never depend on (it would poison jsdom + in-page consumers).
- **`@real-a11y-dev/browser`** — gains `nativeTree(page): Promise<ExtractionResult>`. It already owns the Chromium/CDP session (`connectOverCDP` exists; it injects the engine via `page.evaluate(bundleExpression())`). This is the natural and only correct home for a CDP-backed producer. It reuses `core`'s role map + `id-generator` + types so output is a real `SemanticNode`.
- **`@real-a11y-dev/serialize`** — **no `/native` variant.** One `SemanticNode` → one serializer. A `serialize/native` would re-fork exactly what we're preserving.
- **`cli` / `mcp`** — add a `--tree native|dom` flag (config-file default too).
- **extension** — see §5.5; stays DOM by default.
- **`testing` (jsdom)** — stays DOM; there is no browser. **This is the intended asymmetry**, and it's *fine* because both producers emit the same model.

## 5. The parts that genuinely break (designed, not hand-waved)

### 5.1 Stable ids
CDP AXNodes reference `backendDOMNodeId`, not our ids. The native producer must resolve each AXNode → DOM node (`DOM.pushNodesByBackendIdsToFrontend` / `DOM.resolveNode`) and run the **same `id-generator`**, or diff / checkpoints / action-refs break across modes.

### 5.2 Action dispatch
`ActionDispatcher` + `ElementRefMap` are light-DOM (synthetic pointer/key events on element refs). Native mode has no light-DOM refs; it needs a **parallel dispatcher** over CDP (`DOM.resolveNode` → `Runtime` object handle → `Input`/`Runtime.callFunctionOn`). This is what makes `cli`/`mcp` *interact*, not just read — non-trivial, and the largest single work item.

### 5.3 Redaction (security-critical)
Sensitive-field values are stripped **at the DOM producer**, before the tree leaves the page. The native producer must apply the **same redaction inside the browser** before the AX tree is serialized out over CDP, or native mode leaks secrets the DOM mode doesn't. This is a correctness gate, not a nicety.

### 5.4 Version drift (baseline stability)
Chromium's tree shifts across milestones: `InlineTextBox` noise, `[ignored]` nodes, load-state names ("Unable to play media."). Native baselines will **churn on Chrome updates** unless normalized hard (drop InlineTextBox, drop ignored, canonicalize media names, map internal roles → our vocabulary). This is the strongest argument for treating native as **enrichment/validation first, canonical baseline later**, and for pinning the Chromium build the baseline was captured against.

### 5.5 The other surfaces
- **`validate`** already flags unknown roles via `isValidRole`. Our computed `video`/`audio` roles aren't ARIA; when a `core → validate` adapter lands it must **exempt computed engine vocabulary**, never loosen the ARIA schema (an *authored* `role="video"` must still error). Native mode's normalized roles need the same allowlist. (Breadcrumb already added to `role-map.ts` in the media PR.)
- **Extension** can only reach CDP via `chrome.debugger`: permanent "…is debugging this browser" banner, scary permission at install, Web Store review friction, conflicts when DevTools is open, and **no incremental-update events** (the `LiveTreeExtractor` model dies). Materially costlier than cli/mcp. Keep it on the DOM producer; offer `chrome.debugger` "native mode" only as a later opt-in.
- **In-page** (inspector / React / Storybook / UI) — **never** gets native; in-page scripts have no debugging channel to their own page. Permanent DOM-producer surface. Fine, because same model.

## 6. Cross-mode comparability (the rule that keeps baselines honest)

Because the two producers will **not** be byte-identical, we must:
1. **Stamp the producer mode** into every baseline/snapshot header.
2. **Refuse cross-mode diff** by default (a `native` baseline asserted against a `dom` run is an error, not a silent mismatch) — or route both through a normalization layer that erases producer-specific noise.
3. Keep `serialize` output shape identical between modes so a *normalized* native tree and a DOM tree are legitimately comparable where we choose to allow it.

## 7. The parity harness (turn the fork into a correctness check)

Before defaulting anything to native, build a **parity audit**: for a corpus of pages, run both producers and diff the normalized `SemanticNode` trees. Disagreements are a mutual correctness signal — they catch DOM-producer gaps (this is literally how the `video`/`audio`/captions gap was found by hand this session) *and* native-normalization bugs. This harness is the gate for §8's default decisions and a permanent CI guard afterward.

## 8. Staged rollout

- **Phase 0 — decision:** ratify "one model, two producers." (This RFC.)
- **Phase 1 — `browser.nativeTree()` behind `--tree native`, opt-in.** Build the CDP→`SemanticNode` adapter (§5.1) + redaction-in-browser (§5.3) + the parity harness (§7). No default change. Ship read-only first (defer §5.2 dispatch).
- **Phase 2 — native action dispatch (§5.2)** so `cli`/`mcp` interactions work in native mode.
- **Phase 3 — set defaults per surface from Phase 1/2 data.** Likely: `cli`/`mcp` → native (a real browser is the whole point there); `testing`-jsdom → DOM; extension/in-page → DOM.
- **Phase 4 (optional) — extension `chrome.debugger` "native mode"** once demand justifies the banner.

Evidence this converges cleanly: the media-roles PR (#193) already pulls the **DOM producer's vocabulary toward Chromium** (`video`/`audio`/`captions`, media leaves, focusability). Every such increment shrinks the native↔DOM delta, so native mode ships as a *smaller*, better-understood diff rather than a rip-and-replace.

## 9. Pitch evolution

*"One engine, every surface"* → **"one model, every surface — the real browser tree where a browser exists, faithful emulation where it doesn't (jsdom, in-page)."** Stronger and more honest, and it keeps comparability instead of trading it away.

## 10. Risks & non-goals

- **Risk:** two dialects leak into baselines → mitigated by §6 mode-stamping + §7 parity harness.
- **Risk:** native dispatch (§5.2) is a big lift → mitigated by shipping read-only in Phase 1.
- **Non-goal:** replacing the DOM producer. It remains canonical for jsdom + in-page forever.
- **Non-goal:** a `serialize/native` or `core/native` package surface (§4).

## 11. Open questions / decisions needed

1. **Ratify the framing** — "one model, two producers," or a genuine hard fork (own model for native, accepting the serialize/audit/diff fork)? The hard fork is a much larger, comparability-breaking effort; this RFC recommends against it.
2. **Default mode per surface** — defer to Phase 1 parity data, or commit now?
3. **Normalization strictness** — how aggressively do we strip Chromium-internal nodes (InlineTextBox, ignored) to keep baselines stable across Chrome versions?
4. **Extension** — is the `chrome.debugger` banner ever acceptable, or is the extension permanently DOM-producer?

---

*Grounding: `browser.ts` (`connectOverCDP`, `page.evaluate` bundle), `serialize`/`validate`/`core` source, and a `getFullAXTree` vs `ariaSnapshot` probe run against the sandbox Chromium this session.*
