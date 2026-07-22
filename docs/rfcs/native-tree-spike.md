# Spike report: native a11y tree via CDP → `ExtractionResult`

**Status:** Feasibility confirmed (with caveats) · **PR:** [#197](https://github.com/real-a11y/real-a11y-dev/pull/197) · **Code:** `packages/browser/spike/native-tree/`

Companion to [`native-tree.md`](./native-tree.md) and [`native-tree-v2.md`](./native-tree-v2.md). This spike runs Chromium, calls `Accessibility.getFullAXTree`, normalizes into today's `SemanticNode` / `ExtractionResult`, and checks the RFC's hard claims against a fixture (`video`/`audio` controls, password + email fields).

```bash
pnpm --filter @real-a11y-dev/browser run test:spike
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

**Recommendation:** proceed with the v2 plan (AccNode + native producer in `@real-a11y-dev/browser`). No second spike needed for *read* feasibility. Action-dispatch (Phase 2) is still unproven and should be its own spike later.

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

### 6. What this spike did **not** cover

- CDP **action dispatch** (click/type via `Input` / `Runtime.callFunctionOn`) — Phase 2; separate spike.
- Root scoping (`rootSelector`) / iframes / cross-origin.
- Baseline stability across Chrome milestones (pin + corpus still required).
- Extension `chrome.debugger` path.
- Parity harness CI corpus (only one fixture here).

---

## Code layout (throwaway-friendly)

```
packages/browser/spike/native-tree/
  fixture.html                 # media + sensitive fields
  normalize.ts                 # AX → ExtractionResult (spike-quality)
  native-tree.spike.test.ts    # feasibility assertions + report dump
  probe.mts                    # raw CDP dump helper
packages/browser/spike/vitest.config.ts
```

`pnpm test:spike` is **opt-in** — not part of default `vitest` / `pnpm verify`. Keep it that way until the producer graduates out of `spike/`.

---

## Decisions this spike supports

1. **Proceed** with native producer in `@real-a11y-dev/browser` (read path is feasible).
2. **Break** `SemanticNode` toward optional `dom` / `interaction` (v2) — spike had to fake them.
3. **Treat redaction as a Phase-1 ship gate**, including AX `value` and DOM enrich.
4. **Defer** action-dispatch spike until after a real `nativeTree(): ExtractionResult` lands behind a flag.
5. **Fix** `serialize`'s `instanceof Element` guard so Node consumers can serialize an `ExtractionResult` without jsdom (small follow-up).

---

*Chrome under test: Playwright Chromium `147.0.7727.15` (headless shell). Re-run `test:spike` after Chrome bumps to refresh the sample tree.*
