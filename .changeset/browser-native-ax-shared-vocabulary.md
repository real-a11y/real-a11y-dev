---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

fix(browser): `BrowserSession.nativeAX()` now normalizes Chromium's accessibility tree with core's shared native vocabulary (`normalizeNativeAX` / `serializeNativeAX`), the same one `nativeTree()` uses, instead of a private copy of the tables that had drifted from it. Its return shape is unchanged (an indented `role "name"` tree plus flat role+name pairs), but its content now matches `nativeTree()` node for node:

- a **named** `generic` container (e.g. `generic "YouTube Video Player"`) is kept instead of flattened; a bare one is still dropped
- `Video` / `Audio` map to `video` / `audio`, and `ListMarker` / `Ignored` are dropped
- sibling order follows Chromium's `childIds`, and a leaf with an empty name picks up its text from a dropped `StaticText` / `LabelText` descendant (`listitem "Alpha"` rather than a bare `listitem`)
- that promoted name goes through the same redaction as `nativeTree()`, so an unlabeled field's typed value never becomes its name

Future changes to the shared vocabulary now reach `nativeAX()` automatically.
