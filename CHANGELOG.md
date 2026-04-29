# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Individual package changelogs live alongside the package (`packages/<name>/CHANGELOG.md`)
once per-package releases diverge. For the initial `0.1.0-beta.0` train, every
publishable package ships together and is documented here.

## [Unreleased]

### Added

#### `@real-a11y-dev/core`

- `node.dom.descendantText` on every `SemanticNode` — recursive text
  content of the element with whitespace collapsed and a 240-character
  cap. Captures text nested inside spans, presentational wrappers, and
  other non-text-bearing tags. Useful for any consumer that needs a
  "what's in this element" preview when the accessible name is empty
  by spec (`<code>`, `<pre>`, `<svg>` containing `<text>`, decorative
  wrappers).

#### `@real-a11y-dev/semantic-navigator-ui`

- `TreeNode` now falls back to a muted preview of `dom.descendantText`
  in the a11y view when `a11y.name` is empty. Rendered with an `≈` prefix
  and italic styling so the user can tell it's a preview, not a real
  accessible name. Closes the visual gap created when role=presentation
  spans correctly drop out of the tree but the parent (e.g. `<code>`,
  `<pre>`) has no spec-allowed name of its own. New `.sn-name-preview`
  class in `tree.css`.

### Fixed

#### `@real-a11y-dev/core`

- `extractA11yTree` now flattens elements with `role="presentation"` /
  `role="none"` (and `<img alt="">`) from the accessibility tree per ARIA
  spec, even when the element has text content. Previously the role was
  remapped to `"generic"`, which kept the element in the tree whenever its
  text content gave it an accessible name — Shiki-style syntax highlighters
  (and any other site that correctly marks decorative spans with
  `role="presentation"`) showed one generic node per token in our panel.
  Children are still walked and promoted to the parent. Focusable elements
  with `role="presentation"` are kept (spec carve-out: presenting a real
  interactive control as decorative would lose keyboard access).

  **Behavior change for consumers:** any subtree containing
  `role="presentation"` / `role="none"` / `<img alt="">` produces a
  smaller tree. Snapshot tests asserting the prior shape will need to be
  re-snapshotted.

## [0.1.0-beta.4] — 2026-04-28

Consolidates everything shipped between `0.1.0-beta.0` and now. Earlier
beta-1, beta-2, and beta-3 were published via manual `workflow_dispatch`
runs without changelog entries or git tags; this entry covers the full
delta since beta-0. The Chrome extension bumps to `0.1.2` (CWS doesn't
accept pre-release tags).

### Added

#### `@real-a11y-dev/core`

- `buildControlsIndex(nodes)` and the `ControlsIndex` type — disclosure-pair
  index resolving `aria-controls` references to tree-node ids in both
  directions, plus a heuristic fallback for triggers that expose
  `aria-haspopup` + `aria-expanded="true"` without `aria-controls`. The
  `inferred` set distinguishes heuristic links from explicit ones so callers
  can render them with a "likely" affordance ([#26], [#27]).
- `aria-controls` and `aria-haspopup` are now captured into
  `node.dom.attributes` ([#26]).

#### `@real-a11y-dev/semantic-navigator-ui`

- `sn-controls-link`, `sn-controls-link--reverse`, `sn-controls-link--inferred`
  chip classes and an `sn-flash` keyframe in `tree.css`. Used by the Chrome
  extension's cross-link chips; available to anyone rolling their own UI on
  top of the engine ([#26], [#27]).

#### `@real-a11y-dev/semantic-navigator-extension` (`0.1.2`)

- Cross-link chips on disclosure pairs: `→ <role> "<name>"` chip on the
  trigger row, `← <role> "<name>"` chip on the controlled-element row.
  Click either chip to expand every collapsed ancestor of the target,
  scroll-center it, and flash its row briefly. Solid border for explicit
  `aria-controls`; dashed border (with hedged tooltip) for the heuristic
  fallback ([#26], [#27], [#28]).

#### Repo / CI

- ESLint flat config + Prettier ([#2]).
- Dependabot grouping for `github-actions` updates so weekly bumps land in
  one PR ([#16]).

### Changed

#### `@real-a11y-dev/core`

- `ActionDispatcher.handleClick` and `handleNavigate` now dispatch the full
  `pointerdown → mousedown → pointerup → mouseup → click` sequence rather
  than a single synthetic `click`. Required for handlers that gate on the
  pointer sequence — Google's `jsaction`, Material ripple, and many in-house
  component libraries silently no-op'd a bare synthetic click ([#21]).
- `ActionDispatcher.handleClick` and `handleNavigate` now redirect clicks on
  composite-widget wrappers (`treeitem`, `menuitem`, `menuitemcheckbox`,
  `menuitemradio`, `option`, `tab`, `row`, `gridcell`, `cell`) to their
  interactive descendant — `[role="link"]`, `[role="button"]`, `<a href>`,
  or `<button>` — so delegated handlers find the target. Falls through to
  the wrapper unchanged when no descendant matches (well-formed ARIA where
  the wrapper itself is interactive) ([#29]).

#### `@real-a11y-dev/semantic-navigator-extension` (`0.1.2`)

- Switching browser tabs now clears the displayed tree and shows the empty
  "Connecting…" state instead of stale content from the previous tab.
  Click the ↻ refresh button to load the new tab's tree. Auto-refresh on
  tab switch was unreliable across the long tail of pages (restricted URLs
  with no content script, lazy-injected content scripts, races between the
  panel learning the tab change and the content script being reachable) —
  manual refresh is one extra click for predictability ([#30]).

#### Repo / CI

- Publish workflow switched to npm Trusted Publisher / OIDC auth — no
  `NPM_TOKEN`, no OTP. Provenance attestations attach automatically via the
  same OIDC token ([#18]).

### Fixed

#### `@real-a11y-dev/testing`

- Snapshot output no longer includes a generation timestamp. Timestamps
  caused snapshots to churn on every run, defeating their purpose ([#3]).

#### `@real-a11y-dev/semantic-navigator-extension` (`0.1.2`)

- Side panel no longer leaks tree data between tabs. Background tags every
  outbound broadcast with `tabId`; panel filters incoming messages by
  `myTabId`; the panel's `myTabId` is sourced from a background
  `ACTIVE_TAB_CHANGED` broadcast (the panel context's own
  `chrome.tabs.onActivated` doesn't reliably fire). Panel `REQUEST_TREE`
  outbound is also tagged so the manual refresh button doesn't race the
  background's `activeTabId` update ([#22], [#30]).
- Orphaned content script after an extension reload no longer floods the
  page console with `Extension context invalidated`. The content script
  detects the dead context, tears down its `DomObserver` and live-region
  `MutationObserver`, and silently no-ops further `sendMessage` calls
  ([#25]).
- Cross-link chip clicks now reliably scroll the target into view even
  when ancestors had to expand in the same tick — explicit
  `block: "center"` scroll deferred two RAFs ([#28]).

#### Repo / CI

- Eight Dependabot vulnerability alerts patched via `pnpm overrides`;
  ongoing scans wired up ([#5]).

### Removed

#### `@real-a11y-dev/semantic-navigator-extension`

- `"scripting"` permission from the manifest. Was never actually used; was
  the cause of a Chrome Web Store rejection (Purple Potassium violation)
  on the first 0.1.0 submission ([#20]).

[#2]: https://github.com/real-a11y/real-a11y-dev/pull/2
[#3]: https://github.com/real-a11y/real-a11y-dev/pull/3
[#5]: https://github.com/real-a11y/real-a11y-dev/pull/5
[#16]: https://github.com/real-a11y/real-a11y-dev/pull/16
[#18]: https://github.com/real-a11y/real-a11y-dev/pull/18
[#20]: https://github.com/real-a11y/real-a11y-dev/pull/20
[#21]: https://github.com/real-a11y/real-a11y-dev/pull/21
[#22]: https://github.com/real-a11y/real-a11y-dev/pull/22
[#25]: https://github.com/real-a11y/real-a11y-dev/pull/25
[#26]: https://github.com/real-a11y/real-a11y-dev/pull/26
[#27]: https://github.com/real-a11y/real-a11y-dev/pull/27
[#28]: https://github.com/real-a11y/real-a11y-dev/pull/28
[#29]: https://github.com/real-a11y/real-a11y-dev/pull/29
[#30]: https://github.com/real-a11y/real-a11y-dev/pull/30

## [0.1.0-beta.0] — 2026-04-18

First public beta of the Real A11y monorepo. Everything below ships as
`0.1.0-beta.0` under the `beta` dist-tag on npm; the Chrome extension ships
as version `0.1.0` (Chrome Web Store doesn't support pre-release tags).

### Added

#### `@real-a11y-dev/core`

- Tree extraction engine with DOM and accessibility tree support
  - TreeWalker-based DOM extraction
  - DOM-computed accessibility tree with generic node flattening
  - Role mapping for 80+ HTML elements based on the WAI-ARIA in HTML spec
  - Accessible name computation (`aria-label`, `aria-labelledby`, `alt`, `title`, `textContent`)
  - Accessible description via `aria-describedby` / `aria-description`
  - Active-modal detection (scopes extraction to `<dialog open>`, `role="dialog"` and `alertdialog`)
  - Live-region observation (`role="status"`, `role="alert"`, `aria-live`)
- `ActionDispatcher` for interactive tree actions: `click`, `navigate`, `focus`, `type`, `submit`, `toggle`, `select`, `scroll`
- `FocusManager` with opt-in highlight overlay and `scrollIntoView` (both gated behind config flags so the embed doesn't disturb the host app)
- `DomObserver` — debounced MutationObserver for live tree updates
- GC-safe element references via `WeakRef` + `FinalizationRegistry`
- Query helpers (`packages/core/src/query/`): `findByRole`, `findAllByRole`, `linearize`, `getOutline`, `getTabSequence`, `diffTrees`
- Stable node IDs via `getNodeId` — keyed by WeakMap from DOM nodes, stable across re-extractions

#### `@real-a11y-dev/semantic-navigator-ui`

- Preact components (≈3 KB gzipped) — `TreeView`, `TreePanel`, `TreeNode`, `TreeToolbar`, `FilteredList`, `TabSequenceView`
- WAI-ARIA TreeView keyboard navigation pattern (Arrow keys, Home / End, `*`, Enter, Space)
- Self-contained CSS with `--sn-*` custom properties and built-in light / dark / auto themes
- Search bar with match count and role-filter chips
- DOM / A11Y / TAB view toggle
- Expand / collapse-all controls, indent guide lines, state badges
- `useTreeKeyboard` and `useSearch` hooks

#### `@real-a11y-dev/inspector` (renamed from `@real-a11y-dev/semantic-navigator`)

- `createInspector()` — framework-agnostic mountable embed
- **Shadow DOM isolation by default** (`mount: "shadow"`) — host CSS cannot leak in, embed CSS cannot leak out
- Opt-in host-app side effects — `highlightOnHover`, `scrollHostOnSelect`, `focusHostOnActivate` all default to `false` so audits and test harnesses don't disturb the app under test
- Stable public API: `mount()`, `unmount()`, `setViewMode()`, `setRoot()`, `refresh()`, `getTree()`
- CSP-friendly via `styleNonce` config
- 5-test Vitest suite covering shadow DOM, lifecycle, and side-effect gating

#### `@real-a11y-dev/testing` (new)

- Headless audit helpers — depends only on `@real-a11y-dev/core`, no UI package
- Snapshots: `auditSnapshot`, `outlineSnapshot`, `tabSequenceSnapshot` — deterministic, diff-friendly
- Assertions: `assertHeadingOrder`, `assertNoUnlabeledInteractive`, `assertDialogsLabeled`, `assertLandmarkStructure`
- `flow()` — Testing-Library-style chain for interaction sequences, powered by `ActionDispatcher` and `DomObserver`
- `serializeTree()` — Vitest / Jest snapshot serializer
- Playwright adapter at `./playwright` subpath — bundled separately so consumers don't pay for Playwright unless they use it
- `snapshot` script for CI a11y-tree diff bot (see `.github/workflows/a11y-diff.yml`)

#### `@real-a11y-dev/react` (new)

- React 18+ first-class wrapper
- `<SemanticNavigator />` component — renders a shadow-root embed into a host `<div>`
- `useSemanticTree(rootRef, opts)` hook — subscribes to `DomObserver` via `useSyncExternalStore` (concurrent-mode safe)
- `useActiveModal(rootRef)` hook — reactive "is a modal open?" signal
- Peer deps: `react >= 18`, `react-dom >= 18`
- 3-test React Testing Library suite

#### `@real-a11y-dev/storybook-addon` (new)

- Storybook 8+ panel showing the A11y tree for the current story's canvas
- Manager-side React panel bridged to Preview-side Preact tree view over the Storybook channel
- Per-story `parameters.realA11y` for expected outline / tab sequence — regressions surface as warnings
- Addon ID: `real-a11y/semantic-navigator`

#### Chrome extension

- Manifest V3 with minimal permissions (`activeTab`, `sidePanel`, `scripting`, `webNavigation`)
- Side Panel UI for a persistent tree alongside the page
- Content script for DOM extraction, action dispatching, and frame merging for `<iframe>` content
- Background service worker routes messages between panel, content scripts, and all frames
- Node highlighting overlay on hover / select; focus-sync with the page's real focus
- Scope-to-subtree breadcrumb; dialog-scope indicator with "Press ESC" shortcut
- Live-region announcement log
- Curtain mode (hide page visuals to audit purely from the tree)
- Input panel for typing into text fields and picking options from `<select>`
- Keyboard-event bar: send Esc / Tab / Shift-Tab / Enter / Space / arrows to the page
- BETA pill in the side-panel header to set expectations during pre-1.0
- `homepage_url: "https://real-a11y.dev"` in manifest for CWS listing

#### Monorepo, tooling, governance

- All 6 publishable packages share a single `0.1.0-beta.0` version under the `beta` npm dist-tag
- npm metadata complete on every publishable package: `license`, `author`, `repository.directory`, `homepage`, `bugs`, `keywords`, `engines.node: ">=20"`, `publishConfig.access: "public"`, `publishConfig.provenance: true`
- Shadow DOM isolation as the default embed mount
- `vitest.workspace.ts` covers all 6 packages; 122 tests across the monorepo
- GitHub Actions workflows: `test.yml` (PR + push), `publish.yml` (tag + manual dispatch with provenance), `docs.yml` (Pages deploy), `a11y-diff.yml` (posts a sticky PR comment when the accessibility tree changes)
- Governance: `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1 by reference), `SECURITY.md` (supported versions, timeline, safe harbor), `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}`, `.github/PULL_REQUEST_TEMPLATE.md`
- Four runnable examples under `examples/` — Vanilla / Vite, React, Vitest audit, Storybook — each with its own README
- VitePress website at `real-a11y.dev` with guide, per-package docs, and examples; sidebar includes a Beta dropdown linking to Changelog, Contributing, Security, and Code of Conduct
- UI smoke tests for `TreeToolbar`, `FilteredList`, `TreeView`
- Replaced silent `.catch(() => {})` handlers in the extension background service worker with informative `console.debug` / `console.warn` calls so real routing bugs surface in user reports

### Notes

- This is a **beta** release. APIs across `0.1.x` may change before `0.2.0`; breaking changes will ship behind a minor bump and be called out here.
- `@real-a11y-dev/inspector` was previously `@real-a11y-dev/semantic-navigator` (and lived in `packages/npm/` in the repo). It's now published under the new name at the new directory `packages/inspector/`.
