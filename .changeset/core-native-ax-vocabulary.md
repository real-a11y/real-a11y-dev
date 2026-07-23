---
"@real-a11y-dev/core": minor
---

New native-AX vocabulary module: the single shared normalization of Chromium's native accessibility tree (CDP `Accessibility.getFullAXTree`) into engine vocabulary.

Exports `normalizeNativeAX` / `serializeNativeAX` (plus the tables: `NATIVE_AX_DROP_ROLES`, `NATIVE_AX_ROLE_MAP`, `NATIVE_AX_NAME_SOURCE_ROLES`, `mapNativeAXRole`, and `NATIVE_AX_VOCABULARY_VERSION`). Pure functions — no CDP, no DOM globals — so the same module serves every native-tree consumer: the browser package's upcoming `nativeTree()` producer, the extension's `chrome.debugger` mode, desktop/panel surfaces, and parity harnesses. Consolidates the four private copies that grew during the native-tree RFC spikes (#197) and had already drifted.

Normalization: drops Blink noise (`StaticText`/`InlineTextBox`/`generic`/`none`/`RootWebArea`/…) re-parenting kept descendants to the nearest kept ancestor; maps internal roles (`Video`→`video`, `Audio`→`audio`, `image`→`img`); promotes names off dropped text children without overriding authored names; and — fixing a latent bug in the spike copies — orders siblings by each parent's `childIds` (Chromium's document order), not the interleaved flat-list order of the raw payload. Tested against a recorded Chromium payload, offline.
