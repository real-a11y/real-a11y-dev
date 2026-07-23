---
"@real-a11y-dev/serialize": patch
---

`serializeTree` / `serializeOutline` / `serializeTabSequence` now work in plain Node when given a pre-extracted tree.

The input check was a bare `input instanceof Element`, which throws `TypeError: Right-hand side of 'instanceof' is not an object` in any runtime without a DOM `Element` global — making every serializer unusable on a perfectly good `ExtractionResult` (a deserialized snapshot, a native browser tree read over CDP) outside jsdom/browser. The check now feature-detects the global first: no `Element` global means the caller can't be holding a DOM root, so the input is treated as an already-extracted tree. Behavior in jsdom, browsers, and the extension panel is unchanged.
