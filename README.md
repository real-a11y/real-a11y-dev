# Real A11y

[![Status: Beta](https://img.shields.io/badge/status-beta-orange)](#status)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![npm (@real-a11y-dev/core)](https://img.shields.io/npm/v/@real-a11y-dev/core?label=%40real-a11y%2Fcore)](https://www.npmjs.com/package/@real-a11y-dev/core)
[![npm (@real-a11y-dev/inspector)](https://img.shields.io/npm/v/@real-a11y-dev/inspector?label=%40real-a11y%2Finspector)](https://www.npmjs.com/package/@real-a11y-dev/inspector)
[![Node](https://img.shields.io/node/v/@real-a11y-dev/core)](https://nodejs.org)

Accessibility tooling that works in the real world — semantic tree extraction, testing utilities, React integration, a Storybook panel, a CLI for shell and CI audits, an MCP server for AI agents, and a Chrome extension, all powered by the same engine.

> **Beta.** APIs across the `0.1.x` line may change before `0.2.0`. Feedback and issues very welcome — see [Status](#status) below.

Semantic Navigator replaces the visual browser rendering with an interactive DOM/accessibility tree view. Click links, fill forms, activate buttons — all through the tree. If your page doesn't make sense as a tree, it doesn't make sense at all.

## Why

Existing tools (Chrome DevTools, Axe, WAVE) show the accessibility tree as a passive inspector. Semantic Navigator flips this: the tree *is* the interface. This enforces good semantic HTML by making bad structure immediately obvious through use.

## Packages

| Package | Description | npm |
|---------|-------------|-----|
| [`@real-a11y-dev/core`](./packages/core) | Tree extraction, data model, interaction engine | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/core)](https://www.npmjs.com/package/@real-a11y-dev/core) |
| [`@real-a11y-dev/serialize`](./packages/serialize) | Deterministic text serialization — full tree, heading outline, tab sequence | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/serialize)](https://www.npmjs.com/package/@real-a11y-dev/serialize) |
| [`@real-a11y-dev/validate`](./packages/validate) | ARIA semantics validation (per-node + tree-level rules), aria-query-backed | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/validate)](https://www.npmjs.com/package/@real-a11y-dev/validate) |
| [`@real-a11y-dev/audit`](./packages/audit) | Audit engine — `Finding` model, a11y rules, `collectFindings`, `assert*` primitives | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/audit)](https://www.npmjs.com/package/@real-a11y-dev/audit) |
| [`@real-a11y-dev/semantic-navigator-ui`](./packages/ui) | Preact tree rendering components | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/semantic-navigator-ui)](https://www.npmjs.com/package/@real-a11y-dev/semantic-navigator-ui) |
| [`@real-a11y-dev/inspector`](./packages/inspector) | Framework-agnostic interactive accessibility tree panel | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/inspector)](https://www.npmjs.com/package/@real-a11y-dev/inspector) |
| [`@real-a11y-dev/testing`](./packages/testing) | Headless audit helpers — snapshots, assertions, `flow()` chain | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/testing)](https://www.npmjs.com/package/@real-a11y-dev/testing) |
| [`@real-a11y-dev/cli`](./packages/cli) | The `real-a11y` shell command — audit/tree/outline/tabs/list/inspect/snapshot/diff/login, CI-grade exit codes | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/cli)](https://www.npmjs.com/package/@real-a11y-dev/cli) |
| [`@real-a11y-dev/mcp`](./packages/mcp) | Model Context Protocol server exposing audits to AI agents | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/mcp)](https://www.npmjs.com/package/@real-a11y-dev/mcp) |
| [`@real-a11y-dev/react`](./packages/react) | React hooks and `<SemanticNavigator />` component | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/react)](https://www.npmjs.com/package/@real-a11y-dev/react) |
| [`@real-a11y-dev/storybook-addon`](./packages/storybook-addon) | Per-story A11y tree panel for Storybook 8+ | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/storybook-addon)](https://www.npmjs.com/package/@real-a11y-dev/storybook-addon) |
| [`extension`](./packages/extension) | Chrome extension with Side Panel UI | — |

## Quick start

### npm package

```bash
npm install @real-a11y-dev/inspector
```

```ts
import { createInspector } from "@real-a11y-dev/inspector";

const nav = createInspector({
  root: document.getElementById("app"),
  container: document.getElementById("tree-panel"),
  viewMode: "a11y", // "dom" | "a11y"
  interactive: true,
  theme: "auto",    // "light" | "dark" | "auto"
});

nav.mount();
```

### CLI

Audit a page — and gate CI — from your shell. Playwright is an optional peer dependency (install it to audit live URLs; local HTML files need no browser):

```bash
npm i -D @real-a11y-dev/cli@beta   # beta dist-tag while the family is in pre-release
npx playwright install chromium

npx real-a11y audit https://example.com
```

`real-a11y audit` exits non-zero on screen-reader-fidelity findings — a CI gate with no config. The full command set (`tree`, `outline`, `tabs`, `list`, `inspect`, `snapshot`, `diff`, `login`) is documented in [`@real-a11y-dev/cli`](./packages/cli).

### MCP server (for AI agents)

Expose the audits and semantic tree to any Model Context Protocol client — `npx -y` fetches the package on first run:

```bash
npx -y @real-a11y-dev/mcp
```

The server offers tools like `audit_page` (every violation as structured findings) and `get_semantic_tree` (role + accessible-name outline). To audit pages behind a login, point `REAL_A11Y_MCP_STORAGE_STATE` at a saved Playwright session and set `REAL_A11Y_MCP_ALLOWED_ORIGINS` to pin auditing to trusted origins. See [`@real-a11y-dev/mcp`](./packages/mcp).

### Chrome extension

[Install from the Chrome Web Store](https://chromewebstore.google.com/detail/semantic-navigator/gnnepgbbecnlomngfemkadnbeaopleom). Chrome may show a "Proceed with caution — not trusted by Enhanced Safe Browsing" notice on first install; this is the default for any newly listed extension and not a specific signal about this one — click **Continue to install**.

To run from source instead:

1. Clone this repo
2. Run `pnpm install && pnpm build`
3. Open `chrome://extensions`, enable Developer mode
4. Click "Load unpacked" and select `packages/extension/dist`
5. Navigate to any page and click the Semantic Navigator icon to open the side panel

## Features

### Two tree views (toggleable)

- **DOM tree** — Raw HTML elements with tag names, attributes, and text content
- **Accessibility tree** — Roles, accessible names, and states (what screen readers see). Generic/decorative nodes are flattened out

### Full interactivity

Not just viewing — interact with the page through the tree:

- **Click** links and buttons
- **Navigate** to link destinations
- **Focus** form inputs
- **Toggle** details/summary elements
- **Submit** forms

### Keyboard navigation

Follows the [WAI-ARIA TreeView pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/):

| Key | Action |
|-----|--------|
| `Arrow Down/Up` | Move between nodes |
| `Arrow Right` | Expand node or move to first child |
| `Arrow Left` | Collapse node or move to parent |
| `Enter` | Activate node's primary action |
| `Space` | Toggle expand/collapse |
| `Home/End` | Jump to first/last node |
| `*` | Expand all siblings |

### Search and filter

Type to search across tag names, roles, accessible names, attributes, and text content. Matching nodes and their ancestors stay visible.

### Live updates

The tree automatically updates when the DOM changes (via MutationObserver with debounced re-extraction).

### Node highlighting

Hover or select a node in the tree to see the corresponding element highlighted on the page.

## Architecture

```
core ──── serialize ─┐
                     ├── testing ──── mcp ──── cli   (headless — no UI dep)
validate ────────────┘

core ──── ui ──┬── inspector ──┬── react
               │               │
               │               └── storybook-addon

extension ──→ ui ──→ core
```

- **core** — Zero UI dependencies. Tree extraction (TreeWalker), role mapping (80+ HTML elements to ARIA roles), interaction engine (ActionDispatcher), DOM observation, query helpers (`findByRole`, `linearize`, `getOutline`, `getTabSequence`, `diffTrees`)
- **serialize** — Deterministic text serialization of the tree: full tree, heading outline, and tab sequence. Depends on core
- **validate** — ARIA semantics validation (per-node rules plus tree-level relationship checks like interactive nesting and required context/owned). aria-query-backed, so it never drifts from the spec — standalone (no core dependency)
- **ui** — Preact components (≈5KB gzipped — TreeView entry, see `.size-limit.json`). TreeView, TreeNode, TreeToolbar with self-contained CSS and light/dark themes
- **inspector** — Framework-agnostic embed. Shadow-DOM isolation by default; opt-in host-app side effects
- **testing** — Headless audit helpers (`auditSnapshot`, `assertHeadingOrder`, `flow()`, Vitest serializer, Playwright adapter). Composes core + serialize + validate; no UI dependency
- **cli** — The `real-a11y` shell command (audit, tree, outline, tabs, list, inspect, snapshot, diff, login) with CI-grade exit codes and machine formats. Builds on the testing engine (via mcp)
- **mcp** — Model Context Protocol server exposing the audits and semantic tree to AI agents (`audit_page`, `get_semantic_tree`, …). Builds on the testing engine
- **react** — `useSemanticTree` and `useActiveModal` hooks (concurrent-mode safe via `useSyncExternalStore`) plus `<SemanticNavigator />` component
- **storybook-addon** — Per-story A11y tree panel for Storybook 8+
- **extension** — Chrome MV3. Content script extracts the tree and dispatches actions; Side Panel renders the tree UI; Background service worker routes messages

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Watch mode (all packages)
pnpm dev
```

### Requirements

- Node.js >= 20
- pnpm >= 9

## Tech stack

- TypeScript (strict mode)
- pnpm workspaces
- Preact 10 (3KB, React-compatible API)
- tsup (core, ui, npm bundling)
- Vite (extension bundling)
- Vitest + jsdom (testing)

## Status

Real A11y is in **public beta** (`0.1.x`). The core extraction engine and the Chrome extension are stable and used in production; the npm packages (`@real-a11y-dev/inspector`, `@real-a11y-dev/testing`, `@real-a11y-dev/react`, `@real-a11y-dev/storybook-addon`) are newer and may have minor API changes before `0.2.0`.

The contract for what counts as a breaking change, what's internal vs. public, and how deprecations work is in [docs/STABILITY.md](./docs/STABILITY.md).

See [SECURITY.md](./SECURITY.md) for how to report security issues, and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before opening an issue or PR.

## License

MIT — see [LICENSE](./LICENSE)

## About Real A11y

> "Real Accessibility is the practice of building digital products that actually hold up for real people in real conditions."

Learn more at [real-a11y.dev](https://real-a11y.dev)
