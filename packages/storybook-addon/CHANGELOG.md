# @real-a11y-dev/storybook-addon

## 0.1.0-beta.15

### Minor Changes

- 1e64037: Stop publishing `@real-a11y-dev/core`; the extraction engine is internal now.

  It was the first package on npm and it is the last to go internal. Nobody installs an extraction engine on purpose — they install a matcher, a panel, a command, or a server, and the engine arrives inside it. Every published package already bundled it in practice; this makes that official. With it, the published set is **six packages**, down from thirteen.

  **Nothing changes for you unless you imported `@real-a11y-dev/core` directly.** It moves to `devDependencies` and is bundled into all six, so they install fewer packages, not more — and each carries the exact engine version it was tested against, which is what `noExternal` already gave you unofficially.

  If you did import it directly (last published `0.1.0-beta.13`), 19 of its 69 names keep a published home:

  - `@real-a11y-dev/testing` re-exports the query and diff vocabulary — `findByRole`, `findAllByRole`, `diffTrees`, `getOutline`, `getTabSequence`, `linearize`, `ROLE_FILTER_GROUPS` — with `SemanticNode`, `ExtractionResult`, `TreeDiff`, `NodeChange`, `OutlineEntry`, `RoleFilter`, `FindByRoleOptions`, `ActionType` and `ActionResult`.
  - `@real-a11y-dev/react` and `@real-a11y-dev/inspector` re-export the node, action and config types their own signatures name: `SemanticNode`, `ExtractionResult`, `TreeViewMode`, `ActionRequest`, `ActionResult`, plus `SemanticNavigatorConfig` on the inspector.

  **The other 50 have no drop-in, and two of them are a real capability leaving: `extractA11yTree` and `extractDomTree`.** Building your own published tooling directly on the engine was a documented path in the getting-started guide, and it is not one any more. The replacement is a surface that carries the engine rather than an import: `real-a11y` for the shell and CI (`--format json`, `-o`), the MCP tools for an agent, `attach(page)` from `@real-a11y-dev/testing/playwright` for a Playwright suite, or `createInspector` / `<SemanticNavigator />` for a UI. Also gone without replacement: the live machinery (`LiveTreeExtractor`, `DomObserver`, `FocusManager`, `ActionDispatcher`, `createPicker`) and the native-AX vocabulary.

  Two consumers changed shape rather than just moving a dependency line. `react` externalized `core` and now bundles it, and `storybook-addon`'s `index` entry listed it under `external` — correct while core was published, wrong the moment it wasn't, since npm cannot resolve a private package in the JS or in the types. Both entries genuinely need it: `react`'s `index.ts` re-exports core types and `useActiveModal` imports the _value_ `findByRole`, and `storybook-addon`'s `TreeMode` **is** core's `TreeViewMode`.

  `inspector` had a latent version of the same gap — `noExternal` without the matching `dts.resolve` — which was harmless only because core was still published. Both halves are now paired everywhere.

### Patch Changes

- e5ea95a: Share the node-id registry and the element reference map across every copy of the engine in a realm.

  Both were plain module-scope state — `const elementRefs = new ElementRefMap()` and a `let counter` beside a `WeakMap<Node, string>`. That is correct while exactly one copy of the engine is loaded, and only then.

  More than one copy is the normal case. `@real-a11y-dev/inspector` already bundles the engine rather than importing it, and the same is true of the extension; anything that bundles it gets a private registry. When a node crosses that boundary the ids stop meaning the same thing: `dispatch()` in `@real-a11y-dev/testing` turns a node id back into a live `Element` through the ref map, so an extraction recorded in one copy is invisible to an action performed by another. The lookup misses, `dispatch` returns without doing anything, and nothing reports an error — a Radix slider stepped with `dispatch(slider, "decrement")` simply stays at 50. The id counter has the matching failure: two copies both start at zero and both hand out `sn-0`, for different nodes.

  Both now live in a realm-wide registry keyed by `Symbol.for()`, so every copy in the realm resolves the same object. Realm rather than process is the right scope — an iframe or a worker gets its own, which matches the DOM it describes, since `Element` identity does not cross those either.

  > **Retargeted when `core` went private.** This entry named `core` itself while
  > the engine was still published, and dependents would have cascaded from its
  > bump. A private package has no version to cascade from, so the consumers are
  > named directly — all six, because every published package bundles the engine
  > and the fix has to reach every tarball. Left as it was, it would also have
  > mixed an ignored package with non-ignored ones and thrown at
  > `changeset version`, breaking the release cut.

  No API change: `getElementRefs()`, `getNodeId()` and `resetIdCounter()` keep their signatures and their behaviour, including `resetIdCounter()` resetting only the counter and deliberately keeping the node→id map.

- c8cf5a3: fix(ui): cancel the virtualized tree's pending re-measure frame on teardown. The ResizeObserver defers its re-measure by one `requestAnimationFrame`, and `disconnect()` does not cancel a frame already queued — so in a real browser the callback could still run after the component went away. The frame is now cancelled with the observer. (Test-only companion: every jsdom suite that renders Preact now shares one raf/cancelAnimationFrame setup file, so Preact's own scheduler can't throw after environment teardown.)
- Updated dependencies [e5ea95a]
- Updated dependencies [1e64037]
  - @real-a11y-dev/testing@0.1.0-beta.15

## 0.1.0-beta.14

### Patch Changes

- Updated dependencies [680efd2]
  - @real-a11y-dev/testing@0.1.0-beta.14

## 0.1.0-beta.13

### Patch Changes

- Updated dependencies [f54f398]
- Updated dependencies [80d2b02]
  - @real-a11y-dev/testing@0.1.0-beta.13
  - @real-a11y-dev/core@0.1.0-beta.13

## 0.1.0-beta.12

### Minor Changes

- 4eff732: Stop publishing `@real-a11y-dev/validate` and `@real-a11y-dev/semantic-navigator-ui`; they are internal now.

  Neither was ever a package anyone was told to install. Nothing on the website recommended either one — the only `npm install` lines for them were in their own READMEs — and no published `.d.ts` referenced their types. `semantic-navigator-ui` was already bundled by every consumer that uses it (`inspector` doesn't even declare it as a dependency), so for that one this mostly writes down what the build already did.

  **Nothing changes for you unless you imported one directly.** They move from `dependencies` to `devDependencies` and are bundled into the packages that use them, so `@real-a11y-dev/testing` and `@real-a11y-dev/storybook-addon` now install _fewer_ packages, not more. The trade is real, though: those packages come off your install, and ~218 KB goes into `@real-a11y-dev/testing`'s `matchers` entry, which now carries `aria-query`'s role tables inline — ~15x raw, 4.8x gzipped. Nothing had been measuring that: the only `testing` entry in `.size-limit.json` pointed at `dist/index.js`, which never imported `validate`, so `pnpm size` stayed green by construction rather than by measurement. This adds a budget for `dist/matchers.js` so the number that actually moved is governed. If your suite also uses `@testing-library/dom`, you already had two copies of `aria-query` on disk (it pins `5.3.0`; `validate` asked for `^5.3.2`) — what changes is that the second copy is now frozen inside our entry, past the module boundary, where an `overrides`/`resolutions` pin can no longer collapse them.

  If you did import one directly:

  - `@real-a11y-dev/validate` (last published `0.1.0-beta.7`) → its rules reach you through `@real-a11y-dev/testing`'s `toBeValidA11yTree` matcher. The role-metadata helpers it also exported (`roleMeta`, `isValidRole`, `attributesForRole`, `requiredOwnedRoles`, …) have no published replacement — open an issue if you were using them directly.
  - `@real-a11y-dev/semantic-navigator-ui` (last published `0.1.0-beta.11`) → use `@real-a11y-dev/inspector`, `@real-a11y-dev/react`, or `@real-a11y-dev/storybook-addon`, each of which bundles the components.

  No shipped `.d.ts` names a package npm cannot resolve. Neither consumer's public surface exposes a private type today, so nothing needs inlining yet; `dts.resolve` is configured on both so it stays that way if one ever does, and `surface:check` fails if that regresses.

### Patch Changes

- 96aee1f: Preserve the user's tree expand/collapse across live DomObserver updates. `TreeView` (inspector / `<SemanticNavigator>`) and the Storybook manager panel now run `preserveExpandedState` before adopting a new extraction — without it, a11y-mode rebuilds reset every node to the depth heuristic, so a collapse-all (or any deep expand) snapped back on the next host-page mutation. New export: `preserveExpandedState(prev, next)`. Inspector and storybook-addon are re-released because they bundle the UI package (inspector size budget 32.5 → 32.6 KB gzipped).
- 0aa67f4: Let keyboard users decrement sliders/spinbuttons. The ▼/▲ stepper buttons are mouse-only (`tabIndex={-1}`), and Enter always hit `getPrimaryAction` which prefers `increment` — so a keyboard-only panel user could raise a value but never lower it. `+`/`=` now increment, `-`/`_` and `Shift+Enter` decrement (tree + form filtered list).
- a67fd38: fix(ui): silence the benign "ResizeObserver loop completed with undelivered notifications" warning from the virtualized tree. The observer's re-measure now defers to a single `requestAnimationFrame`, breaking the synchronous observe→setState→relayout loop that Chromium reports (and which showed up in the extension's Errors panel). No behavior change to virtualization.
- Updated dependencies [e4e9c89]
- Updated dependencies [cd20458]
- Updated dependencies [229c5ac]
- Updated dependencies [c15960d]
- Updated dependencies [4aa1036]
- Updated dependencies [b304069]
- Updated dependencies [2f2ab7b]
- Updated dependencies [1ef740a]
- Updated dependencies [3b4967b]
- Updated dependencies [4d982ce]
- Updated dependencies [4eff732]
- Updated dependencies [a4cfac8]
- Updated dependencies [3ab20f2]
  - @real-a11y-dev/core@0.1.0-beta.12
  - @real-a11y-dev/testing@0.1.0-beta.12

## 0.1.0-beta.11

### Minor Changes

- 907c68e: Add `LiveTreeExtractor` for incremental DOM and accessibility tree updates.

  `@real-a11y-dev/core` now exposes a `LiveTreeExtractor` class that keeps the
  previous extraction in memory and re-extracts only the dirty subtrees reported
  by `DomObserver`. It falls back to a full extraction when a mutation can affect
  non-local accessibility state (modal/portal scope, `id`, `aria-labelledby`,
  `aria-describedby`, `for`, etc.). The result is the same `ExtractionResult`
  shape as `extractA11yTree` / `extractDomTree`.

  `DomObserver` callbacks now receive an optional `TreeChange` payload containing
  the accumulated `MutationRecord`s and synthetic dirty roots from `input`/`change`
  events, which `LiveTreeExtractor.refresh(change)` consumes.

  The Chrome extension, React `useSemanticTree` hook, and Storybook addon preview
  have been wired to use `LiveTreeExtractor` so live updates avoid a full page
  re-extraction when only a small region changed.

- f9e35c2: Make Storybook preview extraction lazy: the DomObserver / LiveTreeExtractor only run while the Semantic Navigator panel is open. The manager emits `REQUEST_TREE` on mount and `STOP_TREE` on unmount. After a canvas/iframe reload the preview emits `PREVIEW_READY` so an already-open panel can re-request without listening to every `storyRendered` (which would double-extract). `storyRendered` / `storyChanged` in the preview no longer start the pipeline unconditionally — registering the addon no longer means every Controls-driven or animated story pays full-tree extract + channel `postMessage` cost while you're on another tab. Custom channel listeners that assumed always-on `TREE_UPDATED` should open the panel (or emit `REQUEST_TREE`) to start receiving updates.

### Patch Changes

- Updated dependencies [1d0eef0]
- Updated dependencies [7f93f92]
- Updated dependencies [6a658fe]
- Updated dependencies [cafe048]
- Updated dependencies [725fcc0]
- Updated dependencies [e2eca34]
- Updated dependencies [96cb0ee]
- Updated dependencies [7a9b870]
- Updated dependencies [f2532e5]
- Updated dependencies [ad8edc1]
- Updated dependencies [d657f66]
- Updated dependencies [1c8a523]
- Updated dependencies [acb8931]
- Updated dependencies [17f8df4]
- Updated dependencies [d693a00]
- Updated dependencies [35e99e6]
- Updated dependencies [907c68e]
- Updated dependencies [7d8324d]
- Updated dependencies [1a3d813]
- Updated dependencies [19e9fc2]
- Updated dependencies [a32632a]
- Updated dependencies [a12e7f2]
- Updated dependencies [e2df9ec]
- Updated dependencies [beae032]
- Updated dependencies [0a7a821]
- Updated dependencies [13bacb2]
- Updated dependencies [bfec7a0]
- Updated dependencies [c9c5076]
- Updated dependencies [0e7ffc4]
  - @real-a11y-dev/testing@0.1.0-beta.11
  - @real-a11y-dev/core@0.1.0-beta.11
  - @real-a11y-dev/semantic-navigator-ui@0.1.0-beta.11

## 0.1.0-beta.10

### Patch Changes

- Updated dependencies [d8eaaf7]
- Updated dependencies [7a56937]
- Updated dependencies [fcd4bc9]
  - @real-a11y-dev/testing@0.1.0-beta.10
  - @real-a11y-dev/core@0.1.0-beta.10
  - @real-a11y-dev/semantic-navigator-ui@0.1.0-beta.10

## 0.1.0-beta.9

### Patch Changes

- Re-release so the bundled `@real-a11y-dev/core` picks up the modal-dialog scoping fix (#107 — only pivot to genuinely modal dialogs, not any `role="dialog"`). Both packages inline core at build time (`tsup` `noExternal`), so a rebuild is required to ship the fix — a version-only bump of core wouldn't reach them.
- Updated dependencies [3607ac4]
  - @real-a11y-dev/core@0.1.0-beta.9
  - @real-a11y-dev/testing@0.1.0-beta.9
  - @real-a11y-dev/semantic-navigator-ui@0.1.0-beta.9

## 0.1.0-beta.7

### Patch Changes

- Updated dependencies [8c230cb]
- Updated dependencies [c7af39c]
- Updated dependencies [7df0e4d]
- Updated dependencies [088a142]
- Updated dependencies [771f034]
- Updated dependencies [7df0e4d]
- Updated dependencies [194b6ad]
- Updated dependencies [1270667]
  - @real-a11y-dev/core@0.1.0-beta.7
  - @real-a11y-dev/testing@0.1.0-beta.7
  - @real-a11y-dev/semantic-navigator-ui@0.1.0-beta.7

## 0.1.0-beta.6

### Patch Changes

- cdb26ca: Fix the Storybook addon reporting "Empty tree" (and missing live state
  updates) for stories that render multiple sibling root elements. The
  previous root picker used `firstElementChild` of `#storybook-root`,
  which lands on React Aria's collection-builder `<template>` for
  patterns like `<Tree>`, `<ListBox>`, and `<ComboBox>` — the extractor
  walked an empty subtree and the `DomObserver` scoped to that template
  never fired re-extracts on selection changes.

  `getStoryRoot` (now a pure `pickStoryRoot(doc)` helper for testability)
  filters out non-rendered tags (`<template>`, `<script>`, `<style>`,
  `<noscript>`) when deciding the root:
  - **Exactly one real child** → use it (preserves the clean tree for
    plain single-root stories like `<Button>`).
  - **Zero or 2+ real children** → use `#storybook-root` itself so the
    observer sees all siblings (React Aria patterns, React Portal
    hoisting, empty mid-render, etc.).

  Adds 8 regression tests in `pick-story-root.test.ts` covering each
  branch.

- Updated dependencies [488ca27]
- Updated dependencies [edf86b6]
- Updated dependencies [d583a91]
- Updated dependencies [80dc889]
- Updated dependencies [a44004c]
- Updated dependencies [c2fb61b]
  - @real-a11y-dev/core@0.1.0-beta.6
  - @real-a11y-dev/semantic-navigator-ui@0.1.0-beta.6
  - @real-a11y-dev/testing@0.1.0-beta.6
