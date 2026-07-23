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

- [ ] **PR A — `fix(serialize)`: feature-detect `Element`.** Plain-Node
      consumers can serialize an `ExtractionResult` (spike §2 found
      `instanceof Element` throws when the global is undefined). Size S,
      no dependencies.
- [ ] **PR B — `feat(core)`: shared native-AX vocabulary module (R4).**
      Consolidates the four drifting normalizer copies (browser `nativeAX()`,
      native-tree spike, desktop spike, extension spike). Pure — tested
      against recorded `getFullAXTree` JSON fixtures, no browser in the loop.
      Lives in `core` per the §"one refinement" note below. Size S–M,
      no dependencies.
- [ ] **PR C — `feat(core)!`: model reshape (v2 §2, v3 R5).** Optional
      `dom` / `interaction` facets; `ExtractionResult.source` provenance.
      Mechanical migration of serialize / audit / validate / snapshot / ui;
      the DOM producer still fills every facet, so zero behavior change.
      Size M–L. **The churn PR — land before D so the native producer is
      born on the honest contract.**
- [ ] **PR D — `feat(browser)`: `nativeTree()` producer.** Graduates the
      spike: batched enrichment (R3, ≤3 round-trips), **in-page redaction
      (R1 — ship gate)**, stable ids (R2, shared id-generator + transient
      `axRef`), `source` stamp. Depends on B + C.
      *Review checklist must include: grep the CDP wire capture for the
      fixture password — R1 is the only gate that can slip silently.*
- [ ] **PR E — `ci`: parity harness.** Corpus job on pinned Chromium;
      non-blocking first, required once stable. Gate metric: role+name
      overlap ≥ 88.7% and never regresses. Corpus growth backlog: iframes,
      portals, virtualized lists, contenteditable. Depends on D.
- [ ] **PR F — `feat(cli,mcp,testing)`: opt-in native.** `--tree native`
      (cli/mcp) and `attach(page, { tree })` (testing/playwright), all
      flag-gated, no default change. Depends on D.

### Phase 2 — act

- [ ] **PR G — `feat(browser)`: `CdpActionBackend` + `A11ySession.act()`.**
      Graduates the dispatch spike. Depends on D (id scheme).

### Phase 1-adjacent — extension-native dogfood (v3 Revision 1)

- [ ] **PR H — `feat(extension)`: native mode behind a dev flag.** Depends
      on B (+C). **Produces a decision, not a feature**: time-boxed dogfood
      (~2 weeks of real use) answering banner tolerance, MV3 suspension
      handling, DevTools-conflict frequency. Verdict written back into v3 —
      this closes the desktop-vs-extension question with evidence.

### Phase 3 — default flips (each gated on E green + R1 done)

- [ ] **PR I₁ — cli default → native** (baseline regen isolated)
- [ ] **PR I₂ — mcp default → native**
- [ ] **PR I₃ — testing/playwright default → native**

### Phase 4 — Navigator

- [ ] **PR J — `feat(cli)`: `real-a11y navigate <url>`.** Daemon + panel
      protocol v0 + `ui` renderer. Depends on D + G.
- [ ] **Phase 4b decision point — Electron shell.** Only after PR H's
      dogfood verdict; build only if users need owned/recordable sessions
      beyond what 4a + extension-native cover.

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
