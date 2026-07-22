# RFC v2: Native accessibility tree as a first-class producer

**Status:** Draft for discussion · **Companion to:** [#197](https://github.com/real-a11y/real-a11y-dev/pull/197) (`docs/rfcs/native-tree.md`) · **Stage:** Beta (breaking changes acceptable)

## Relationship to #197

[#197](https://github.com/real-a11y/real-a11y-dev/pull/197) got the spine right:

- Not "native **vs** custom engine" — **one canonical model, two producers**
- Native producer lives in `@real-a11y-dev/browser` (owns CDP), **not** in `core`
- No `serialize/native` fork — one model → one serializer
- Hard parts called out honestly: stable ids, CDP action dispatch, in-browser redaction, Chromium version drift, extension `chrome.debugger` cost

This v2 **ratifies that spine** and proposes three changes that beta makes cheap, and that keep the architecture honest once native is the browser-backed default:

1. **Break today's `SemanticNode`** so the canonical model is accessibility-first (`dom` / `interaction` become optional facets), instead of forcing CDP to fake a DOM-shaped contract.
2. **Default `cli` / `mcp` to native** after a short parity gate — treat `--tree` as a migration escape hatch, not a permanent dual-mode product surface.
3. **Split read-tree from action-dispatch** so native can ship read-only first without inventing fake `ElementRefMap` entries.

Grounding: current `SemanticNode` in `packages/core/src/types.ts`, existing CDP oracle `BrowserSession.nativeAX()` + MCP `get_native_tree` / `compare_trees`, and the #197 RFC.

---

## TL;DR — recommendation

```
                    ┌─ DOM producer   (core)     → jsdom + in-page + extension
   AccNode  ◄───────┤
   (canonical)      └─ Native producer (browser) → cli / mcp  [default]
        │
        ├─ serialize / audit / validate / snapshot / contract
        └─ actions via ActionBackend (DOM refs | CDP resolve)
```

- **Keep** one model, two producers (agree with #197).
- **Evolve** the model: accessibility properties are required; `dom` and `interaction` are optional.
- **Put** the native producer in `@real-a11y-dev/browser` (agree with #197).
- **Default** browser-backed surfaces (`cli`, `mcp`) to native once redaction + parity pass.
- **Keep** the DOM producer forever for jsdom and in-page — there is no privileged AX tree there.
- **Reuse** the existing `nativeAX()` / `compare_trees` work as the seed of the producer + parity harness.

This is additive for surfaces that stay on DOM, and a deliberate breaking reshape of the shared node type while we are still on `0.1.x`.

---

## 1. Why v2 exists — the gap in "keep SemanticNode as-is"

Today every node requires a full DOM facet:

```ts
// packages/core/src/types.ts (today)
interface SemanticNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  depth: number;
  dom: DomInfo;                 // required
  a11y: A11yInfo;
  interaction: InteractionInfo; // required
  ui: NodeUIState;
}
```

That contract is correct for the in-page panel and for jsdom. It is the wrong shape for CDP:

| Required field today | Native AX reality |
|---|---|
| `dom.tagName` / `attributes` / `textContent` | Not on `AXNode`; only recoverable if `backendDOMNodeId` resolves |
| `interaction.actions` + `ElementRefMap` | No light-DOM element refs; UA-shadow controls may have no page-script target |
| Stable `sn-*` ids from `WeakMap<Node, string>` | CDP has session `nodeId` + optional `backendDOMNodeId` |
| Redaction via `isSensitiveField(element)` | Must happen before AX leaves the page, or from resolved DOM — not from role/name alone |

If we "normalize AX → today's `SemanticNode`," we will invent empty `dom` objects, phantom action lists, and brittle id schemes. That is a permanent tax on every native code path.

**Beta is the moment to break the model once**, so both producers emit the same *honest* shape.

---

## 2. Target model — accessibility-first, optional facets

Rename is optional (`SemanticNode` can stay as the public name). The contract change is what matters:

```ts
type TreeProducerKind = "dom" | "native";

interface AccNode {
  id: string;
  parentId: string | null;
  childIds: string[];
  depth: number;

  /** The product — what AT / audits / serializers care about. */
  a11y: A11yInfo;

  /**
   * Provenance. Stamped into every snapshot/baseline header.
   * Cross-mode assert without an explicit normalize path is an error.
   */
  source: {
    producer: TreeProducerKind;
    /** Chromium milestone when producer === "native" (baseline pinning). */
    chrome?: string;
  };

  /** Present for the DOM producer, or when native resolved backendDOMNodeId. */
  dom?: DomInfo;

  /** Present only when an ActionBackend can actually target this node. */
  interaction?: InteractionInfo;

  /** Panel-only; never serialized. */
  ui?: NodeUIState;
}

interface ExtractionResult {
  nodes: Map<string, AccNode>;
  rootId: string;
  focusedId?: string;
  source: AccNode["source"]; // also at the tree root for cheap stamping
}
```

### Downstream impact (small where it matters)

- **`serialize`** already keys off `node.a11y.role` / `name` / `properties.level` — largely unchanged.
- **`audit`** uses `node.dom.tagName` in some messages — degrade gracefully (`role` only, or omit tag) when `dom` is absent.
- **`validate`** stays ARIA-schema; keep the engine-vocabulary allowlist for computed roles (`video` / `audio` / …) already seeded by #193.
- **UI / inspector / extension** keep filling `dom` + `interaction` + `ui` via the DOM producer — no feature loss.

### Why not a hard fork (native-only model)?

A second model duplicates serialize, audit, snapshot, diff, contract matchers, and the panel. Comparability across jsdom unit tests and CLI baselines is the product's spine. Dual *producers* are mandatory; dual *models* are not. (#197 §11 Q1 — ratify "one model, two producers"; reject the hard fork.)

---

## 3. Package topology

Agree with #197 §4, with one clarification:

| Package | Role |
|---|---|
| `@real-a11y-dev/core` | DOM producer + shared types (`AccNode`, role map, id-generator for DOM). Stays zero-dep / jsdom-safe. **No CDP.** |
| `@real-a11y-dev/browser` | Native producer: `nativeTree(): Promise<ExtractionResult>`. Already owns Playwright/CDP (`connectOverCDP`, existing `nativeAX()`). Home of AX→AccNode normalization. |
| `@real-a11y-dev/serialize` | One serializer. No `/native` subpath. |
| `@real-a11y-dev/audit` / `validate` / `snapshot` | Consume `AccNode`. Mode-stamp baselines; refuse silent cross-mode diff. |
| `cli` / `mcp` | Default **native** after Phase 1 gates; `--tree dom` as escape hatch during beta. |
| `testing` (jsdom) | DOM forever. |
| inspector / React / Storybook / UI | DOM forever (no debugging channel into the host page). |
| extension | DOM default; `chrome.debugger` native mode only if demand justifies the banner (#197 §5.5). |

### Seed already in tree

`BrowserSession.nativeAX()` (`packages/browser/src/browser.ts`) + MCP tools `get_native_tree` / `compare_trees` already read `Accessibility.getFullAXTree` and diff role/name pairs against the custom engine. Promote that oracle into a real producer + CI parity harness — do not start from zero.

---

## 4. Read vs act — separate backends

#197 correctly flags action dispatch as the largest work item. v2 makes the split explicit:

```ts
interface TreeProducer {
  extract(options?: { rootSelector?: string }): Promise<ExtractionResult> | ExtractionResult;
}

interface ActionBackend {
  dispatch(req: ActionRequest): Promise<ActionResult>;
}
```

| Producer | Default ActionBackend |
|---|---|
| DOM | Today's `ActionDispatcher` + `ElementRefMap` |
| Native (Phase 1) | **None** — read-only tree |
| Native (Phase 2) | CDP: `backendDOMNodeId` → `DOM.resolveNode` → Input / `Runtime.callFunctionOn` |

UA-shadow media controls may remain non-dispatchable even in Phase 2; that is acceptable — fidelity of *structure* is the forcing function (`<video>` children), not driving the scrubber from the CLI on day one.

Shipping read-only native first unblocks cli/mcp defaults without blocking on the hardest subsystem.

---

## 5. Hard parts (designed, not hand-waved)

Carry forward #197 §5 with sharper defaults:

### 5.1 Stable ids

Native nodes should resolve `backendDOMNodeId` → DOM node when possible and reuse the **same DOM id-generator**, so a node that exists in both worlds keeps a stable id. Pure AX nodes (no backend id — e.g. some UA internals) get a namespaced id (`ax-<…>`) and **no** `interaction` facet.

### 5.2 Redaction (ship gate)

DOM mode strips sensitive field values at extraction. Native mode must apply the **same policy inside the browser** (or immediately after CDP with a proven DOM-resolve pass) before anything is persisted or returned to MCP/CLI consumers. **No native default without this.**

### 5.3 Normalization / version drift

Drop Chromium noise before it becomes `AccNode`: `InlineTextBox`, ignored nodes, map internal roles → engine vocabulary, canonicalize load-state media names where safe. Pin the Chromium build used for native baselines in CI. Stamp `source.chrome` on every native snapshot.

### 5.4 Cross-mode comparability

1. Stamp producer mode (+ chrome version) on every baseline/snapshot header.
2. Refuse cross-mode diff by default (error, not silent mismatch).
3. Optional explicit normalize path later if we ever want DOM↔native structural compare in CI beyond the parity harness.

### 5.5 Parity harness

Promote `compare_trees` into a fixture-corpus CI job. Disagreements are a mutual signal: DOM-producer gaps (how media roles were found) *and* native-normalizer bugs. This harness gates the cli/mcp default flip — then remains as a permanent fidelity guard. The job of the harness is **not** "two equal product modes forever"; it is "prove native is safe to default, then keep DOM honest."

---

## 6. Surface defaults (commit the intent now)

| Surface | Default producer | Rationale |
|---|---|---|
| `cli` | **native** | A real Chromium is the whole point |
| `mcp` | **native** | Agents should reason about Blink's tree |
| `testing` (jsdom) | DOM | No browser |
| inspector / React / Storybook | DOM | In-page; no CDP to self |
| extension | DOM | Avoid permanent debugger banner unless demanded |

Pitch evolution (agree with #197 §9, sharpened):

> **"One model, every surface — the real browser tree where a browser exists, faithful DOM emulation where it doesn't (jsdom, in-page)."**

`--tree native|dom` is a **beta migration / escape hatch**, not a forever dual-UX. Once defaults settle, hide or remove it; keep the producer stamp on snapshots forever.

---

## 7. Staged rollout

- **Phase 0 — decision:** Ratify AccNode (optional `dom` / `interaction`) + "native default for cli/mcp" + read/act split. (This RFC + #197.)
- **Phase 1 — model break + native read producer:**
  - Evolve types in `core`; migrate serialize / audit / validate / testing / UI.
  - Promote `nativeAX()` → `nativeTree(): ExtractionResult` (normalize, role map, ids, chrome stamp).
  - In-browser (or resolve-then) redaction.
  - Parity harness CI on a fixture corpus.
  - Wire cli/mcp behind `--tree native` first; flip default when harness + redaction pass.
- **Phase 2 — CDP `ActionBackend`:** interactions for nodes with resolvable backend DOM ids.
- **Phase 3 — remove or hide dual-mode flag;** keep producer stamps; DOM producer remains for non-browser surfaces.
- **Phase 4 (optional) — extension `chrome.debugger` native mode** only with clear demand.

Evidence this converges: #193 already pulls DOM vocabulary toward Chromium (`video` / `audio` / captions). Every such increment shrinks the native↔DOM delta so the default flip is a small, measured step — not a rip-and-replace.

---

## 8. Risks & non-goals

- **Risk:** baselines churn on Chrome updates → mitigated by aggressive normalization + pinned Chromium in CI + `source.chrome` stamps.
- **Risk:** CDP action dispatch is large → mitigated by read-only Phase 1.
- **Risk:** optional `dom` breaks audit message copy → migrate messages to tolerate missing tagName.
- **Non-goal:** replacing the DOM producer. It remains canonical for jsdom + in-page forever.
- **Non-goal:** `serialize/native` or `core/native` package surfaces.
- **Non-goal:** Firefox/WebKit native producers in this RFC (Chromium/CDP first; other engines are a later adapter question).

---

## 9. Open questions / decisions needed

1. **Model break** — optional `dom` / `interaction` on AccNode (**this RFC recommends yes**) vs keep required `dom` and fabricate fields for native (**no**).
2. **Public rename** — keep the name `SemanticNode` with a reshaped contract, or rename to `AccNode` / `A11yNode` while breaking? (Cosmetic; pick one and changelog it.)
3. **cli/mcp default timing** — flip as soon as Phase 1 gates pass (**recommend**), or linger on opt-in for a full minor?
4. **Normalization strictness** — drop `InlineTextBox` / ignored / canonicalize media names aggressively (**recommend yes** for baseline stability).
5. **Extension native** — defer indefinitely unless users accept the debugger banner (**recommend defer**).

---

## 10. What to ratify from #197 unchanged

- One model, two producers (not a hard fork).
- Native producer in `@real-a11y-dev/browser`.
- No `serialize/native`.
- In-browser redaction as a correctness gate.
- Mode-stamped baselines; no silent cross-mode diff.
- Parity harness before trusting native defaults.
- Extension / in-page stay on DOM by default.
- Forcing function: UA-shadow media controls are unreachable in-page; CDP is the only close for cli/mcp/extension.

---

*Grounding: `packages/core/src/types.ts`, `packages/browser/src/browser.ts` (`nativeAX`, `connectOverCDP`, page-bundle extract path), MCP `get_native_tree` / `compare_trees`, serialize/audit consumers of `SemanticNode`, and PR #197.*
