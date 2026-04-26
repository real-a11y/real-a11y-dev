---
title: Architecture — how the packages fit together
description: A map of the Real A11y monorepo — what each of the six packages owns, how they depend on each other, and why the split is the way it is.
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
| [`@real-a11y-dev/testing`](/packages/testing) | Headless audit helpers — `auditSnapshot`, `outlineSnapshot`, `tabSequenceSnapshot`, `assert*`, `flow()`. A separate `/playwright` entrypoint ships a `Page`-handle adapter for real-browser E2E. **No UI.** | None (optional: `@playwright/test`) |
| [`@real-a11y-dev/storybook-addon`](/packages/storybook-addon) | Storybook 8 panel — preview-side extractor posts tree snapshots over the Storybook channel; manager-side React panel renders them. | `storybook >= 8`, `react >= 18` |

A private `@real-a11y-dev/semantic-navigator-extension` workspace builds the Chrome extension using the same engine; it is not published to npm.

---

## Dependency graph

```
              ┌──────────────────────── @real-a11y-dev/core ────────────────────────┐
              │                  (extraction + queries, no UI)                      │
              │                                                                     │
              ▼                                                                     ▼
  @real-a11y-dev/semantic-navigator-ui                                @real-a11y-dev/testing
     (Preact tree-view components)                                     (headless assertions +
              │                                                         Playwright adapter)
              │
     ┌────────┴────────────────────────┬─────────────────────────┐
     ▼                                 ▼                         ▼
  @real-a11y-dev/inspector     @real-a11y-dev/storybook-addon     (semantic-navigator-extension,
  (framework-agnostic panel)   (preview + manager entries)        Chrome only, not published)
              │
              ▼
  @real-a11y-dev/react
  (<SemanticNavigator /> + hooks)
```

Two observations:

1. **`@real-a11y-dev/testing` has zero UI dependency.** Assertions and snapshots only read the tree; they never render. That's what makes them safe for jsdom and fast enough to run in every unit test.
2. **The UI package is bundled into consumers.** `inspector`, `react`, and `storybook-addon` each pull `@real-a11y-dev/semantic-navigator-ui` through `noExternal` in tsup, shipping self-contained artifacts. Consumers only ever install the top-level package; they never reason about Preact versions or tree-view internals.

---

## Why this split

### Engine separate from renderer
Everything useful about the extraction engine (tree walk, role map, accessible-name computation, tab-sequence derivation, action dispatch) is framework-agnostic tree manipulation. Keeping it in `@real-a11y-dev/core` with no UI dependency lets the testing package, the Playwright adapter, and downstream tooling use the engine without pulling Preact into their bundle.

### React-specific concerns live in `@real-a11y-dev/react`
React 18 concurrent-mode safety requires `useSyncExternalStore`; SSR (Next.js App Router) requires a mount-gated portal; React 19's jsx-runtime has internals that don't live in React 18. All of that React-specific complexity is isolated to one package with a clear React peer dep. Vanilla and Vue projects pay none of that cost — they use `inspector` directly.

### Testing is fully headless
`@real-a11y-dev/testing` is used by CI jobs that run in Node with no browser, by Vitest unit suites with jsdom, and by Playwright E2E jobs with a real Chromium. One API, three runtimes. Decoupling the UI makes that possible — the tree view isn't involved in any assertion path.

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
