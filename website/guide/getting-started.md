---
title: Getting Started
description: Install any Real A11y package and get accessibility insights in 30 seconds. Covers Vite, React, Vitest, Playwright, and Storybook stacks.
---

# Getting Started

Real A11y is a suite of packages built around a single engine: `@real-a11y-dev/core`. Each package is independently installable — use just the ones you need.

## Pick your entry point

| I want to… | Install | Dep type |
|---|---|---|
| Embed an interactive tree panel in any web app | [`@real-a11y-dev/inspector`](/packages/inspector) | **dev** (recommended) |
| Write accessibility assertions in Vitest / Jest | [`@real-a11y-dev/testing`](/packages/testing) | **dev** |
| Run accessibility assertions in Playwright E2E tests | [`@real-a11y-dev/testing/playwright`](/packages/testing/playwright) | **dev** |
| Use React hooks and a `<SemanticNavigator />` component | [`@real-a11y-dev/react`](/packages/react) | **dev** (recommended) |
| Add an A11y tree panel to every Storybook story | [`@real-a11y-dev/storybook-addon`](/packages/storybook-addon) | **dev** |
| Run accessibility audits from the shell / CI (no code) | [`@real-a11y-dev/cli`](/packages/cli) | **dev** |
| Give an AI agent accessibility audit tools | [`@real-a11y-dev/mcp`](/packages/mcp) | run via `npx` |
| Build your own tooling on the extraction engine | [`@real-a11y-dev/core`](/packages/core) | depends (see below) |

::: tip Install as a dev dependency by default
Real A11y is a **developer-time audit suite**, not runtime infrastructure. Install everything under `devDependencies` (`-D` / `--save-dev`) and gate any UI it renders on a development build flag. That way the tree extractor, Preact renderer, and accessibility heuristics never reach your production bundle.

See [Keep it out of production](#keep-it-out-of-production) below for the gating patterns.

The only time you want a **runtime** dependency is if you're building your own *published* tooling on top of `@real-a11y-dev/core` (e.g. another testing library or an audit service) — then `core` belongs in your regular `dependencies` or, better, `peerDependencies`.
:::

---

## Quick install

All packages are installed as dev dependencies below. This is the right default for apps.

::: code-group

```sh [npm]
# Framework-agnostic embed (dev panel)
npm install -D @real-a11y-dev/inspector

# Testing helpers (Vitest / Jest)
npm install -D @real-a11y-dev/testing

# Playwright E2E adapter (needs @playwright/test as peer)
npm install -D @real-a11y-dev/testing @playwright/test

# React wrapper — hooks + <SemanticNavigator /> component
npm install -D @real-a11y-dev/react

# Storybook addon
npm install -D @real-a11y-dev/storybook-addon
```

```sh [pnpm]
pnpm add -D @real-a11y-dev/inspector
pnpm add -D @real-a11y-dev/testing
pnpm add -D @real-a11y-dev/testing @playwright/test
pnpm add -D @real-a11y-dev/react
pnpm add -D @real-a11y-dev/storybook-addon
```

```sh [yarn]
yarn add -D @real-a11y-dev/inspector
yarn add -D @real-a11y-dev/testing
yarn add -D @real-a11y-dev/testing @playwright/test
yarn add -D @real-a11y-dev/react
yarn add -D @real-a11y-dev/storybook-addon
```

:::

---

## Your first tree in 30 seconds

### CLI (no code)

The fastest first result: audit or inspect any URL straight from the shell. The CLI drives a real browser via Playwright, so install it alongside a Chromium binary:

```sh
npm i -D @real-a11y-dev/cli playwright
npx playwright install chromium
```

```sh
# The CI gate — exits non-zero when a screen-reader-fidelity error is found:
npx real-a11y audit https://example.com

# Or just look at what assistive tech perceives — no test file, no config:
npx real-a11y tree https://example.com
npx real-a11y outline https://example.com
```

In CI, pick a machine envelope and the failure threshold:

```sh
npx real-a11y audit https://example.com --format json --fail-on error
```

`--fail-on error` is the default (`warning` | `never` also available). See [`@real-a11y-dev/cli`](/packages/cli) for `snapshot` / `diff`, device emulation, and auditing pages behind a login.

---

### Framework-agnostic embed

```ts
import { createInspector } from "@real-a11y-dev/inspector";

const sn = createInspector({
  root: document.getElementById("app")!,
  container: document.getElementById("sn-panel")!,
  mode: "a11y",
  // Shadow DOM isolation is on by default — no CSS conflicts.
});

sn.mount();
```

The panel renders inside a ShadowRoot attached to `#sn-panel`. Your app's CSS cannot leak in; the panel's CSS cannot leak out.

---

### React

```tsx
import { SemanticNavigator, useSemanticTree } from "@real-a11y-dev/react";

function App() {
  const rootRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={rootRef}>
      <YourApp />
      <SemanticNavigator root={rootRef} mode="a11y" />
    </div>
  );
}
```

Or use the hook for headless access to tree data:

```tsx
function TreeDebugger({ rootRef }) {
  const tree = useSemanticTree(rootRef, { mode: "a11y" });

  if (!tree) return null;
  return <pre>{JSON.stringify(tree, null, 2)}</pre>;
}
```

---

### Testing (Vitest / Jest)

```ts
import { auditSnapshot, assertNoUnlabeledInteractive } from "@real-a11y-dev/testing";
import { render } from "@testing-library/react";

test("login form is fully labeled", () => {
  const { container } = render(<LoginForm />);

  // Throws with a clear message if any interactive element is unlabeled.
  assertNoUnlabeledInteractive(container);

  // Deterministic string snapshot of the A11y tree — great for CI.
  expect(auditSnapshot(container)).toMatchSnapshot();
});
```

Those are the **function-style** helpers — zero setup. Prefer the jest-axe-style `expect` matchers? Register them once in a setup file and the same checks read as native matchers (Vitest **and** Jest):

```ts
import { a11ySnapshot } from "@real-a11y-dev/testing/matchers";

test("login form is fully labeled", () => {
  const { container } = render(<LoginForm />);

  expect(container).toHaveNoUnlabeledInteractive();
  expect(container).toHaveValidHeadingOrder();
  expect(a11ySnapshot(container)).toMatchSnapshot();
});
```

See [Matchers](/packages/testing/matchers) for the one-time `registerA11yMatchers(expect)` setup, and [Accessibility Snapshots](/guide/accessibility-snapshots) for what the snapshot captures and why it complements axe.

---

### Playwright (E2E)

```ts
import { test, expect } from "@playwright/test";
import { attach } from "@real-a11y-dev/testing/playwright";

test("home page accessibility", async ({ page }) => {
  await page.goto("/");
  const sn = await attach(page);

  // Structural assertions — throw with descriptive messages on failure
  await sn.assertHeadingOrder();
  await sn.assertNoUnlabeledInteractive();
  await sn.assertLandmarkStructure();

  // Deterministic snapshot — commit to version control
  expect(await sn.auditSnapshot()).toMatchSnapshot();
});
```

The adapter injects the audit engine into the real browser page. No changes to your app code required.

---

### Storybook addon

Add to `.storybook/main.ts`:

```ts
export default {
  addons: ["@real-a11y-dev/storybook-addon"],
};
```

That's it. A **Semantic Navigator** panel appears next to Controls and A11y for every story, showing the tree, heading outline, and tab sequence — updated live while the panel is open.

---

## Requirements

| Package | Node | Browser / Runtime |
|---|---|---|
| `@real-a11y-dev/core` | ≥ 20 | Any modern browser, jsdom |
| `@real-a11y-dev/inspector` | ≥ 20 | Modern browser (Shadow DOM required) |
| `@real-a11y-dev/testing` | ≥ 20 | jsdom or real browser |
| `@real-a11y-dev/react` | ≥ 20 | React ≥ 18, modern browser |
| `@real-a11y-dev/storybook-addon` | ≥ 20 | Storybook ≥ 8 |
| `@real-a11y-dev/cli` | ≥ 20 | Real browser via optional peer `playwright` (lazily imported) |
| `@real-a11y-dev/mcp` | ≥ 20 | Real browser via optional peer `playwright` (lazily imported); runs in any MCP client |

---

## Keep it out of production

`@real-a11y-dev/inspector` and `@real-a11y-dev/react` render a full tree view (~23 KB gzipped for `inspector`, plus Preact; see [`.size-limit.json`](https://github.com/real-a11y/real-a11y-dev/blob/main/.size-limit.json) for the gated budgets). If you drop `<SemanticNavigator />` or `createInspector()` into a component that ships to production, bundlers can't tree-shake the renderer away — *the reference exists at runtime*. You want it dev-only.

Two patterns, pick the one that matches your toolchain.

### Pattern 1 — static gate (ideal, fully tree-shaken)

Your bundler erases a `false`-branch at build time. Works with Vite, Rollup, webpack, esbuild.

::: code-group

```tsx [Vite / React]
// DevA11y.tsx
import { lazy, Suspense } from "react";

const SemanticNavigatorLazy = lazy(async () => {
  const mod = await import("@real-a11y-dev/react");
  return { default: mod.SemanticNavigator };
});

export function DevA11y({ rootRef, ...props }) {
  if (!import.meta.env.DEV) return null; // Vite replaces with `false` in prod
  return (
    <Suspense fallback={null}>
      <SemanticNavigatorLazy root={rootRef} {...props} />
    </Suspense>
  );
}
```

```tsx [webpack / Next.js]
// DevA11y.tsx
import dynamic from "next/dynamic";

const SemanticNavigatorDyn = dynamic(
  () => import("@real-a11y-dev/react").then((m) => m.SemanticNavigator),
  { ssr: false }
);

export function DevA11y({ rootRef, ...props }) {
  if (process.env.NODE_ENV !== "development") return null;
  return <SemanticNavigatorDyn root={rootRef} {...props} />;
}
```

```ts [vanilla / any bundler]
// dev-inspector.ts
export async function mountDevInspector(root: HTMLElement, container: HTMLElement) {
  if (process.env.NODE_ENV === "production") return; // erased in prod builds
  const { createInspector } = await import("@real-a11y-dev/inspector");
  createInspector({ root, container, mode: "a11y" }).mount();
}
```

:::

Use it anywhere — it's a no-op in production, and the `import(...)` is code-split so the inspector chunk only loads when the gate is true.

### Pattern 2 — runtime query param (useful for staging)

You want to audit a deployed staging URL without a rebuild. Enable via `?a11y=1`.

```tsx
import { lazy, Suspense, useSyncExternalStore } from "react";

const DevInspector = lazy(() =>
  import("@real-a11y-dev/react").then((m) => ({ default: m.SemanticNavigator }))
);

function useA11yFlag() {
  return useSyncExternalStore(
    (cb) => { window.addEventListener("popstate", cb); return () => window.removeEventListener("popstate", cb); },
    () => new URLSearchParams(location.search).has("a11y"),
    () => false,
  );
}

export function OptionalA11y(props) {
  const enabled = useA11yFlag();
  if (!enabled) return null;
  return <Suspense fallback={null}><DevInspector {...props} /></Suspense>;
}
```

This ships the inspector into the production bundle (as a separate chunk) — acceptable for internal apps / staging, not ideal for consumer-facing production. Prefer Pattern 1 when you can.

### What's safe to leave in production

| Package | Safe in prod? | Notes |
|---|---|---|
| `@real-a11y-dev/core` | ✅ small, no UI | Only if you *use* it at runtime (most apps don't). ~8 KB gzipped. |
| `@real-a11y-dev/inspector` | ⚠ gate it | Ships Preact + tree view. ~40 KB gzipped total. |
| `@real-a11y-dev/react` | ⚠ gate it | Transitively includes `@real-a11y-dev/inspector`. |
| `@real-a11y-dev/testing` | ❌ dev-only | Test helpers — `-D`. |
| `@real-a11y-dev/storybook-addon` | ❌ dev-only | Storybook-only — `-D`. |

---

## Next steps

- [Core Concepts](/guide/core-concepts) — understand the semantic tree model, roles, and names
- [Accessibility Snapshots](/guide/accessibility-snapshots) — what it means to snapshot the a11y tree, and how it complements axe and visual regression testing
- [Why Real A11y?](/guide/why) — how this compares to axe-core, Testing Library, and other tools
