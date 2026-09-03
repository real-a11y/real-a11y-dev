# @real-a11y-dev/testing

## 0.1.0-beta.16

### Minor Changes

- 69a9f90: Reject input that isn't a tree, instead of reporting it as a clean page.

  Every entry point that accepts `Element | ExtractionResult` resolved the second
  branch with an unchecked cast, so anything that wasn't an `Element` — a number,
  a string, `{}`, a `Date` — became an empty tree. The rules then found nothing
  and the assertion **passed**:

  ```js
  assertNoUnlabeledInteractive(42); // passed silently
  collectFindings(42); // 2 findings, about the number
  assertLandmarkStructure(42); // threw "Missing <main>" — about the number
  auditSnapshot(42); // ""  ← committed, this is a permanently green test
  ```

  The matcher layer already guarded this (`expected a DOM Element, received
number`); the `assert*`, `collectFindings`, `listByRole` and `serialize*`
  layers did not. They now throw a `TypeError` naming the function called and the
  type received:

  ```
  assertNoUnlabeledInteractive: expected a DOM Element or an extracted a11y tree, received number
  ```

  It is a `TypeError`, never an `A11yAssertionError` — code catching the latter is
  handling "this page has issues", and a wrong argument is not that. The message
  names the received **type** and never its value, since what lands there by
  mistake is often page text or a token.

  Unknown rule ids are rejected the same way. `A11yRule` protects a TypeScript
  caller writing a literal, but a list built from a config file, a CLI flag or
  plain JavaScript reached the runtime unchecked, matched no rules, and passed
  having checked nothing — a typo silently deleted the check:

  ```js
  assertRules(page, ["landmark_structure"]); // passed; the real id is landmark-structure
  // now: unknown rule "landmark_structure". Known rules: no-unlabeled-interactive, …
  ```

  `formatFindings([])` now reads `No accessibility issues found.` rather than
  `Found 0 accessibility issues:` with nothing under it.

  **Breaking change.** A call that previously passed can now throw. In every case
  the call was already not testing anything — a suite that goes red here was
  green while asserting nothing — but it is a behaviour change and can surface as
  a newly failing test. Genuine inputs are unaffected: a DOM `Element` and a real
  `ExtractionResult` (including a native tree from CDP) behave exactly as before.
  The tree check is structural rather than `instanceof`, so a tree that crossed a
  realm — an iframe, a worker, a second bundled copy of the engine — still passes.

- 5b58757: Add `label-title-only`, an axe-aligned warning for form controls whose only label is `title` or `aria-describedby`.

  `no-unlabeled-interactive` still fails only on an empty accessible name — glyph buttons and `title=` on a `<button>` pass, matching axe `button-name`. Placeholder-only inputs are out of scope for the new rule, matching axe. The new id is selectable via `collectFindings` / `--rules` / `audit_page`; `assertNoUnlabeledInteractive` is unchanged.

- 562d600: Make every matcher type augmentation opt-in, adding `./matchers/jest` and `./matchers/jest-globals`

  `@real-a11y-dev/testing/matchers` shipped an unconditional
  `declare global { namespace jest }`. Jest consumers got the matcher types for
  free — and Vitest consumers got them whether they wanted them or not, because
  Vitest's `Assertion` extends `JestAssertion`, which extends `jest.Matchers`. So
  a Vitest project that imported `./matchers` and `./matchers/vitest`, as the docs
  instruct, declared every matcher name twice from two augmentations TypeScript
  could not prove identical:

  ```
  error TS2320: Interface 'Assertion<T>' cannot simultaneously extend types
  'JestAssertion<T>' and 'A11yMatchers<T>'.
  ```

  One error per matcher, reported against a file inside `node_modules`. Two
  things kept it quiet: it needs `skipLibCheck: false`, and it needs TypeScript 7
  — 5.x does not report it on the same project and the same package.

  The underlying cause was a type-parameter mix-up in the Vitest entry, which is
  fixed too: `A11yMatchers`' parameter is the matcher's RETURN type, and the entry
  was passing it the SUBJECT type, so the matchers were declared returning
  `HTMLElement` on our side and `void` on Vitest's, which inherits
  `jest.Matchers<void, T>`. "Not identical" was a correct diagnosis. They agree on
  `void` now — matching what both runners say about their own matchers — so
  loading more than one entry is redundant rather than an error.

  Jest's augmentation now lives in its own entry, mirroring `./matchers/vitest`.
  There are two, because Jest has two `expect`s with separate type surfaces:

  - **`./matchers/jest`** — the global `expect`, typed by `@types/jest`
  - **`./matchers/jest-globals`** — `import { expect } from "@jest/globals"`,
    typed by `@jest/expect`. The old unconditional global never covered this
    shape at all, so this half is a gap closed rather than one opened

  None of the three ships runtime code; `registerA11yMatchers(expect)` is still
  what installs the matchers.

  ## Breaking change

  **Anyone whose matcher types came from the free global must add one import** —
  alongside the `registerA11yMatchers` call in their setup file:

  ```ts
  import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
  import "@real-a11y-dev/testing/matchers/jest"; // ← add this
  // …or "…/matchers/jest-globals" if you import `expect` from "@jest/globals"
  // …or "…/matchers/vitest" on Vitest

  registerA11yMatchers(expect);
  ```

  That is every Jest + TypeScript user, and also **Vitest users who never
  imported `./matchers/vitest`** — the removed jest global reached Vitest's
  `Assertion` through `JestAssertion`, so those projects type-checked without it
  and will now report `TS2339` on each matcher. Vitest setups that already carry
  the documented `./matchers/vitest` line need no change and lose the TS2320
  errors.

  In every case the matchers still RUN — registration is unchanged and no
  behaviour moved. Only the types are affected.

  One more type-level change, which no call site should notice: matchers typed
  through `./matchers/vitest` now return `void` rather than the subject type.

- fdaf6d6: Rename the tree-string helper to `treeSnapshot` and the boxed matcher helper to `boxedTreeSnapshot`.

  `auditSnapshot` was a leftover name from before the tree / findings split — it serializes the semantic tree, not an audit. `a11ySnapshot` named the boxed `toMatchSnapshot()` wrapper after the product concept, colliding with that family. The three string views are now `treeSnapshot` / `outlineSnapshot` / `tabSequenceSnapshot`, matching the CLI (`tree` / `outline` / `tabs`). The Playwright handle method and `TreeSnapshotOptions` follow. The in-page bundle export is `treeSnapshot` too.

  **Breaking change.** `auditSnapshot`, `a11ySnapshot`, and `AuditSnapshotOptions` are removed (beta). `a11ySnapshotSerializer` is unchanged — it also renders `a11yDiff` boxes.

  **Migration.** `auditSnapshot(root)` → `treeSnapshot(root)`; `sn.auditSnapshot()` → `sn.treeSnapshot()`; `a11ySnapshot(root)` from `/matchers` → `boxedTreeSnapshot(root)`.

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

### Patch Changes

- 56d5eb2: `--version` and browser commands now resolve Playwright the same way (`createRequire`, which sees `NODE_PATH` and a sibling global). `npm i -g playwright` unblocks a global CLI; `--version` no longer prints a version while `audit` cannot load the driver. The missing-Playwright hint names `npm i -g playwright` when the CLI is not in the current project's `node_modules`.
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

- d687614: Document a quick-start that actually reaches a passing test.

  The install line was `npm install -D @real-a11y-dev/testing` and stopped there.
  That package brings no test runner and no DOM, so following the docs from an
  empty directory got you a dependency and no way to run anything — the two
  load-bearing pieces, a runner plus `jsdom`, and `environment: "jsdom"` in the
  config, were stated nowhere. The first example then used
  `@testing-library/react` without saying it was optional, making the smallest
  working setup look much heavier than it is.

  The README (and `real-a11y.dev/packages/testing`) now carry a two-file
  walkthrough — config plus one test, no framework — that goes from `npm init` to
  a green run, with the exact tree it prints. Verified by following it literally
  in a fresh project rather than from memory.

  Also corrected: the Jest path needs `testEnvironment: "jsdom"`, and Jest does
  not parse TypeScript on its own — a `.ts` test dies in the Babel parser until
  `ts-jest` or `babel-jest` is added, so the transform-free quick-start is a `.js`
  test. That is the kind of omission this change exists to remove, so it is
  spelled out rather than implied.

  A patch release so the corrected README reaches npm, which is where most people
  meet this package first.

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

## 0.1.0-beta.14

### Minor Changes

- 680efd2: Stop publishing `@real-a11y-dev/browser`; it is internal now.

  The Playwright-backed `BrowserSession` was on npm as a way to script audits without an MCP client. That job is the CLI's: `real-a11y audit --format json -o report.json`, `--session` for multi-step flows across commands, the `click` / `focus` / `type` / `interact` verbs, and `diff` for CI. The `browser` package was the seam that made those possible, not a thing anyone adopted on purpose.

  **Nothing changes for you unless you imported it directly.** It moves to `devDependencies` and is bundled into `cli`, `mcp` and `testing`, so those install fewer packages, not more.

  If you did import it directly (last published `0.1.0-beta.13`): `@real-a11y-dev/mcp` re-exports `BrowserSession` along with `A11ySession`, `BrowserSessionOptions`, `PageSnapshot` and `SnapshotOptions`, so the types behind the `SessionManager` contract stay reachable. What is gone is a package you can install to obtain a session — the CLI is the supported route for driving a browser, and `@real-a11y-dev/testing/playwright`'s `attach()` remains public if you bring your own Playwright `Page`.

  **The injected page-bundle is now inlined as source text rather than read from disk.** It used to be located by `new URL("./page-bundle.iife.global.js", import.meta.url)`, which is correct only while `browser` sits beside its own `dist/`. Bundled into a consumer, that resolves inside the consumer's dist where the file is not — so every `attach()` and page open would have failed at runtime, silently, because nothing type-checks a path and `verify` does not run the e2e suites. A lazy, cached `pageBundleSource()` replaces `PAGE_BUNDLE_PATH`; the bundle is embedded once per carrier by a build-time `define`, so a built artifact never touches the filesystem; running from source reads once and caches.

  `@real-a11y-dev/testing` also tightens its optional `playwright` peer from `*` to `>=1.49.0 <2`. That range was `browser`'s, inherited transitively while it was a real dependency; moving it to `devDependencies` dropped it out of testing's published graph, so it is restated directly. If you had `playwright` below 1.49 alongside `testing`, you will now see a peer warning that was always warranted.

  > **Release note.** In prerelease mode the nine retargeted changesets are already
  > consumed, so they surface at `changeset pre exit` rather than at the next beta.
  > This entry is the one that moves a version now.

## 0.1.0-beta.13

### Minor Changes

- f54f398: Stop publishing `@real-a11y-dev/audit`, `@real-a11y-dev/serialize` and `@real-a11y-dev/snapshot`; they are internal now.

  They were on npm because the workspace grew that way, not because anyone chose them as products. None had a documentation page, and nothing on the website recommended installing one. Together they were 95 of the 295 modelled exported symbols.

  **Nothing changes for you unless you imported one directly.** They move from `dependencies` to `devDependencies` and are bundled into the packages that use them, so `browser`, `cli`, `mcp` and `testing` install fewer packages, not more.

  If you did import one directly:

  - `@real-a11y-dev/audit` (last published `0.1.0-beta.12`) → `@real-a11y-dev/testing` re-exports `Finding`, `A11yRule`, `ALL_RULES`, `collectFindings` and the `assert*` primitives. That is the only published home for them — `mcp` names `Finding` in its own signatures but does not re-export it.
  - `@real-a11y-dev/serialize` (last published `0.1.0-beta.12`) → `@real-a11y-dev/testing` re-exports `extract`, `SerializeOptions`, and the `auditSnapshot` / `outlineSnapshot` / `tabSequenceSnapshot` serializers.
  - `@real-a11y-dev/snapshot` (last published `0.1.0-beta.12`) → **there is no drop-in replacement.** The snapshot engine — fingerprints, the diffable `a11y-snapshot.json`, baselines — is now reachable only through the `real-a11y` CLI. `real-a11y snapshot` and `real-a11y diff` take `--format json` and write with `-o`, which is the supported way to drive it from a script or CI. `@real-a11y-dev/mcp` exposes the same engine as MCP tools.

  Every consumer pairs `noExternal` with `dts.resolve`, so no shipped `.d.ts` names a package npm cannot resolve — `surface:check` fails if that regresses, and the packed tarballs were checked directly.

### Patch Changes

- Updated dependencies [f54f398]
- Updated dependencies [80d2b02]
  - @real-a11y-dev/browser@0.1.0-beta.13
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

- a4cfac8: Tab-order serialization is now number-free by default; numbering moves to a render-time step.

  `serializeTabSequence` used to render `01. link "Home"` / `02. button "Go"`. Inserting one focusable element near the top of the page renumbered every following line, so a committed snapshot's diff — and the reviewable unified-diff hunk of `real-a11y diff` — churned the whole view instead of showing the one inserted stop. Line order already conveys the sequence, so the serialized form is now just `link "Home"` / `button "Go"`: the canonical, diff-stable output you store and compare.

  For a human- or agent-read listing where an explicit "stop 7" helps, a new `numberTabStops(tabs)` export re-adds the `NN. ` prefix at **render time** (never stored):

  ```ts
  import {
    serializeTabSequence,
    numberTabStops,
  } from "@real-a11y-dev/serialize";
  numberTabStops(serializeTabSequence(root)); // 01. link "Home"  02. button "Go"
  ```

  Numbering is applied where output is read, not diffed: the CLI `tabs` terminal view, the MCP `get_tab_order` and `inspect_page` tools, and the extension's Markdown export (which stays numbered, matching its on-screen panel). It is absent where output is committed or diffed: `tabSequenceSnapshot()` in `@real-a11y-dev/testing`, the CLI `snapshot`/`inspect` artifacts and JSON, and the browser audit's `tabOrder`. (Also fixes an MCP snapshot summary that reported "0 tab stops" once lines were unnumbered.)

  **Breaking change.** Any committed snapshot of a tab sequence (vitest/jest `toMatchSnapshot`, an inline snapshot, or a golden file / CI artifact) will differ by the removed `NN. ` prefix on every line.

  **Migration.** Either re-generate the affected snapshots (`vitest -u`, `jest -u`, or re-capture the golden file), or wrap the value for display: `numberTabStops(tabSequenceSnapshot(root))`.

  Structural diffing tolerates the transition: `real-a11y diff` still strips leading `NN. ` numbers before comparing, so a base captured by an older numbered tool version diffs cleanly in findings, the multiset view, and the plain-language statements. The one exception is the tabs **hunk** view — a legacy numbered base shows a one-time full rewrite there until it is re-captured. That output is advisory and never gates.

### Patch Changes

- Updated dependencies [37f5859]
- Updated dependencies [37f5859]
- Updated dependencies [4e3c10a]
- Updated dependencies [b2ccee0]
- Updated dependencies [37f5859]
- Updated dependencies [bbbcb04]
- Updated dependencies [823d1cc]
- Updated dependencies [e4e9c89]
- Updated dependencies [cd20458]
- Updated dependencies [229c5ac]
- Updated dependencies [c15960d]
- Updated dependencies [135ccc3]
- Updated dependencies [6785622]
- Updated dependencies [43f085c]
- Updated dependencies [4aa1036]
- Updated dependencies [b304069]
- Updated dependencies [2f2ab7b]
- Updated dependencies [0a41085]
- Updated dependencies [1ef740a]
- Updated dependencies [3b4967b]
- Updated dependencies [4d982ce]
- Updated dependencies [a4cfac8]
- Updated dependencies [3ab20f2]
  - @real-a11y-dev/browser@0.1.0-beta.12
  - @real-a11y-dev/core@0.1.0-beta.12
  - @real-a11y-dev/audit@0.1.0-beta.12
  - @real-a11y-dev/serialize@0.1.0-beta.12

## 0.1.0-beta.11

### Minor Changes

- 1d0eef0: Add a11y **contract verification** — assert that a tree satisfies an authored contract instead of snapshotting the whole thing.

  A contract is a partial tree in the same `role "name" (level N)` grammar the snapshots use. `@real-a11y-dev/testing` gains a `toMatchA11yContract(contract, { strict? })` matcher (the `toMatchObject` of a11y trees): containment by default with ancestor semantics — every contract node must appear, in order, nested under its parent's match, but **extra nodes in the implementation are allowed**, so a contract survives cosmetic churn and fails only on a structural regression (a `<button>` shipped as a `<div>`, a demoted heading, a field that lost its label). Received may be a DOM Element or an already-serialized string, so a committed snapshot artifact can be checked too; names fold typographic punctuation; `strict: true` switches to exact equality. Failures pinpoint the first missing node and why.

  `@real-a11y-dev/serialize` exports `foldTypography` — the accessible-name typography normalizer (curly quotes, ellipsis, dashes, NBSP, NFC), used by the testing package's name matchers at comparison time. Serialized output itself is never folded; it stays faithful to what assistive tech announces.

- 7a9b870: `diff` now shows structural drift as a **real unified diff** — context lines, order, and indentation, like a PR file diff — so a reviewer can see _where_ in the tree a change happened, not just a bare list of added/removed lines. Shown in full by default:

  ````text
  #### home
  ```diff
  @@ -3,7 +3,8 @@
       link "About"
  -    button "Toggle theme"
  +    button "Switch to dark mode"
     main
  +    complementary "Semantic Navigator"
  ```
  ````

  Add **`--explain`** for an opt-in plain-language summary on top — statements a non-expert can act on. The default stays **neutral** (findings + the unified diff, both facts); `--explain` is the interpretive layer (pairing heuristics, cross-view inference), so the default never makes a claim the diff can't back up:

  ```text
  · Heading level changed: "Setup" h2 → h3
  · Keyboard tab stop added: link "Skip" (now stop 2 of 14)
  ```

  The taxonomy covers what assistive-tech users feel: landmarks added/removed/renamed (removing `main` calls out broken skip-links), heading level changes and renames, keyboard tab stops added/removed with their position — including the dangerous variant where the element is **still on the page but no longer keyboard-focusable** — interactive elements outside the tab order, and **pure reorders** of the tab order or heading outline. Anything unrecognized degrades to one honest `Other content changed` rollup — never silence. Rename/level pairings are count-aware and strictly 1:1; ambiguity degrades to add/remove, so the summary never guesses.

  New flags for CI comments (default: full):

  - **`--max-lines <n>`** — cap each page's structural diff to _n_ lines, then `… N more`.
  - **`--max-pages <n>`** — detail the first _n_ changed routes; list the rest.
  - **`--ignore-view-line <regex>`** (repeatable) — drop volatile lines (a "last updated" timestamp, a build hash) before diffing.

  Where it lands:

  - **pretty** — a colored unified diff per changed page; `--explain` adds the `· <statement>` lines; a one-line `--explain` hint otherwise.
  - **md** — a route index (`Pages with a11y changes (N): …`), findings, then (under `--explain`) statements, then the color-coded ` ```diff ` hunks — inline, not in `<details>`, so PR-notification emails keep the green/red. The header names the drift (`… · structure changed on N page(s)`) so a findings-clean-but-structure-moved diff doesn't read as an all-zero "nothing changed".
  - **json** — additive `pages[].structural: [{ kind, view, message, … }]` and `pages[].structuralDiff` (a boolean: does the unified diff have any hunk — the honest "structure changed" signal, since `structural` misses a pure tree reorder), always present regardless of the flags (machine surface); `schemaVersion` stays 1, `pages[].views` untouched.

  The a11y-diff workflow prints the **full uncapped diff to the job log** and posts a capped comment (`--max-pages 5 --max-lines 20`) that links back to it, so the complete diff is always one click away.

  Structural output is advisory by construction: the exit gate never reads it.

  `@real-a11y-dev/testing` newly exports the `INTERACTIVE_ROLES` set and re-exports `ROLE_FILTER_GROUPS` from `@real-a11y-dev/core`, so the CLI's structural summary shares one source of truth for role classification.

- 7d8324d: Stop two ways a test suite could pass while lying to you.

  **Matchers no longer go silent on a wrong-typed value.** The `instanceof Element` guards returned `{ pass: false }`, which is exactly what `.not` inverts — so `expect(container.firstChild).not.toHaveNoUnlabeledInteractive()` reported success without running the audit at all whenever `firstChild` was `null`. The guards now throw (as jest-dom does), which fails in both directions. Covers `toHaveTabSequence`, `toBeValidA11yTree`, `toMatchA11yContract`, and every assertion matcher.

  **A `flow()` chain now executes exactly once.** `then()` called `run()` on every resolution and `run()` replays the whole step array, so `await chain` twice — or `Promise.all([chain, chain])`, or a stray double-await — re-dispatched every prior action: a second click on "Delete", a second form submit, corrupting the state under test. The run is memoized, and adding steps after the chain has been awaited now throws rather than silently doing nothing.

  **Breaking change:** both fixes can turn a currently-green test red.

  _Migration:_ a failure like `expected a DOM Element, received null` means that assertion was never actually running — pass a real element (the classic case is `container.firstChild` where you meant `container`). A failure like `cannot add steps after the chain has been awaited` means steps were being appended to an already-awaited chain; start a new `flow()` for those interactions. No change is needed for matchers given real elements, or for chains awaited once.

- a12e7f2: Make the Playwright adapter work on CSP-protected pages and stop it silently auditing the wrong subtree. `attach()` injected the page bundle with `page.addScriptTag({ content })`, which appends an inline `<script>` — blocked outright by any page whose CSP `script-src` omits `'unsafe-inline'`, i.e. exactly the production-like deployments this adapter exists to audit, and the resulting error never mentioned CSP. The bundle is now injected by evaluating its source, which is not subject to page CSP, and the readiness error points at `bypassCSP` if injection still fails.

  **Breaking change:** a `rootSelector` that matches no element now throws, naming the selector, instead of falling back to `document.body`. Previously a typo'd or since-refactored selector silently audited the entire page, so assertions and snapshots passed while appearing to check one region.

  _Migration:_ if a suite starts failing with `rootSelector "…" matched no element`, that test was auditing the whole document rather than the region it named — fix the selector to match the intended root, or drop the `rootSelector` option entirely to audit the whole page deliberately. No change is needed for any `rootSelector` that already matched an element.

- beae032: `attach(page, { tree: "native" })` — audit a Playwright page against Chromium's **native** accessibility tree.

  The default (`tree: "dom"`, unchanged) injects the page-bundle and walks the light DOM in-page. The new `"native"` mode instead reads Chromium's own accessibility tree over CDP (`@real-a11y-dev/browser`'s `nativeTree`) and runs the same serialize/audit helpers in Node — so it reaches structure no in-page walk can, most visibly a `<video controls>`'s play/scrubber/mute controls, which live in a closed user-agent shadow root. The handle shape is identical: `auditSnapshot`, `outlineSnapshot`, and every `assert*` method work the same way.

  Native mode is **read-only and whole-document** for now: `tabSequenceSnapshot()` throws (a native tree carries no focus/interaction data), and `rootSelector` scoping is rejected up front (omit it to audit the whole document). Both throw with an explanatory message rather than returning something misleading.

- 0a7a821: Add the interaction-diff ergonomics — assert what an interaction **changed** in the a11y tree, the differentiator over element-querying. Two styles over one underlying diff (core's `diffTrees` rendered by `serializeTreeDiff`):

  - **`capture(root)`** → `{ tree, focus }`, the before/after primitive; **`a11yDiff(before, after, opts?)`** boxes the change list for `expect(...).toMatchSnapshot()` / `.toMatchInlineSnapshot()`, rendered by the same serializer as `a11ySnapshot`. `after` may be a live `Element` (captured for you); a `focus:` line appears only when both sides carry focus context.

    ```ts
    const before = capture(container);
    fireEvent.click(screen.getByRole("combobox", { name: /country/i }));
    expect(a11yDiff(before, container)).toMatchInlineSnapshot(`
      + option "Spain"
      ~ combobox "Country": a11y.states.expanded false → true
    `);
    ```

  - **`flow().expectChanges(spec | string | fn)`** — fluent, diffing everything since the chain's first action (resets after each call). The `ChangeSpec` form matches `added`/`removed`/`changed` by role + name, subset by default (`exact: true` asserts nothing else changed; a `childIds`-only container change is treated as the structural shadow of an add/remove and never counts as an extra). Also accepts the raw `serializeTreeDiff` string or a `(diff) => void` predicate.

  Also re-exports `serializeTreeDiff` and `extract` from the main entry, for building custom before-trees. Internally, the snapshot-serializer box moved to its own module so `a11yDiff` and `a11ySnapshot` share one brand without the diff API pulling in the jest matcher augmentation — `a11ySnapshot` / `a11ySnapshotSerializer` / `registerA11yMatchers` are unchanged.

### Patch Changes

- cafe048: New package `@real-a11y-dev/audit` — the audit engine, extracted from `@real-a11y-dev/testing` as the single home for what an accessibility _finding_ is and how it's detected: the `Finding` data model, the rule set (`ALL_RULES`), the non-throwing `collectFindings`, the `listByRole` review helper, and the throwing `assert*` primitives (`assertNoUnlabeledInteractive`, `assertHeadingOrder`, `assertDialogsLabeled`, `assertLandmarkStructure`). It depends only on `@real-a11y-dev/core`, so a production consumer can reach the engine without pulling in a test-helper package.

  `@real-a11y-dev/testing` now consumes this package and re-exports the same `assert*`/`collectFindings`/`listByRole` surface under its existing names. No public API or output change — purely an internal extraction; existing imports from `@real-a11y-dev/testing` keep working unchanged.

- e2eca34: New package `@real-a11y-dev/browser` — the browser driver, extracted from `@real-a11y-dev/mcp` (the `BrowserSession`) and `@real-a11y-dev/testing` (the injected page-bundle and its IIFE build). It is the one place that touches Playwright: `BrowserSession` drives a real Chromium and injects the page-bundle that installs `window.__realA11y__`. Deps: `@real-a11y-dev/audit` + `@real-a11y-dev/serialize` + `@real-a11y-dev/core`, with an optional `playwright` peer.

  This completes the platform re-layering. The CLI, the MCP server, and the testing Playwright adapter now all drive the browser through this single package, so a tree captured by any of them is byte-for-byte identical — the bundle is built and resolved in exactly one place.

  - **`@real-a11y-dev/mcp`** imports `BrowserSession` from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/testing` dependency entirely** — the page-bundle was its last tie to the test-helper package. It also **removes the `./browser` subpath export**: import `BrowserSession` / `A11ySession` / `OpenOptions` / … from `@real-a11y-dev/browser` instead of `@real-a11y-dev/mcp/browser`.
  - **`@real-a11y-dev/cli`** imports the browser session from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/mcp` dependency** (it only wrapped mcp for the browser). Installing the CLI no longer pulls in the MCP SDK.
  - **`@real-a11y-dev/testing`** keeps its public API unchanged — `@real-a11y-dev/testing/playwright`'s `attach()` behaves identically. Internally its adapter now injects `@real-a11y-dev/browser`'s page-bundle (via the exported `PAGE_BUNDLE_PATH`) instead of building its own.

  Verified byte-for-byte against the CLI, MCP, and testing e2e suites.

- acb8931: Make `flow()` failure messages actionable instead of dead ends.

  - **`findByRole` misses now dump the current tree.** A miss used to say only `no node with role "button" and name … found in document.` — no clue what _is_ there. It now appends the serialized tree (the same view `expectTree` compares against), so you can see the roles and names that exist and correct the query, the way testing-library's `getByRole` dumps the available roles.
  - **`expectTree` / `expectChanges` point at the first differing line.** A snapshot mismatch printed the full expected and actual blocks back-to-back, leaving you to eyeball-diff two 60-line dumps. The message now leads with `First difference at line N:` plus a couple of lines of context and a `- expected` / `+ actual` marker, then still includes the full blocks for copy-paste snapshot updates.

  Failure-path message text only — no exported symbol, type, or signature changes, and the new output is produced solely when an assertion was already going to throw.

- 17f8df4: Make every `flow()` step resolve as soon as its action settles instead of always waiting out `waitTimeout`. `ActionDispatcher.dispatch` is fully synchronous, so a handler's DOM writes (and the `input`/`change` events from `type()`) landed _before_ the mutation observer was created — the observer never saw them, and each step could only end at the timeout, giving a 10-step chain a hard 2-second floor. The observer now starts before the action is dispatched, so a step settles one ~50ms debounce after its own mutations; measured on a step whose handler mutates synchronously, this drops from the full timeout (1016ms at `waitTimeout: 1000`) to the debounce.
- 1a3d813: Match accessible names across typographic punctuation, so smart quotes no longer cause confusing false failures. `toHaveTabSequence` tokens and `flow().expectChanges` `ChangeSpec` names now fold curly quotes/apostrophes, the ellipsis character, en/em dashes, and non-breaking spaces to their ASCII forms before comparing — a hand-typed `button "Don't save"` matches a label the page renders with a curly `Don’t`. Folding happens only at comparison time; serialized snapshots stay byte-faithful to what assistive tech announces, and the whole-diff string form of `expectChanges` is deliberately left literal.
- e2df9ec: Harden the Playwright adapter across three sharp edges, all in `attach()`.

  **The handle now survives navigation.** The audit bundle lives on `window`, so `page.goto()` (or an SPA hard navigation) wiped it and the next handle call died inside the page with a bare `Cannot read properties of undefined`. `attach()` now registers an init script that re-injects the bundle into every subsequent document, so a `Page` handle keeps working across a multi-page test. When the target is a `Frame` (no `addInitScript`), the page functions now throw a message that names the cause and the fix — "the page bundle is missing — this document navigated since attach(); call attach() again" — instead of the cryptic dereference.

  **iframe non-traversal is documented and testable.** Extraction walks one document and never descends into an `<iframe>`, so auditing a page that embeds a checkout/payment frame passed clean while that content was never checked. The `attach` docs now state this, and `PlaywrightPage` accepts a `Frame` so you can `attach(page.frame({ name: … }))` to audit the frame's own document. e2e covers both the host-omits-frame behaviour and the frame audit.

  **`test:e2e` builds first.** It read the prebuilt page-bundle from `dist/` but didn't depend on `build`, so a local run after editing source could green-light against a stale bundle — the exact staleness the adapter exists to prevent. A `pretest:e2e` step now rebuilds the package (and its bundle-owning deps) first.

  Also drops the `sourceMappingURL` from the injected bundle, which resolved against the page under test and 404'd in DevTools.

- Updated dependencies [1d0eef0]
- Updated dependencies [7f93f92]
- Updated dependencies [6a658fe]
- Updated dependencies [beae032]
- Updated dependencies [cafe048]
- Updated dependencies [725fcc0]
- Updated dependencies [9d080eb]
- Updated dependencies [cf426d3]
- Updated dependencies [e2eca34]
- Updated dependencies [96cb0ee]
- Updated dependencies [f2532e5]
- Updated dependencies [ad8edc1]
- Updated dependencies [d657f66]
- Updated dependencies [1c8a523]
- Updated dependencies [d693a00]
- Updated dependencies [d693a00]
- Updated dependencies [907c68e]
- Updated dependencies [0680dc9]
- Updated dependencies [19e9fc2]
- Updated dependencies [a32632a]
- Updated dependencies [4fe0c7b]
- Updated dependencies [8c2a8fa]
- Updated dependencies [2915bc7]
- Updated dependencies [77b4bf2]
- Updated dependencies [22abf6b]
  - @real-a11y-dev/serialize@0.1.0-beta.11
  - @real-a11y-dev/core@0.1.0-beta.11
  - @real-a11y-dev/audit@0.1.0-beta.11
  - @real-a11y-dev/browser@0.1.0-beta.11

## 0.1.0-beta.10

### Minor Changes

- d8eaaf7: Add `collectFindings(root, rules?)` — a non-throwing audit primitive that runs the accessibility rules over a single extraction and returns every violation as a structured `Finding[]` (rule, severity, message, and the offending role/name/tagName). The four `assert*` helpers are now thin wrappers over it, so running all rules is one tree extraction instead of four and reports all violations rather than stopping at the first.

  `collectFindings` accepts either a DOM `Element` or an already-extracted `ExtractionResult`. Passing a pre-extracted tree lets callers run the rules over the **same snapshot** used for the serialized tree, outline, and tab order — so a multi-view report can't be internally inconsistent on a dynamic page.

  Each `Finding` now carries a best-effort **`locator`** (a CSS selector path — an element id when present, else an `nth-of-type` chain) and **`context`** (`href`, nearest landmark), resolved via the extraction's element-ref map, so a finding can be acted on without cross-referencing the tree by hand. Severity is now **graded**: unlabeled controls and unlabeled dialogs are `error`; heading-order, duplicate landmarks, and images without a name are `warning`.

  Adds a new **`image-alt`** rule — flags `img`-role nodes with no accessible name (decorative `alt=""` images map to `presentation` and are excluded, so this only catches genuinely missing names).

  Also adds `listByRole(root, filter)` — lists every element in a category (`link`, `button`, `form`, `landmark`, `image`, `heading`, using the same `ROLE_FILTER_GROUPS` the extension's filter tabs use) as `role "name"` plus a locator. A token-efficient way to review one kind of element at a time.

  New exports: `collectFindings`, `listByRole`, `ALL_RULES`, and the `Finding` / `A11yRule` / `RoleFilter` types. The existing `assert*` functions keep their throwing behavior (each still fails on its own rule), but since they now report through the shared finding format, the thrown message is unified to `Found N accessibility issue(s):\n  - <finding>` (with the locator appended) rather than each helper's previous bespoke wording — update any tests that string-match the old message.

### Patch Changes

- 7a56937: DomObserver: add a max-wait ceiling to the mutation debounce. The debounce was trailing-only, so a page that mutates faster than the debounce interval — streaming AI responses, progress bars, live tickers, animated `style` updates — kept resetting the timer and `onTreeChange` never fired, leaving consumers (the extension side panel, `testing`'s `flow()`/`waitForMutations`) frozen for the whole stream. A second, non-resetting ceiling timer now forces a flush at least every `maxWaitMs` (new optional constructor arg, default 1000ms, clamped to at least the debounce interval).

  `testing`'s `waitForMutations` now threads its `timeout` through as the observer's ceiling, so the new default ceiling can't resolve a `timeout > 1000` wait early — its documented `timeout` contract is preserved.

- Updated dependencies [7a56937]
- Updated dependencies [fcd4bc9]
  - @real-a11y-dev/core@0.1.0-beta.10
  - @real-a11y-dev/serialize@0.1.0-beta.10

## 0.1.0-beta.9

### Patch Changes

- Updated dependencies [3607ac4]
  - @real-a11y-dev/core@0.1.0-beta.9
  - @real-a11y-dev/serialize@0.1.0-beta.9

## 0.1.0-beta.7

### Minor Changes

- 194b6ad: Add custom `expect` matchers for Vitest and Jest — `toHaveNoUnlabeledInteractive`, `toHaveValidHeadingOrder`, `toHaveLabeledDialogs`, `toHaveValidLandmarks`, and `toHaveTabSequence` — plus an `a11ySnapshot()` serializer that renders the semantic tree directly into `toMatchSnapshot()` / `toMatchInlineSnapshot()`. They ship from the new opt-in `@real-a11y-dev/testing/matchers` entry point (with a `@real-a11y-dev/testing/matchers/vitest` types augmentation) and register via `registerA11yMatchers(expect)`, so the package's main entry stays side-effect-free.

  The Playwright adapter's `auditSnapshot()` now accepts the same `redact`, `mode`, and `includeGeneric` options as the jsdom helper, marshalling each `RegExp` across the `page.evaluate()` boundary so snapshots stay deterministic in real-browser runs.

- 1270667: New package `@real-a11y-dev/validate` — ARIA semantics validation over the accessibility tree. `validateNode` runs the per-node rules (valid role, required accessible name and attributes, direct required context); `validateTree` runs the relationship rules that need the whole tree — interactive nesting (a `link` inside a `button`), presentational-children misuse (interactive/composite content inside `button`/`link`/…), and required-owned containers (an empty `tablist`, `list`, …). Rules are `aria-query`-backed so they never drift from the spec, and everything runs over a minimal `ValidatedNode` shape, so a tree authored ahead of code or extracted from the DOM is checked by one engine. `@real-a11y-dev/core` stays dependency-free — the `aria-query` dependency lives here.

  `@real-a11y-dev/testing` gains a `toBeValidA11yTree()` matcher (Vitest + Jest, from the `@real-a11y-dev/testing/matchers` entry): it extracts an element's accessibility tree, runs both validators, and fails on ARIA errors — invalid roles, missing required names/attributes, and the relationship violations above.

### Patch Changes

- 7df0e4d: New package `@real-a11y-dev/serialize` — the canonical, deterministic text serialization of the accessibility tree: `serializeTree`, `serializeOutline`, and `serializeTabSequence`, each accepting a DOM root **or** a pre-extracted `@real-a11y-dev/core` tree. It's the single source of truth for the snapshot string format shared by the testing package, the docs panel, and (next) the Chrome extension's tree export.

  `@real-a11y-dev/testing` now consumes this package and re-exports the serializers under its existing snapshot names (`auditSnapshot`, `outlineSnapshot`, `tabSequenceSnapshot`, `serializeTree`). No public API or output change — purely an internal extraction.

- Updated dependencies [8c230cb]
- Updated dependencies [c7af39c]
- Updated dependencies [7df0e4d]
- Updated dependencies [088a142]
- Updated dependencies [771f034]
- Updated dependencies [7df0e4d]
- Updated dependencies [1270667]
  - @real-a11y-dev/core@0.1.0-beta.7
  - @real-a11y-dev/serialize@0.1.0-beta.7
  - @real-a11y-dev/validate@0.1.0-beta.7

## 0.1.0-beta.6

### Patch Changes

- Updated dependencies [488ca27]
- Updated dependencies [d583a91]
- Updated dependencies [80dc889]
- Updated dependencies [a44004c]
- Updated dependencies [c2fb61b]
  - @real-a11y-dev/core@0.1.0-beta.6
