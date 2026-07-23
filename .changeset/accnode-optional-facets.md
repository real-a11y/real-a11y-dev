---
"@real-a11y-dev/core": minor
---

**Breaking (beta):** reshape `SemanticNode` to be accessibility-first — `dom`, `interaction`, and `ui` are now **optional** facets; `a11y` stays required. `ExtractionResult` gains a required `source: { producer: "dom" | "native"; chrome? }` provenance stamp.

This is the model break from the native-tree RFC (#197, v2 §2 / v3 R5): one canonical model, two producers. The DOM producer (this package's extractors) still populates every facet, so **runtime behaviour is unchanged** — the change is the type contract. A future native (CDP) producer in `@real-a11y-dev/browser` yields nodes whose `dom`/`interaction` may be absent (UA-internal nodes with no backing light-DOM element), and `ui` is panel-only.

- New exports: `TreeProducerKind`, `TreeSource`, and `DomSemanticNode` — a `SemanticNode` with all facets guaranteed present, for surfaces that only ever render DOM-produced trees (the in-page tree panel, the extension) so they can narrow once at their boundary instead of guarding every read.
- Generic tree helpers (`linearize`, `diffTrees`, `getTabSequence`, `searchTree`, `buildControlsIndex`) now tolerate absent facets and degrade rather than assume presence, so they stay correct on native trees.
- `@real-a11y-dev/audit` findings degrade gracefully when `dom` is absent: an unlabeled-interactive / image-alt finding drops the `<tag>` from its message (and omits `tagName`) instead of printing `<undefined>`.

Migration: if you read `node.dom.*`, `node.interaction.*`, or `node.ui.*`, either narrow to `DomSemanticNode` (when you know the tree came from the DOM producer) or guard with optional chaining. Every `ExtractionResult` you construct by hand now needs a `source` (use `{ producer: "dom" }` for a DOM-produced tree).
