# @real-a11y-dev/inspector

## 0.1.0-beta.16

### Minor Changes

- 5b58757: Add `label-title-only`, an axe-aligned warning for form controls whose only label is `title` or `aria-describedby`.

  `no-unlabeled-interactive` still fails only on an empty accessible name — glyph buttons and `title=` on a `<button>` pass, matching axe `button-name`. Placeholder-only inputs are out of scope for the new rule, matching axe. The new id is selectable via `collectFindings` / `--rules` / `audit_page`; `assertNoUnlabeledInteractive` is unchanged.

### Patch Changes

- 2f811cb: Point the close-tab button's focus ring at a custom property that exists. The
  shared `tree.css` these packages bundle styled `.sn-close-tab-btn:focus-visible`
  with `outline: 2px solid var(--sn-focus-ring)`, but no stylesheet in the repo
  ever declared `--sn-focus-ring` — every other `:focus-visible` rule uses
  `--sn-border-focus`. An undefined custom property is invalid at computed-value
  time, so the whole `outline` declaration was discarded and the property fell
  back to `none`, suppressing the browser's own focus ring along with the intended
  one. The control the rule applies to is rendered by the extension's page header,
  so the visible fix lands there, but the broken declaration shipped in every
  bundle of the stylesheet. `tree.css.test.ts` now fails if any `var(--…)` in the
  stylesheet names a property that is declared nowhere and has no fallback.
- e24f436: Never widen extraction away from a root that isn't in the document.

  Extraction widens to the whole document when a portal-mounted overlay sits
  outside the root — so a React-portalled menu joins the tree with its trigger.
  For an **attached** root that is loss-free: the document contains it, so
  widening only adds.

  For a root the document does **not** contain it is not. The document is then a
  disjoint tree, so the caller's own subtree disappeared and the audit described
  markup they never passed. That covers two shapes: a detached root, and a root
  inside a **shadow root** — `isConnected` is shadow-including while the walk
  reads light-DOM `children`, so a web component audited at its shadow subtree
  lost all of its content to any light-DOM toast.

  ```js
  document.body.innerHTML = '<p role="status">4 tickets</p>';
  const root = document.createElement("div");
  root.innerHTML = "<button>Save</button>";

  auditSnapshot(root); // → 'status "4 tickets"' — the button is absent
  collectFindings(root); // → []  ← reads as a clean component
  ```

  That last line is the damage: an audit that reports nothing because it ran
  against somebody else's DOM. Detached roots are ordinary — a jsdom fixture
  built with `createElement`, or a component inspected before mount.

  Both widening paths are fixed, not just the portal one: the modal path never
  looked at the root at all, so an open dialog anywhere in the document hijacked
  a detached or shadow-rooted root just as readily, and it runs first. A modal
  still scopes **exclusively** over a root the document contains, including a
  sibling one — content behind a modal is inert to AT, and that is deliberate.

  An **ancestor** live region is no longer treated as a portal either. "Outside
  the root" was accepting anything above it too, so the route announcer that
  Next.js, Remix and React Router wrap around the whole app matched on every
  extraction — pivoting every component root on the page permanently, not just
  while a toast was up.

  Three narrower corrections in the same check:

  - **`aria-live` is an allowlist.** It matched the attribute's _presence_, and
    component kits ship exactly that shell — a permanent body-level announcer
    with updates switched off until needed. `polite`/`assertive` pivot; `off`
    does not; anything absent, empty or invalid falls through to the role's
    implicit politeness, per ARIA. `!== "off"` was a denylist, so `none`,
    `false`, `0` and a typo'd `polit` — the hand-written spellings of "switched
    off" — all pivoted. An explicit value also beats a role's implicit
    politeness, so `<div role="status" aria-live="off">` is inert too.
  - **A `role` token list is read as a list**, and case is **not** folded. The
    selector matched `role` exactly, so `role="status announcer"` was invisible;
    it now decides on the first token, the same parse `getImplicitRole` uses, so
    the pivot and the extracted tree always agree about what an element is.
    Folding made `<div role="MENU" aria-live="off">` an overlay — it matched the
    container check before the `off` check — giving one element opposite scoping
    depending on an unrelated attribute.
  - **The rule lives in one place now.** The same selector existed as a
    hand-copied string in three files; the fix landing in one of them meant a
    `role="status announcer"` toast pivoted a one-shot `auditSnapshot` while
    never waking the inspector, the extension or a live MCP session — the same
    DOM producing two different trees depending on which path ran.

  Unchanged: an attached root still widens for a genuine portal, and still scopes
  exclusively to an open modal. The remaining sharp edge — an _ordinary_ in-page
  live region widening an attached root, since "outside the root" cannot tell it
  from a portal — is now documented under Troubleshooting rather than silent.

- 2c525d7: fix: name tables from `<caption>`, refuse dispatch on a disconnected node, and stop `expectTree` dumping both full trees.

  A `<table>` with a `<caption>` was extracted as unnamed, which is wrong per HTML-AAM and reported as an ARIA violation. The caption now supplies the name when it is visible and non-empty; a hidden or empty caption falls through (so `title` can still win); and when `aria-label` / `aria-labelledby` already names the table, the caption's words stay in the tree instead of being deleted. The live extractor learns the same owner→child edges for `fieldset`/`legend` and `details`/`summary`, so a caption edit no longer leaves a stale table name.

  `dispatch` now fails when the resolved element is disconnected — replacing `document.body.innerHTML` used to leave a detached node that still accepted events and returned `{ success: true }`.

  `flow.expectTree` (and the string form of `expectChanges`) keep the first-difference pointer and drop the two full-tree dumps that followed it.

- 43364f5: Internal stylesheet change, no behaviour change for these packages. The shared
  `tree.css` they bundle gains collapse rules for live-region containers that are
  mounted while still empty (`.sn-search-count:empty`, `.sn-live-log:empty`) and
  splits the action-feedback bar's paint onto an inner `.sn-action-feedback-text`
  so its flash still replays. Only the Chrome extension renders those containers
  today, so nothing these packages render changes; the inspector's size budget
  moves 33.5 kB → 33.8 kB to cover the added rules.
- c26c0a1: Fix the row highlight that plays after a cross-link jump. The shared `tree.css`
  these packages bundle declared `@keyframes sn-flash` twice — once as the
  accent-background flash for `.sn-node--flash`, and again further down as the
  slide-up used by the action-feedback bar and the live-announcement log. The last
  declaration of a name wins in CSS, so the row that a cross-link chip jumped to
  translated a full row height up from below over 700ms instead of tinting and
  fading in place. The node flash is now `@keyframes sn-node-flash`, leaving the
  slide-up to its two intended callers.
- 19e0fe8: Stop reporting native HTML as broken ARIA — and let authored ARIA actually be
  satisfied.

  `toBeValidA11yTree()` judged every node by the rules for an authored role.
  `aria-query` genuinely marks `aria-checked` required on checkbox,
  `aria-expanded` + `aria-controls` on combobox and `aria-selected` on option —
  correct when someone wrote `role="combobox"` on a `<div>`, because nothing else
  supplies them. Applied to a `<select>` it produced six violations on markup
  that is not merely valid but preferable, including `option` nested inside
  `combobox`, which is exactly how a `<select>` is built.

  The discriminator is **"does the user agent supply this state?"**, not "did
  somebody type a `role=` attribute". Those diverge on ordinary markup:

  - `<select role="combobox">` is redundant, changes nothing about the browser,
    and design systems produce it by spreading `role` through props.
  - `<input type="checkbox" role="switch">` is the ARIA-APG canonical switch,
    where the role is neither redundant nor deletable — and checkedness is still
    UA-supplied.

  `ValidatedNode` gains `uaSuppliedAttrs` (per-attribute, since an element can
  supply one state and still owe another) governing required attributes, and
  `implicitRole` governing structure. Both are optional and absent fails
  **closed**, so an adapter that cannot inspect the element keeps reporting rather
  than silently disabling the rule.

  Three fixes make authored ARIA satisfiable at all — previously it could not go
  green no matter what the author wrote:

  - Required attributes are now read from the element's recorded attributes when
    the extracted state map doesn't carry them. `aria-controls` and
    `aria-valuenow` live in neither `A11yInfo.states` (a fixed 10-entry set) nor
    `properties` (`{level, captions}`), so a correct authored combobox or slider
    reported a violation with no remedy available.
  - `aria-valuenow` / `aria-valuemin` / `aria-valuemax` are now recorded, for the
    same reason — nothing else carried them.
  - A **`false`** value counts as present, not missing. `aria-expanded="false"` is
    a collapsed combobox and `aria-checked="false"` an unchecked box: the ordinary
    states, and previously unsatisfiable.

  Two more from the same class:

  - **Engine vocabulary is no longer reported as an invalid ARIA role.** A
    `<video controls>` extracts as `video`, which is not in the ARIA role set, and
    the check returned early — so no other rule ran on the node either and a page
    containing a `<video>` could not use the matcher at all. Only an _authored_
    role can be invalid ARIA.
  - **An exempt native pair no longer ends the ancestor walk.** In
    `<div role="button"><select><option>`, the option is legitimately inside its
    select and illegitimately inside the button, which was never tested.

  Real problems are still caught: an unnamed `<select>`, an unnamed `<table>`, a
  link nested inside a button, an authored bogus role, and any hand-built role
  that omits a state no user agent supplies.

  The patch bumps are the three packages that bundle `core`'s **DOM** producer,
  which is what `KEY_ATTRIBUTES` feeds. `cli` and `mcp` build their trees with the
  native producer, which keeps its own attribute allowlist, so they are untouched.

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
