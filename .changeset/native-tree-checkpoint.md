---
"@real-a11y-dev/browser": minor
---

A Node-side tree checkpoint against the native producer — so acting and reporting finally speak the same language.

`captureNativeCheckpoint(tree, url)` holds a native tree in Node; `diffNativeCheckpoint(checkpoint, after, afterUrl)` renders what changed. Both are pure, so the policy is unit-testable with no browser.

The in-page checkpoint (`checkpointTree` / `diffSinceCheckpoint`, which `@real-a11y-dev/testing` still uses) is keyed by realm-bound WeakMap ids, so it dies with the page instance — and it diffs the **DOM** producer's tree while acting targets the **native** one. A user clicks `button "Attach"` and reads a diff in which that node is `textbox "Attach"`. Same element, two vocabularies. Holding the checkpoint here, against the same tree the targeting uses, removes that seam.

**Detecting that the document was replaced** is the load-bearing part: a navigation makes the two trees' ids incomparable, and diffing anyway reports the whole page removed and a new one added. The obvious detector — comparing URLs — is wrong. Measured in real Chromium:

| scenario               | shared ids | url changed | correct verdict |
| ---------------------- | ---------- | ----------- | --------------- |
| same-document mutation | 100%       | no          | diff            |
| SPA `pushState`        | 14%        | **yes**     | **diff**        |
| hash change            | 100%       | **yes**     | **diff**        |
| reload (same URL)      | **0%**     | no          | **replaced**    |
| real navigation        | 0%         | yes         | replaced        |

A URL check gets three of five wrong — it suppresses the diff for a hash change and an SPA route change, where the document survived and the diff is exactly what was asked for, and it emits a garbage diff for a reload. Shared node ids get all five right, and not as a tuned threshold: a replaced document means Chromium allocates every `backendDOMNodeId` afresh, so the overlap is _exactly_ zero, while any same-document change keeps at least the root. `documentWasReplaced` is exported for callers that want the signal alone; all five scenarios are pinned against real Chromium.

Also: a native `ExtractionResult` now sets **`focusedId`**, promoted from Chromium's per-node `focused` AX property. Every focus-aware consumer reads the tree-level pointer — `serializeTree`'s `[focused]` marker and `serializeTreeDiff`'s focus-move line both resolve nodes through it — so without this a native tree knew where focus was and couldn't say so, and a `focus` action diffed to a bare `a11y.states.focused` flip instead of a focus move. When only the document is focused (nothing in the page is), it stays unset rather than naming a node the normalizer dropped.
