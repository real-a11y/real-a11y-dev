---
"@real-a11y-dev/core": minor
---

feat(core): the native AX normalizer now preserves _named_ `generic` containers instead of always dropping them. A bare `generic` wrapper is still flattened, but a generic that carries an accessible name (e.g. Chromium's `generic "YouTube Video Player"`, which groups the media controls) is kept as a labelled group. This restores meaningful grouping in native-producer output and closes a native↔DOM structural divergence where the DOM producer kept the container and the native producer flattened it. `none`/`presentation` remain unconditionally dropped (the author explicitly removed semantics). Bumps `NATIVE_AX_VOCABULARY_VERSION` to 2 — native snapshots/baselines that contain named generic wrappers will pick up the new grouping.
