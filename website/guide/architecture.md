---
title: Architecture — how the packages fit together
description: A map of the Real A11y monorepo — what each package owns, how they depend on each other, and why the split is the way it is.
---

# Architecture

Real A11y is a monorepo of small, composable packages built around one extraction engine. This page explains what each package owns, how they depend on each other, and why the split looks the way it does.

---

## Packages

| Package | Purpose | Runtime deps |
|---|---|---|
| [`@real-a11y-dev/core`](/packages/core) | Extraction engine — accessibility + DOM tree walk, role map, accessible-name computation, action dispatch, DOM observer, stable-id generator, tree queries. **No UI.** | None |
| [`@real-a11y-dev/semantic-navigator-ui`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/ui) | Preact tree-view components — TreePanel, TreeNode, FilteredList, TabSequenceView, theming CSS. Consumed as a build-time dependency of the packages below; **not usually installed directly**. | `preact` |
| [`@real-a11y-dev/inspector`](/packages/inspector) | Framework-agnostic inspector. `createInspector({ root, container })` mounts the tree panel into any DOM node, isolated via Shadow DOM. | (bundles `semantic-navigator-ui` + `core` + `preact`) |
| [`@real-a11y-dev/react`](/packages/react) | React integration — `<SemanticNavigator />` component + `useSemanticTree()` / `useActiveModal()` hooks. Wraps `inspector` for inline and floating modes. | `react >= 18`, `react-dom >= 18` |
| [`@real-a11y-dev/testing`](/packages/testing) | Headless audit helpers — `auditSnapshot`, `outlineSnapshot`, `tabSequenceSnapshot`, `flow()`, plus the interaction-diff API (`capture`, `a11yDiff`). Re-exports the `assert*`/`collectFindings` surface from `@real-a11y-dev/audit`. A separate `/playwright` entrypoint ships a `Page`-handle adapter that injects `@real-a11y-dev/browser`'s page-bundle for real-browser E2E. **No UI.** | `@real-a11y-dev/audit`, `@real-a11y-dev/browser` (optional: `@playwright/test`) |
| [`@real-a11y-dev/storybook-addon`](/packages/storybook-addon) | Storybook 8 panel — preview-side extractor posts tree snapshots over the Storybook channel; manager-side React panel renders them. | `storybook >= 8`, `react >= 18` |
| [`@real-a11y-dev/serialize`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/serialize) | Deterministic text serialization of the tree — full tree, heading outline, and tab sequence. **No UI.** | `@real-a11y-dev/core` |
| [`@real-a11y-dev/validate`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/validate) | ARIA-semantics validation — per-node rules plus tree-level relationship checks, backed by `aria-query` so it tracks the spec. Standalone. | `aria-query` |
| [`@real-a11y-dev/audit`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/audit) | Audit engine — the `Finding` data model, the a11y rule set, `collectFindings`, and the `assert*` primitives. The one place a finding is defined and detected; `testing`, `mcp`, and `cli` all render what it produces. **No UI.** | `@real-a11y-dev/core` |
| [`@real-a11y-dev/snapshot`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/snapshot) | Snapshot engine — deterministic finding fingerprints, the diffable `a11y-snapshot.json` artifact, the findings/views/unified diff, and baselines. Node-only; the single place a snapshot is captured and compared, so the CLI and MCP diff identically. **No UI.** | `@real-a11y-dev/audit`, `@real-a11y-dev/core` |
| [`@real-a11y-dev/browser`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/browser) | Browser driver — the Playwright `BrowserSession` plus the injected page-bundle it ships. The one place that touches Playwright; the CLI, the MCP server, and the testing adapter all drive a real Chromium through it. | `@real-a11y-dev/audit`, `@real-a11y-dev/serialize`, `@real-a11y-dev/core` (optional peer: `playwright`) |
| [`@real-a11y-dev/mcp`](/packages/mcp) | Model Context Protocol server exposing `audit_page` / `get_semantic_tree` / `inspect_page`, plus **a11y snapshot checkpoints** (`save_checkpoint` / `diff_checkpoint` / …), to AI agents (bin `real-a11y-mcp`). | `@real-a11y-dev/audit`, `@real-a11y-dev/browser`, `@real-a11y-dev/snapshot`, `@modelcontextprotocol/sdk` (optional peer: `playwright`) |
| [`@real-a11y-dev/cli`](/packages/cli) | The `real-a11y` shell command — audits, perception views (`tree` / `outline` / `tabs` / `list` / `inspect`), and `snapshot` + `diff` from the shell and CI. A command, not a library — the programmatic engine lives in `snapshot`. | `@real-a11y-dev/audit`, `@real-a11y-dev/snapshot`, `@real-a11y-dev/browser` (optional peer: `playwright`) |

A private `@real-a11y-dev/semantic-navigator-extension` workspace builds the Chrome extension using the same engine — unlike the packages above, it is not published to npm.

---

## Dependency graph

```
  @real-a11y-dev/core — extraction, queries, role constants (no UI, no deps)
        │
        ├─▶ semantic-navigator-ui (Preact)  ─▶ inspector ─▶ react
        │                                    └─▶ storybook-addon
        ├─▶ serialize   (deterministic text)
        ├─▶ validate    (aria-query ARIA validity — standalone)
        └─▶ audit       (Finding model, rules, collectFindings, assert*)
                 │
                 ├─▶ snapshot   (fingerprints, artifact, findings/views diff, baselines — Node-only)
                 ├─▶ browser    (Playwright BrowserSession + the injected page-bundle)
                 ├─▶ testing    (matchers, interaction diff; adapter injects browser's bundle)
                 ├─▶ mcp        (MCP server + checkpoints)  ── also depends on → browser, snapshot
                 └─▶ cli        (the real-a11y shell, bin-only)  ── also depends on → snapshot, browser

  cli → { audit, snapshot, browser }    mcp → { audit, browser, snapshot }    testing → { …, browser }
  browser is the ONLY package that touches Playwright — everything above it is browserless.
  audit is imported directly everywhere — no reaching an engine through the test-helper package.
  snapshot is Node-only (node:crypto) and never enters the page bundle; browser *builds* it.
  Standalone:  @real-a11y-dev/validate — aria-query-backed ARIA validation, no internal deps.
  Private:     @real-a11y-dev/semantic-navigator-extension — Chrome extension, not published.
```

Two observations:

1. **`@real-a11y-dev/testing` and `@real-a11y-dev/snapshot` have zero UI dependency.** Assertions, snapshots, and diffs only read the tree or operate on data; they never render. That's what makes them safe for jsdom and Node and fast enough to run in every unit test.
2. **The UI package is bundled into consumers.** `inspector`, `react`, and `storybook-addon` each pull `@real-a11y-dev/semantic-navigator-ui` through `noExternal` in tsup, shipping self-contained artifacts. Consumers only ever install the top-level package; they never reason about Preact versions or tree-view internals.

---

## Why this split

### Engine separate from renderer
Everything useful about the extraction engine (tree walk, role map, accessible-name computation, tab-sequence derivation, action dispatch) is framework-agnostic tree manipulation. Keeping it in `@real-a11y-dev/core` with no UI dependency lets the testing package, the Playwright adapter, and downstream tooling use the engine without pulling Preact into their bundle.

### React-specific concerns live in `@real-a11y-dev/react`
React 18 concurrent-mode safety requires `useSyncExternalStore`; SSR (Next.js App Router) requires a mount-gated portal; React 19's jsx-runtime has internals that don't live in React 18. All of that React-specific complexity is isolated to one package with a clear React peer dep. Vanilla and Vue projects pay none of that cost — they use `inspector` directly.

### Testing is fully headless
`@real-a11y-dev/testing` is used by CI jobs that run in Node with no browser, by Vitest unit suites with jsdom, and by Playwright E2E jobs with a real Chromium. One API, three runtimes. Decoupling the UI makes that possible — the tree view isn't involved in any assertion path.

### The findings engine has one home
A finding — "this button has no accessible name" — is defined and detected in exactly one place: `@real-a11y-dev/audit`. The `Finding` type, the rule set, `collectFindings`, and the `assert*` primitives all live there, depending on nothing but `core`. Everything downstream only *renders* what the engine produces: `testing` re-exports it for test authors, and `mcp`/`cli` format it for agents and the shell. Keeping detection separate from presentation means a new rule is written once and every surface reports it, and a production package like `cli` never has to pull in a test-helper package to reach the engine.

### The snapshot engine has one home
Like a finding, a _snapshot_ — the diffable `a11y-snapshot.json`, its frozen `v1:` fingerprints, and the diff over them — is built and compared in exactly one place: `@real-a11y-dev/snapshot`, Node-only and depending on nothing but `audit` and `core`. The CLI and the MCP server both capture through it and diff through it, so a snapshot taken by one and compared by the other is byte-for-byte identical: fingerprint parity stops being a discipline ("both surfaces must build the artifact the same way") and becomes structural (there is only one place the code lives). This is also why the CLI is a command, not a library — anyone who wants the engine programmatically imports `snapshot` directly, and the CLI ships just its `bin`.

### The real browser lives in one place
Driving a real Chromium — launching Playwright, injecting the page-bundle, marshalling calls across `page.evaluate()` — is the one genuinely heavyweight dependency in the stack. It all lives in `@real-a11y-dev/browser`: the `BrowserSession` and the injected bundle it ships, depending on `audit`/`serialize`/`core` and an *optional* `playwright` peer. The CLI, the MCP server, and the testing Playwright adapter all drive the browser through this single package, so there is exactly one place the bundle is built and one contract for injecting it — a tree captured by any of the three is identical. Everything above `browser` is browserless and Node- or jsdom-safe; a consumer that only needs the engine never pulls Playwright into its graph.

### UI is bundled, not shipped separately
In theory `@real-a11y-dev/semantic-navigator-ui` could be a normal dependency. In practice consumers always want the exact tree-view version the parent package was tested against. Bundling via `noExternal` eliminates an entire class of peer-range support questions and lets the UI refactor freely inside any release that also updates its consumers.

---

## Build pipeline per package

Every package uses the same tsup config shape:

- **ESM + CJS dual output** (`dist/index.js`, `dist/index.cjs`)
- **Type declarations** (`dist/index.d.ts`, `dist/index.d.cts`)
- **Source maps** for debuggable stack traces in downstream test runners
- **`"files": ["dist"]`** — only the built output ships to npm; source, configs, and tests stay in the repo

Per-entrypoint specifics:

- **`@real-a11y-dev/testing`** — two entries (`index`, `playwright`). The Playwright entry imports `node:fs` to read a pre-built IIFE bundle (`dist/page-bundle.iife.global.js`) that gets injected into the page via `page.addScriptTag()`.
- **`@real-a11y-dev/storybook-addon`** — three entries (`index`, `preview`, `manager`). The manager entry forces classic JSX transform so Storybook's React-externalization works; see [`packages/storybook-addon/tsup.config.ts`](https://github.com/real-a11y/real-a11y-dev/blob/main/packages/storybook-addon/tsup.config.ts).
- **`@real-a11y-dev/inspector` / `/react` / `/storybook-addon`** — `noExternal: ["@real-a11y-dev/semantic-navigator-ui", "@real-a11y-dev/core", "preact"]` so the bundled artifact is self-contained.

---

## The SemanticNode data model

All packages share a single node shape from `@real-a11y-dev/core`. See [Core Concepts](/guide/core-concepts) for the full schema. The contract:

```ts
interface SemanticNode {
  id: string;                     // stable WeakMap fingerprint
  parentId: string | null;
  childIds: string[];
  depth: number;
  dom:         { tagName, attributes, textContent, isHidden };
  a11y:        { role, name, description, states, properties, isExposedToAT };
  interaction: { isInteractive, actions, isFocusable, isEditable };
  ui:          { expanded, highlighted, matchesFilter, selected };
}
```

Everything else — the UI, the assertions, the snapshots, the Storybook panel — is a projection of a `Map<string, SemanticNode>`. When a consumer finds a surprising output, the conversation terminates at "what does `extractA11yTree(root)` return?" That's the root of every question.

---

## Where to read next

- [Core Concepts](/guide/core-concepts) — the semantic tree model, roles, tab order
- [Accessible Names](/guide/accessible-names) — the ANDC algorithm as implemented in `core`
- [`@real-a11y-dev/core`](/packages/core) — the engine's public API
