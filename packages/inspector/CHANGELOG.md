# @real-a11y-dev/inspector

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

## 0.1.0-beta.13

### Patch Changes

- 80d2b02: Halve the tree-search work done per keystroke. `applySearchFilter` ran the match predicate over the whole tree twice — once inside `searchTree` to build the visible set, then again to count the direct matches — so every character typed into the panel's search box paid for the string matching and `Object.entries` allocation of both passes. The two are now collected in one pass, and the loop that writes `ui.matchesFilter` folds the counting in rather than iterating the tree a second time.

  `searchTree`'s ancestor-marking walk also climbed all the way to the root for every match, re-adding ids it had already marked: O(matches × depth) on a deep tree where the matches share a path. It now stops at the first ancestor already in the set, which is one climb per distinct path segment instead of one per match (and terminates rather than spinning if a malformed tree's `parentId` links form a cycle).

  Behaviour is unchanged — same visible set, same direct-match count. This is the extraction/counting cost only; the panel still filters synchronously on each keystroke, with no input debounce.

## 0.1.0-beta.12

### Patch Changes

- 489cd82: Wire `TreeView` to `LiveTreeExtractor` so inspector / `<SemanticNavigator>` live updates re-extract only dirty subtrees. Previously `TreeView` ignored the `DomObserver` `TreeChange` payload and called `extractA11yTree` / `extractDomTree` on every flush — the residual of audit finding #50 after #182 landed the incremental path for the extension, `useSemanticTree`, and the Storybook preview. Each flush now snapshots the result Map so a diff checkpoint baseline cannot be mutated by a later incremental splice. Inspector is re-released because it bundles the UI package (size budget 31 → 32.5 KB gzipped — TreeView now pulls LiveTreeExtractor into the inspector bundle).
- 96aee1f: Preserve the user's tree expand/collapse across live DomObserver updates. `TreeView` (inspector / `<SemanticNavigator>`) and the Storybook manager panel now run `preserveExpandedState` before adopting a new extraction — without it, a11y-mode rebuilds reset every node to the depth heuristic, so a collapse-all (or any deep expand) snapped back on the next host-page mutation. New export: `preserveExpandedState(prev, next)`. Inspector and storybook-addon are re-released because they bundle the UI package (inspector size budget 32.5 → 32.6 KB gzipped).
- 0aa67f4: Let keyboard users decrement sliders/spinbuttons. The ▼/▲ stepper buttons are mouse-only (`tabIndex={-1}`), and Enter always hit `getPrimaryAction` which prefers `increment` — so a keyboard-only panel user could raise a value but never lower it. `+`/`=` now increment, `-`/`_` and `Shift+Enter` decrement (tree + form filtered list).
- a67fd38: fix(ui): silence the benign "ResizeObserver loop completed with undelivered notifications" warning from the virtualized tree. The observer's re-measure now defers to a single `requestAnimationFrame`, breaking the synchronous observe→setState→relayout loop that Chromium reports (and which showed up in the extension's Errors panel). No behavior change to virtualization.

## 0.1.0-beta.11

### Patch Changes

- 35e99e6: Fix three ways the embeddable inspector stopped reacting after mount: a floating `<SemanticNavigator>` rendered an **empty panel** when its root ref was already set (the common `{open && <SemanticNavigator floating />}` toggle), `InspectorInstance.setViewMode()` and the `mode` prop left the rendered tree on the old view while `getTree()` already reported the new one, and `useSemanticTree`/`useActiveModal` never attached to a root that mounted after the first commit and kept observing a **replaced** root. `useSemanticTree` and `useActiveModal` now also accept the element itself (new `SemanticTreeTarget` type) — pass an element from a callback ref when the root mounts late or can be swapped; existing ref-object callers are unchanged.
- c9c5076: Stop shipping the stylesheet twice. `__SN_STYLES__` is an esbuild `define`, so **every** occurrence of the identifier was replaced with the entire stylesheet literal at build time — and the inspector read it at two injection sites (shadow root and light DOM). The bundle therefore carried two complete copies of the CSS, which gzip could not fold together because they sit further apart than its window.

  The define is now bound to a module-level constant that both paths read. Behavior is unchanged; the bundle drops by roughly 32 kB raw / 5 kB gzipped.

## 0.1.0-beta.9

### Patch Changes

- Re-release so the bundled `@real-a11y-dev/core` picks up the modal-dialog scoping fix (#107 — only pivot to genuinely modal dialogs, not any `role="dialog"`). Both packages inline core at build time (`tsup` `noExternal`), so a rebuild is required to ship the fix — a version-only bump of core wouldn't reach them.

## 0.1.0-beta.8

### Patch Changes

- Re-release to pick up this cycle's `@real-a11y-dev/core` and `@real-a11y-dev/semantic-navigator-ui` fixes, which the inspector bundles at build time (`noExternal`): aria-labelledby-before-aria-label precedence, the accname self-reference cycle guard, name-from-content for named widgets, sensitive-value redaction, accessible-name normalization, and the element-picker button fix. No inspector API changes — the previously published build shipped the older bundled engine.

## 0.1.0-beta.6

### Minor Changes

- 488ca27: Add the DevTools-style element picker to the React inline panel.
  Same UX as the Chrome extension's picker (toolbar `⦿` button +
  `Ctrl/Cmd+Shift+C` shortcut + crosshair cursor + capture-phase
  clicks that `preventDefault` the page handler); when the user
  clicks an element on the host page, the matching tree row is
  selected and scrolled into view.

  Public surface changes:
  - `@real-a11y-dev/core` exports `createPicker(options)` returning
    `{ isEnabled, setEnabled, teardown }`. Moved from
    `@real-a11y-dev/semantic-navigator-extension` (which was private,
    so this is a pure additive export). `SemanticNavigatorConfig`
    gains `enablePicker?: boolean` (default `false`).
  - `@real-a11y-dev/semantic-navigator-ui` — `TreeView`, `TreePanel`,
    and `TreeToolbar` accept `enablePicker` / `pickModeOn` /
    `onTogglePickMode` / `pickedNodeId` / `onPickedNodeHandled`.
    `.sn-pick-btn` styles (shipped earlier with the extension fix in
    PR #81) now have a consumer here too.
  - `@real-a11y-dev/inspector` — `createInspector` reads the new
    `enablePicker` flag from the config and passes it to TreeView.
  - `@real-a11y-dev/react` — `<SemanticNavigator>` gains the matching
    `enablePicker` prop.

  The Chrome extension was already a consumer of `createPicker` and
  now imports it from `@real-a11y-dev/core` instead of its own local
  copy. No behavior change there — same module, same tests, same
  coverage.

  `examples/react-app` flips `enablePicker={true}` so the demo
  surfaces the button. Click `⦿`, hover the page, click any element
  — the panel jumps to the row.
