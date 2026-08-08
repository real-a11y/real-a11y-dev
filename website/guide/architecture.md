---
title: Architecture — how the packages fit together
description: A map of the Real A11y monorepo — what each package owns, how they depend on each other, and why the split is the way it is.
---

# Architecture

Real A11y is a monorepo of small, composable packages built around one extraction engine. This page explains what each package owns, how they depend on each other, and why the split looks the way it does.

---

## Packages

### Published to npm

| Package | Purpose | Runtime deps |
|---|---|---|
| [`@real-a11y-dev/core`](/packages/core) | Extraction engine — accessibility + DOM tree walk, role map, accessible-name computation, action dispatch, DOM observer, stable-id generator, tree queries. **No UI.** | None |
| [`@real-a11y-dev/inspector`](/packages/inspector) | Framework-agnostic inspector. `createInspector({ root, container })` mounts the tree panel into any DOM node, isolated via Shadow DOM. | `preact` (bundles `core` plus the internal `semantic-navigator-ui`) |
| [`@real-a11y-dev/react`](/packages/react) | React integration — `<SemanticNavigator />` component + `useSemanticTree()` / `useActiveModal()` hooks. Wraps `inspector` for inline and floating modes. | `react >= 18`, `react-dom >= 18` |
| [`@real-a11y-dev/testing`](/packages/testing) | Headless audit helpers — `auditSnapshot`, `outlineSnapshot`, `tabSequenceSnapshot`, `flow()`, plus the interaction-diff API (`capture`, `a11yDiff`). Re-exports the `assert*`/`collectFindings` surface from the internal `audit` and the serializers from the internal `serialize` — with both private, this is where that vocabulary is published. A separate `/playwright` entrypoint ships a `Page`-handle adapter that injects the internal `browser` driver's page-bundle for real-browser E2E. **No UI.** | `@real-a11y-dev/core` (bundles the internal `browser`, `audit`, `serialize`, and `validate`; optional: `@playwright/test`) |
| [`@real-a11y-dev/storybook-addon`](/packages/storybook-addon) | Storybook 8 panel — preview-side extractor posts tree snapshots over the Storybook channel; manager-side React panel renders them. | `storybook >= 8`, `react >= 18` (the manager entry bundles the internal `semantic-navigator-ui`) |
| [`@real-a11y-dev/mcp`](/packages/mcp) | Model Context Protocol server exposing `audit_page` / `get_semantic_tree` / `inspect_page`, plus **a11y snapshot checkpoints** (`checkpoint_findings` / `diff_findings` / …), to AI agents (bin `real-a11y-mcp`). Also the published home for `BrowserSession` and its session types, which an embedder needs in order to hand `buildServer` a session of its own. | `@real-a11y-dev/core`, `@modelcontextprotocol/sdk` (bundles the internal `browser`, `audit`, `serialize`, `snapshot`, and `session-registry`; optional peer: `playwright`) |
| [`@real-a11y-dev/cli`](/packages/cli) | The `real-a11y` shell command — audits, perception views (`tree` / `outline` / `tabs` / `list` / `inspect`), and `snapshot` + `diff` from the shell and CI. A command, not a library — and with `snapshot` internal there is no library to import, so `--format json` and `-o` on `snapshot` / `diff` are the programmatic surface. | `@real-a11y-dev/core` (bundles the internal `browser`, `audit`, `serialize`, `snapshot`, and `session-registry`; optional peer: `playwright`) |

### Internal — bundled, not published

These live in the same repo and their code still ships; it ships *inside* the packages above. tsup's `noExternal` inlines the JS and `dts.resolve` inlines the declarations, so no published `.d.ts` names them either — there is nothing to install and no version to pin. The line isn't drawn by the build: a package is on npm because someone installs it on purpose, so a seam that exists to keep the source tidy belongs here. The six are not all the same kind of seam, though. `ui` and `validate` were never named by a published declaration; `serialize`'s and `audit`'s vocabulary was, so `testing` re-exports it rather than leaving it stranded — that is its only published home. `snapshot` is the exception — nothing re-exports it, and running the CLI or the MCP tools is the only way to reach it. `browser` sits between the two: `mcp` re-exports the five names its embedding contract needs (`BrowserSession` and its session types) and nothing else, so the driver itself is something you run rather than install.

| Package | Purpose | Reaches you through |
|---|---|---|
| [`@real-a11y-dev/serialize`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/serialize) | Deterministic text serialization of the tree — full tree, heading outline, and tab sequence. **No UI.** Published up to `0.1.0-beta.12`. | `testing`, which re-exports `extract`, `SerializeOptions`, and the `auditSnapshot` / `outlineSnapshot` / `tabSequenceSnapshot` serializers; also inlined into `browser`, `cli`, `mcp`, and the extension |
| [`@real-a11y-dev/audit`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/audit) | Audit engine — the `Finding` data model, the a11y rule set, `collectFindings`, and the `assert*` primitives. The one place a finding is defined and detected. **No UI.** Published up to `0.1.0-beta.12`. | `testing`, which re-exports `Finding`, `A11yRule`, `ALL_RULES`, `collectFindings` and the `assert*` primitives, and `mcp`, which re-exports `Finding`; also inlined into `browser` and `cli` |
| [`@real-a11y-dev/snapshot`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/snapshot) | Snapshot engine — deterministic finding fingerprints, the diffable `a11y-snapshot.json` artifact, the findings/views/unified diff, and baselines. Node-only; the single place a snapshot is captured and compared, so the CLI and MCP diff identically. **No UI.** Published up to `0.1.0-beta.12`. | Nothing re-exports it. `cli` (`real-a11y snapshot` / `real-a11y diff`, both take `--format json` and `-o`) and `mcp`'s checkpoint tools are the only way to run it |
| [`@real-a11y-dev/browser`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/browser) | Browser driver — the Playwright `BrowserSession` plus the injected page-bundle it ships. The one place that touches Playwright; the CLI, the MCP server, and the testing adapter all drive a real Chromium through it. Published up to `0.1.0-beta.13`. | `cli` and `mcp` by running them, and `testing`'s Playwright adapter, which injects its page-bundle. `mcp` also re-exports `BrowserSession`, `A11ySession`, `BrowserSessionOptions`, `PageSnapshot` and `SnapshotOptions` for the `SessionManager` contract; the rest of the surface (`nativeTree`, `resolveTarget`, `PAGE_BUNDLE_SOURCE`, the Chrome-resolution helpers) has no published home |
| [`@real-a11y-dev/semantic-navigator-ui`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/ui) | Preact tree-view components — TreePanel, TreeNode, FilteredList, TabSequenceView, theming CSS. Published up to `0.1.0-beta.11`. | `inspector` (and so `react`, which depends on it), `storybook-addon`'s manager entry |
| [`@real-a11y-dev/validate`](https://github.com/real-a11y/real-a11y-dev/tree/main/packages/validate) | ARIA-semantics validation — per-node rules plus tree-level relationship checks, backed by `aria-query` so it tracks the spec. No internal deps. Published up to `0.1.0-beta.7`. | `testing`, where the `toBeValidA11yTree` matcher runs the rules |

`@real-a11y-dev/semantic-navigator-extension` is internal too, but it isn't a library: it builds the Chrome extension from the same engine and ships through the Chrome Web Store, not a registry.

---

## Dependency graph

```
  @real-a11y-dev/core — extraction, queries, role constants (no UI, no deps)
        │
        ├─▶ semantic-navigator-ui (Preact)  ─▶ inspector ─▶ react
        │                                    └─▶ storybook-addon
        ├─▶ serialize   (deterministic text)
        └─▶ audit       (Finding model, rules, collectFindings, assert*)
                 │
                 ├─▶ snapshot   (fingerprints, artifact, findings/views diff, baselines — Node-only)
                 ├─▶ browser    (Playwright BrowserSession + the injected page-bundle)
                 ├─▶ testing    (matchers, interaction diff; adapter injects the inlined browser bundle)
                 ├─▶ mcp        (MCP server + checkpoints)  ── inlines → browser, snapshot
                 └─▶ cli        (the real-a11y shell, bin-only)  ── inlines → browser, snapshot

  npm resolves:  cli → { core }    mcp → { core }    testing → { core }
  browser is the ONLY package that touches Playwright — everything above it is browserless,
  and it is inlined into all three of them now rather than installed beside them.
  audit is imported directly by every surface — no reaching the findings engine through the test-helper package.
  snapshot is Node-only (node:crypto) and never enters the page bundle; browser *builds* it.
  Internal:    serialize, audit → inlined into browser, testing, cli, mcp (serialize also into the extension);
               testing re-exports their vocabulary; that is its only published home.
               snapshot → inlined into cli and mcp; nothing re-exports it — you run it, through
               real-a11y snapshot / real-a11y diff or the MCP checkpoint tools.
               browser → inlined into cli, mcp and testing; mcp re-exports BrowserSession and the
               session types an embedder must name, and nothing else — the driver you reach by
               running one of the three.
               semantic-navigator-ui → bundled into inspector and the addon's manager entry;
               react gets it through its inspector dependency.
               validate (aria-query only, no internal deps) → bundled into testing.
               semantic-navigator-extension — the Chrome extension, never on npm.
  Nothing on that list is installable; it ships inside the packages named beside it.
```

Two observations:

1. **`@real-a11y-dev/testing` and the internal `snapshot` have zero UI dependency.** Assertions, snapshots, and diffs only read the tree or operate on data; they never render. That's what makes them safe for jsdom and Node and fast enough to run in every unit test.
2. **Internal packages are bundled into their consumers, not installed alongside them.** `inspector` and the Storybook addon's manager entry pull `@real-a11y-dev/semantic-navigator-ui` through `noExternal` in tsup (`react` gets it transitively, through `inspector`); `testing` does the same with `browser`, `validate`, `audit` and `serialize`, `browser` itself with `audit` and `serialize`, and `cli` and `mcp` with `browser`, `session-registry`, `audit`, `serialize` and `snapshot`. Consumers only ever install the top-level package; they never reason about Preact versions or tree-view internals, and never resolve a name npm has no copy of.

---

## Why this split

### Engine separate from renderer
Everything useful about the extraction engine (tree walk, role map, accessible-name computation, tab-sequence derivation, action dispatch) is framework-agnostic tree manipulation. Keeping it in `@real-a11y-dev/core` with no UI dependency lets the testing package, the Playwright adapter, and downstream tooling use the engine without pulling Preact into their bundle.

### React-specific concerns live in `@real-a11y-dev/react`
React 18 concurrent-mode safety requires `useSyncExternalStore`; SSR (Next.js App Router) requires a mount-gated portal; React 19's jsx-runtime has internals that don't live in React 18. All of that React-specific complexity is isolated to one package with a clear React peer dep. Vanilla and Vue projects pay none of that cost — they use `inspector` directly.

### Testing is fully headless
`@real-a11y-dev/testing` is used by CI jobs that run in Node with no browser, by Vitest unit suites with jsdom, and by Playwright E2E jobs with a real Chromium. One API, three runtimes. Decoupling the UI makes that possible — the tree view isn't involved in any assertion path.

### The findings engine has one home
A finding — "this button has no accessible name" — is defined and detected in exactly one place: `@real-a11y-dev/audit`. The `Finding` type, the rule set, `collectFindings`, and the `assert*` primitives all live there, depending on nothing but `core`. Everything downstream only *renders* what the engine produces: `testing` re-exports it for test authors, and `mcp`/`cli` format it for agents and the shell. Keeping detection separate from presentation means a new rule is written once and every surface reports it, and a production package like `cli` never has to pull in a test-helper package to reach the engine. `audit` is internal, so nobody installs it — it is inlined into `testing`, `browser`, `cli`, and `mcp`, and the vocabulary it defines (`Finding`, `A11yRule`, `ALL_RULES`, `collectFindings`, the `assert*` primitives) is published by `testing`'s re-export, with `Finding` also by `mcp`'s. That re-export is the contract, not a shortcut.

### The snapshot engine has one home
Like a finding, a _snapshot_ — the diffable `a11y-snapshot.json`, its frozen `v1:` fingerprints, and the diff over them — is built and compared in exactly one place: `@real-a11y-dev/snapshot`, Node-only and depending on nothing but `audit`, `serialize`, and `core`. The CLI and the MCP server both capture through it and diff through it, so a snapshot taken by one and compared by the other is byte-for-byte identical: fingerprint parity stops being a discipline ("both surfaces must build the artifact the same way") and becomes structural (there is only one place the code lives). That one place is now internal, which settles what the CLI is: there is no library to import, so the engine is reached by running it. `real-a11y snapshot` and `real-a11y diff` both take `--format json` and `-o`, so the artifact and the diff stay machine-readable — you get them out of a command instead of an import, and the MCP checkpoint tools are the same engine behind a different surface. The CLI ships just its `bin`.

### The real browser lives in one place
Driving a real Chromium — launching Playwright, injecting the page-bundle, marshalling calls across `page.evaluate()` — is the one genuinely heavyweight dependency in the stack. It all lives in `@real-a11y-dev/browser`: the `BrowserSession` and the injected bundle it ships, inlining `audit`/`serialize` and depending on `core` plus an *optional* `playwright` peer. The CLI, the MCP server, and the testing Playwright adapter all drive the browser through this single package, so there is exactly one place the bundle is built and one contract for injecting it — a tree captured by any of the three is identical. Everything above `browser` is browserless and Node- or jsdom-safe; a consumer that only needs the engine never pulls Playwright into its graph. That package is internal now, which changes who installs it — nobody. The CLI, the server, and the testing adapter each inline it, so `playwright` is an optional peer of whichever of the three you installed. `mcp` re-exports `BrowserSession` and the session types (`A11ySession`, `BrowserSessionOptions`, `PageSnapshot`, `SnapshotOptions`) so an embedder can build a session to hand `buildServer`; the rest of the driver — `nativeTree`, `resolveTarget`, `PAGE_BUNDLE_SOURCE`, the Chrome-resolution helpers — is reached by running a surface, not importing one.

### Internal packages are bundled, not shipped separately
`@real-a11y-dev/semantic-navigator-ui` and `@real-a11y-dev/validate` could each have been a normal dependency — both were, through `0.1.0-beta.11` and `0.1.0-beta.7`. Nobody was ever told to install them: the only `npm install` lines were in their own READMEs, and no published declaration named their types. That second half is what separates them from the three that followed. What a consumer wants is the exact version the parent package was tested against, which is what `noExternal` already gave them; making that official removes an entire class of peer-range support questions and lets both refactor freely inside any release that updates their consumers. The rule the split now follows: a package is published because someone installs it on purpose, not because the build happens to split there — and that reads on the rest of the graph too, since an engine seam is a seam whether or not it has a registry entry.

That is what happened next: `serialize`, `audit`, and `snapshot` — published through `0.1.0-beta.12` — went internal for the same reason. They differ from the first two in the one way that mattered: their types *were* named by published declarations, so the move had to keep the vocabulary reachable rather than merely stop shipping a tarball. `testing` re-exports `Finding`, `A11yRule`, `ALL_RULES`, `collectFindings`, the `assert*` primitives, `extract`, `SerializeOptions`, and the three snapshot serializers — `testing` is the only published home for any of it. `snapshot` had nothing to re-export — its surface is an engine you run, not a vocabulary you name — so it reaches users as the CLI's `snapshot` / `diff` commands and the MCP checkpoint tools, and anyone who was importing it has no drop-in.

`browser` was next, through `0.1.0-beta.13`, and it makes the rule read on the heaviest package in the tree rather than the lightest. It is the only one that touches Playwright and the only one that ships a page-bundle, but nobody arrived at it on purpose either: every consumer met it through the CLI, the MCP server, or the testing adapter, and the peer-dependency question it raised (`playwright`, optional) was always really theirs to answer. Five names keep a published home — `mcp` re-exports `BrowserSession` with `A11ySession`, `BrowserSessionOptions`, `PageSnapshot` and `SnapshotOptions`, because `buildServer` takes an `A11ySession` and a contract you cannot name is a contract you cannot implement. The rest of the driver has no drop-in: it is something you run, through `real-a11y`, the MCP tools, or `attach(page)` in a Playwright suite.

Bundling a private package is two halves, not one. `noExternal` inlines the JS; `dts.resolve` inlines the declarations. Skip the second and the emitted `.d.ts` still says `from "@real-a11y-dev/validate"` — a specifier npm cannot resolve, which is `TS2307` for a consumer, or, under `skipLibCheck: true`, types silently degrading to `any`. `surface:check` fails on exactly that, so it is enforced rather than remembered.

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
- **Internal packages are inlined** — `inspector` and the addon's `manager` entry set `noExternal` for `@real-a11y-dev/semantic-navigator-ui` (plus `core`); `testing` does it for `browser`, `validate`, `audit`, and `serialize`; `browser` itself for `audit` and `serialize`; `cli` and `mcp` for `browser`, `session-registry`, `audit`, `serialize`, and `snapshot`. Any entry whose declarations could *name* a private package pairs `noExternal` with `dts: { resolve: [...] }` — `testing`, `browser`, `mcp`, the addon's `manager` — because otherwise the shipped `.d.ts` keeps an import npm cannot resolve. `mcp` is the sharpest case: `server.d.ts` re-exports five names straight *from* `browser`, so the resolve entry is what turns them into inlined declaration text instead of a specifier npm has no copy of. `cli` is the exception: its entries are the `bin` and the daemon, and neither exports a type.

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
