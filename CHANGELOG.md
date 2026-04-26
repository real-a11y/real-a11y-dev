# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Individual package changelogs live alongside the package (`packages/<name>/CHANGELOG.md`)
once per-package releases diverge. For the initial `0.1.0-beta.0` train, every
publishable package ships together and is documented here.

## [Unreleased]

_No changes yet._

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
