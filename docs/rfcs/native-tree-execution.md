# Native-tree execution plan — the PR ladder

**Companion to:** [`native-tree-v3.md`](./native-tree-v3.md) (architecture) · [`native-tree-spike.md`](./native-tree-spike.md) (evidence)
**Principle:** small PRs, each independently valuable; gates instead of dates.

This is the living tracker. Check items off as PRs merge; link the PR number
next to each item. The mirror checklist in [#197](https://github.com/real-a11y/real-a11y-dev/pull/197)'s
description tracks the same list at a glance.

## Tracker

### Phase 0 — ratify

- [ ] **PR 0 — merge #197.** Merging ratifies v1–v3's recommended answers to
      Q1–Q6. Q7–Q10 (desktop shell, protocol transport, recording format,
      `connectOverCDP` UX) stay open — they don't block Phase 1.

### Phase 1 — foundations (critical path: C → D → E/F)

- [x] **PR A — `fix(serialize)`: feature-detect `Element`.** Plain-Node
      consumers can serialize an `ExtractionResult` (spike §2 found
      `instanceof Element` throws when the global is undefined). Size S,
      no dependencies. **Merged: [#204](https://github.com/real-a11y/real-a11y-dev/pull/204).**
- [x] **PR B — `feat(core)`: shared native-AX vocabulary module (R4).**
      **Merged: [#205](https://github.com/real-a11y/real-a11y-dev/pull/205)**
      — consolidation surfaced a real drift bug (spike normalizers ordered
      siblings by flat-list position; document order lives in `childIds`),
      and review deepened name promotion (dropped-descendant search, guarded
      to normalized leaves). Unblocks PR D and PR H.
      Consolidates the four drifting normalizer copies (browser `nativeAX()`,
      native-tree spike, desktop spike, extension spike). Pure — tested
      against recorded `getFullAXTree` JSON fixtures, no browser in the loop.
      Lives in `core` per the §"one refinement" note below. Size S–M,
      no dependencies.
- [x] **PR C — `feat(core)!`: model reshape (v2 §2, v3 R5).** Optional
      `dom` / `interaction` / `ui` facets; `ExtractionResult.source` provenance;
      new `DomSemanticNode` boundary type. The DOM producer still fills every
      facet, so zero behavior change. **Merged: [#208](https://github.com/real-a11y/real-a11y-dev/pull/208)**
      — audit degrades gracefully (R5), generic helpers guard, panel/extension
      narrow once to `DomSemanticNode`; serialize/validate/snapshot/react/
      inspector/cli/mcp untouched. The native producer is now born on the
      honest contract. Unblocks PR D.
- [x] **PR D — `feat(browser)`: `nativeTree()` producer.** **Merged: [#210](https://github.com/real-a11y/real-a11y-dev/pull/210)**
      Graduates the spike: batched enrichment (R3, one `DOM.getDocument` walk),
      **in-page-safe redaction (R1 — ship gate): allowlist attributes, never
      read `.value`, drop AX `value`**, `source` stamp. Read-only (no
      `interaction` — that's PR G). R2 stable ids via core's `normalizeNativeAX`
      (session-scoped; DOM-id alignment threaded when PR G needs it). R1 proven
      by a test that builds the tree from a real recorded payload with real
      email/password secrets and asserts they appear nowhere in the output.
      Depends on B + C (both merged).
- [x] **PR E — `ci`: parity harness.** **Merged: [#212](https://github.com/real-a11y/real-a11y-dev/pull/212)** — reproduces the spike's 88.7% overlap with the product producers; advisory CI step, 80% floor. Corpus job on pinned Chromium;
      non-blocking first, required once stable. Gate metric: role+name
      overlap ≥ 88.7% and never regresses. Corpus growth backlog: iframes,
      portals, virtualized lists, contenteditable. Depends on D.
- [x] **PR F — `feat(cli,mcp,testing)`: opt-in native.** **Merged** — testing
      `attach({ tree: "native" })` ([#214](https://github.com/real-a11y/real-a11y-dev/pull/214)),
      cli `--producer native` ([#216](https://github.com/real-a11y/real-a11y-dev/pull/216)),
      mcp `producer: "native"` ([#219](https://github.com/real-a11y/real-a11y-dev/pull/219)).
      Flag named `--producer` (not `--tree`, which collided with the `tree`
      command — [#218](https://github.com/real-a11y/real-a11y-dev/pull/218)); mcp
      producer/tool consistency in [#221](https://github.com/real-a11y/real-a11y-dev/pull/221).
      No default change (see Phase 3, retired).

### Phase 2 — act

- [x] **PR G — `feat(browser)`: `CdpActionBackend` + `A11ySession.act()`.**
      **Merged: [#223](https://github.com/real-a11y/real-a11y-dev/pull/223)** —
      graduated the dispatch spike (click/type/focus over CDP, targeting
      `ax-dom-<n>` ids; no typed value ever returned). Depends on D (id scheme).

### Phase 1-adjacent — extension-native dogfood (v3 Revision 1)

- [ ] **PR H — `feat(extension)`: native mode behind a dev flag.** Depends
      on B (+C). **Produces a decision, not a feature**: time-boxed dogfood
      (~2 weeks of real use) answering banner tolerance, MV3 suspension
      handling, DevTools-conflict frequency. Verdict written back into v3 —
      this closes the desktop-vs-extension question with evidence.

### Phase 3 — default flips — **RETIRED (v3 Revision 2)**

The blanket "flip defaults to native + demote `--producer dom` to an escape
hatch" plan is **retired**. The two producers are co-equal tools, not
better/worse: DOM keeps `rootSelector` scoping, tab order, and the jsdom/in-page
path; native adds UA-shadow fidelity but is whole-document, tab-order-less, and
Chromium-only. Default stays `dom`; `native` is an explicit opt-in.

- [ ] ~~PR I₁ — cli default → native~~ **won't do** (keep both)
- [ ] ~~PR I₂ — mcp default → native~~ **won't do** (keep both)
- [ ] ~~PR I₃ — testing/playwright default → native~~ **won't do** (keep both)
- [ ] **(maybe, later) native default for the `audit` command only** — where
      fidelity = correctness. Per-command, gated on the parity harness; never a
      blanket flip. Not scheduled.

### Phase 4 — Navigator — **DEFERRED (v3 Revision 2)**

The desktop track closes: Spike 5 showed the *extension* reads + dispatches the
native tree, so extension-native (PR H) is expected to own the "tree is the
interface" product (any tab, zero install, full fidelity). The Electron shell
is **dropped**; `navigate` is **deferred** until the "watch/record an agent
complete a task through the tree" use case shows real demand.

- [ ] **(deferred) PR J — `feat(cli)`: `real-a11y navigate <url>`.** Daemon + panel
      protocol v0 + `ui` renderer. Depends on D + G.
- [ ] ~~**Phase 4b — Electron shell.**~~ **DROPPED (v3 Revision 2)** — the
      extension (going native, PR H) covers the interactive product; Electron's
      only edge (owned/recordable sessions) is speculative and not worth the
      shell. Revisit only if that need is proven *and* `navigate` (4a) is
      insufficient.

## Dependency sketch

```
A ──────────────────────────────┐
B ───────────┬── D ── E ── I₁ I₂ I₃
C ───────────┘    ├── F
                  ├── G ── J
B (+C) ── H ──────┴──────── 4b decision
```

Parallel tracks: A, B, C can all start immediately; H the moment B lands.

## One refinement over v3 (adopted here, fold into v3 at merge)

v3 §3 places the whole native producer in `browser`, but PR H needs the
*normalizer* in browser-JS — an MV3 service worker cannot import a
Playwright-flavored package. The clean cut, proven by Spike 5's
`CdpTransport` seam:

- **`core`** gets the **pure** part: vocabulary tables, `normalize(rawAXNodes)`,
  StaticText name promotion. Zero-dep, fits core's "shared types + role
  vocabulary" charter, importable from workers and jsdom alike.
- **`browser`** keeps everything **transport-bound**: session lifecycle,
  batched enrichment, in-page redaction, `CdpActionBackend`.

## Watch items

1. **R1 (in-page redaction)** — the only silently-slippable gate; enforced
   via PR D's review checklist, not trust.
2. **PR C churn** — every package touches it; keep it types-and-tolerance
   only, no behavior change, so review is mechanical.
3. **Baseline churn on Chrome bumps** — pinned Chromium in E; `source.chrome`
   stamps from C make drift visible instead of mysterious.
