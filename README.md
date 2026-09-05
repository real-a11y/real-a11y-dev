# Real A11y

[![Status: Beta](https://img.shields.io/badge/status-beta-orange)](#status)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![npm (@real-a11y-dev/cli)](https://img.shields.io/npm/v/@real-a11y-dev/cli?label=%40real-a11y-dev%2Fcli)](https://www.npmjs.com/package/@real-a11y-dev/cli)
[![Node](https://img.shields.io/node/v/@real-a11y-dev/cli)](https://nodejs.org)

**Accessibility tooling built on the semantic tree — what assistive tech actually perceives, extracted as plain data.** Reach it six ways: a shell command, a testing library, an MCP server for AI agents, an embeddable panel (plain JS, React, or Storybook), and a Chrome extension.

> **Beta.** APIs across the `0.1.x` line may change before `0.2.0`. Feedback and issues very welcome — see [Status](#status).

📖 **Full documentation: [real-a11y.dev](https://real-a11y.dev)**

## Why

Rule checkers — axe, WAVE, Lighthouse — catch broken individual elements: a missing label, invalid ARIA, failing contrast. What they can't tell you is whether the heading structure is skimmable, whether tab order follows the visual flow, or where focus landed after the modal closed. Those are questions about the tree as a whole.

Real A11y extracts that tree — roles, accessible names, states, focus, live regions — so you can read it, assert on it, diff it across a change, and act through it. If a page doesn't make sense as a tree, it doesn't make sense at all.

→ [Why Real A11y?](https://real-a11y.dev/guide/why) covers the positioning against axe and Testing Library, including where they're the better tool.

## Pick your surface

| I want to… | Package | |
|---|---|---|
| Audit a URL from the shell, gate CI, diff a11y across a PR | [`@real-a11y-dev/cli`](https://real-a11y.dev/packages/cli) | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/cli)](https://www.npmjs.com/package/@real-a11y-dev/cli) |
| Assert on accessibility in Vitest, Jest, or Playwright | [`@real-a11y-dev/testing`](https://real-a11y.dev/packages/testing) | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/testing)](https://www.npmjs.com/package/@real-a11y-dev/testing) |
| Give an AI agent audit and semantic-tree tools | [`@real-a11y-dev/mcp`](https://real-a11y.dev/packages/mcp) | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/mcp)](https://www.npmjs.com/package/@real-a11y-dev/mcp) |
| Embed a live tree panel in any web app | [`@real-a11y-dev/inspector`](https://real-a11y.dev/packages/inspector) | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/inspector)](https://www.npmjs.com/package/@real-a11y-dev/inspector) |
| …the same panel, as a React component + hooks | [`@real-a11y-dev/react`](https://real-a11y.dev/packages/react) | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/react)](https://www.npmjs.com/package/@real-a11y-dev/react) |
| …the same panel, on every Storybook story | [`@real-a11y-dev/storybook-addon`](https://real-a11y.dev/packages/storybook-addon) | [![npm](https://img.shields.io/npm/v/@real-a11y-dev/storybook-addon)](https://www.npmjs.com/package/@real-a11y-dev/storybook-addon) |
| Explore any site with no setup at all | [Chrome extension](https://real-a11y.dev/guide/chrome-extension) | [Web Store](https://chromewebstore.google.com/detail/semantic-navigator/gnnepgbbecnlomngfemkadnbeaopleom) |

Install everything under `devDependencies` — this is a developer-time audit suite, not runtime infrastructure. [Getting started](https://real-a11y.dev/guide/getting-started) walks through each stack.

## Quick start

**Audit from the shell.** Playwright is an optional peer dependency — install it to audit live URLs; local HTML files need no browser.

```bash
npm i -D @real-a11y-dev/cli@beta   # beta dist-tag while the family is in pre-release
npx real-a11y install              # downloads Chrome for Testing, first time only
npx real-a11y audit https://example.com
```

`audit` exits non-zero on screen-reader-fidelity findings — a CI gate with no config. Alongside it are perception views (`tree`, `outline`, `tabs`, `list`, `inspect`), act commands (`click`, `type`, `focus`, `interact`), and `snapshot` + `diff` for tracking regressions. → [All commands](https://real-a11y.dev/packages/cli/commands)

**Assert in tests.** The committed snapshot is the accessibility tree, not a DOM dump.

```ts
import { expect, test } from "vitest";
import { treeSnapshot, assertNoUnlabeledInteractive } from "@real-a11y-dev/testing";

test("the sign-in form is labeled", () => {
  const root = document.querySelector("main")!;

  assertNoUnlabeledInteractive(root);
  expect(treeSnapshot(root)).toMatchSnapshot();
});
```

→ [Testing docs](https://real-a11y.dev/packages/testing) · [assertions](https://real-a11y.dev/packages/testing/assertions) · [Playwright adapter](https://real-a11y.dev/packages/testing/playwright)

**Hand it to an AI agent.** `npx -y` fetches the package on first run:

```bash
npx -y @real-a11y-dev/mcp
```

Serves `audit_page`, `get_semantic_tree`, `inspect_page` and snapshot checkpoints to any MCP client. To audit pages behind a login, point `REAL_A11Y_MCP_STORAGE_STATE` at a saved Playwright session and set `REAL_A11Y_MCP_ALLOWED_ORIGINS` to pin auditing to trusted origins. Pair with [Agent Skills](https://real-a11y.dev/guide/agent-skills) for the workflows (wire-up, audit, act-then-diff). → [MCP docs](https://real-a11y.dev/packages/mcp)

**Embed a panel** in your own app — DOM, A11y, and TAB views, live-updating, with search, role filters, focus tracking, and keyboard navigation:

```ts
import { createInspector } from "@real-a11y-dev/inspector";

createInspector({
  root: document.getElementById("app"),
  container: document.getElementById("tree-panel"),
  viewMode: "a11y", // "dom" | "a11y" | "tab"
  theme: "auto", //    "light" | "dark" | "auto"
}).mount();
```

→ [Inspector docs](https://real-a11y.dev/packages/inspector) · [panel features](https://real-a11y.dev/guide/panel-features), shared by every surface that renders the tree

**Or install the Chrome extension** — [Semantic Navigator on the Web Store](https://chromewebstore.google.com/detail/semantic-navigator/gnnepgbbecnlomngfemkadnbeaopleom). Chrome may show a "Proceed with caution — not trusted by Enhanced Safe Browsing" notice on first install; that's the default for any newly listed extension, not a signal about this one. → [Extension guide](https://real-a11y.dev/guide/chrome-extension)

## Documentation

| | |
|---|---|
| [Getting started](https://real-a11y.dev/guide/getting-started) | Install and first result, per stack |
| [Agent Skills](https://real-a11y.dev/guide/agent-skills) | Workflow skills for coding agents (Cursor, Claude, …) |
| [Core concepts](https://real-a11y.dev/guide/core-concepts) | The semantic tree, and how it's built |
| [Understanding the views](https://real-a11y.dev/guide/understanding-the-views) | A11y, DOM, headings, and TAB — one page, four perspectives |
| [Architecture](https://real-a11y.dev/guide/architecture) | What each package owns and why the seams are where they are |
| [Examples](https://real-a11y.dev/examples/vanilla) | Vanilla, React, Vitest, Playwright, Storybook |
| [Troubleshooting](https://real-a11y.dev/guide/troubleshooting) | When the tree isn't what you expected |

## Packages

Six packages are published to npm (the table above); the Chrome extension ships on the Web Store. Eight more — the extraction engine, serializers, audit rules, snapshot engine, browser driver, session registry, ARIA validation, and the Preact tree components — are **internal**: their code ships bundled inside the published packages, so there is nothing to install and no version to pin. [`packages/`](./packages) has the source, and the [architecture guide](https://real-a11y.dev/guide/architecture) explains each seam.

> **Migrating from a direct engine import?** Seven of the eight were published before the split and are frozen at their last beta. Most of that vocabulary moved rather than vanished — `@real-a11y-dev/testing` carries the queries, diff, serializers and `assert*` primitives; `@real-a11y-dev/mcp` carries `BrowserSession`. The extractors (`extractA11yTree`, `extractDomTree`) have no published home: run `real-a11y --format json` or the MCP tools instead. → [Full migration table](https://real-a11y.dev/guide/architecture#internal-—-bundled-not-published)

## Development

```bash
pnpm install && pnpm build && pnpm test
```

Node.js >= 20, pnpm >= 9. [CONTRIBUTING.md](./CONTRIBUTING.md) is the canonical guide — project structure, the surface manifest, branch and commit conventions, and how to get a PR merged.

## Status

Real A11y is in **public beta** (`0.1.x`). The extraction engine and the Chrome extension are stable and used in production; the npm packages are newer and may see minor API changes before `0.2.0`.

The contract for what counts as a breaking change, what's internal vs. public, and how deprecations work is in [docs/STABILITY.md](./docs/STABILITY.md).

See [SECURITY.md](./SECURITY.md) for how to report security issues, and [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) before opening an issue or PR.

## License

MIT — see [LICENSE](./LICENSE)

## About Real A11y

> "Real Accessibility is the practice of building digital products that actually hold up for real people in real conditions."

Learn more at [real-a11y.dev](https://real-a11y.dev)
