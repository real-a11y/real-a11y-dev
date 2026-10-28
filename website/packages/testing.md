---
title: "@real-a11y-dev/testing — a11y audits for Vitest, Jest, Playwright"
description: Deterministic snapshots and structural assertions for the accessibility tree. Works in jsdom out of the box; Playwright adapter ships for real-browser E2E.
---

# @real-a11y-dev/testing

> **TL;DR** — Accessibility-tree snapshots, structural assertions, custom `expect` matchers, and a fluent `flow()` interaction chain. Works in jsdom (Vitest / Jest) out of the box; add `@real-a11y-dev/testing/playwright` for real-browser E2E. Reach for this **in your test suite** — unit and e2e alike.

Headless accessibility audit helpers for Vitest, Jest, and Playwright. No browser required for the core helpers — they work in jsdom.

## Install

This package brings **no test runner and no DOM of its own** — it audits a DOM
you already have. So install it next to a runner and a DOM implementation:

::: code-group

```sh [Vitest]
npm install -D @real-a11y-dev/testing vitest jsdom
```

```sh [Jest]
npm install -D @real-a11y-dev/testing jest jest-environment-jsdom
```

:::

Nothing else is required. `@testing-library/react` appears throughout these docs
because it is the common way to get a container, but it is **optional** — any
`Element` works as an audit root, including one you built by hand.

## Your first passing test

Two files, no framework. Copy both and it runs.

::: code-group

```ts [vitest.config.ts]
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Required. Without it the helpers get no `document` and every test fails
    // with `document is not defined`.
    environment: "jsdom",
  },
});
```

```ts [a11y.test.ts]
import { expect, test } from "vitest";
import { treeSnapshot, assertNoUnlabeledInteractive } from "@real-a11y-dev/testing";

test("the sign-in form is labeled", () => {
  document.body.innerHTML = `
    <main>
      <h1>Sign in</h1>
      <label>Email <input name="email" /></label>
      <button>Continue</button>
    </main>
  `;
  const root = document.querySelector("main")!;

  assertNoUnlabeledInteractive(root);
  expect(treeSnapshot(root)).toMatchSnapshot();
});
```

:::

```sh
npx vitest run
```

The committed snapshot is the accessibility tree, not a DOM dump:

```
main
  heading "Sign in" (level 1)
  textbox "Email"
  button "Continue"
```

Delete the `<label>` wrapper and `assertNoUnlabeledInteractive` throws naming
the offender; rename the button and the snapshot diff is one line.

### The same, in Jest

`jest.config.js` needs the environment for the same reason:

```js
module.exports = { testEnvironment: "jsdom" };
```

The assertions are identical. The one difference that will stop you: **Jest does
not parse TypeScript on its own.** A `.ts` test fails with a Babel parse error
until you add `ts-jest` or `babel-jest`, so the transform-free quick-start is a
`.js` file:

```js
// a11y.test.js
const { treeSnapshot, assertNoUnlabeledInteractive } = require("@real-a11y-dev/testing");

test("the sign-in form is labeled", () => {
  document.body.innerHTML = `<main><h1>Sign in</h1><label>Email <input /></label><button>Continue</button></main>`;
  const root = document.querySelector("main");

  assertNoUnlabeledInteractive(root);
  expect(treeSnapshot(root)).toMatchSnapshot();
});
```

Same tree, same snapshot. Keeping your tests in TypeScript is fine — add
`ts-jest` and its preset the way you would for any Jest project; nothing about
this package changes.

### Adding the `expect` matchers

The [matchers](/packages/testing/matchers) need one setup file, registered with
your runner (`setupFiles` in Vitest, `setupFilesAfterEnv` in Jest):

```ts
import { expect } from "vitest";
import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
import "@real-a11y-dev/testing/matchers/vitest"; // types

registerA11yMatchers(expect);
```

The second import is types-only, and there is one per runner: `./matchers/vitest`,
`./matchers/jest` for Jest's global `expect`, and `./matchers/jest-globals` if you
`import { expect } from "@jest/globals"` — [which is a different type surface](/packages/testing/matchers#vitest-vs-jest-type-augmentation).

Auditing a **real browser page** instead of jsdom? That path skips all of the
above — see the [Playwright adapter](/packages/testing/playwright). Peer-version
specifics for React, Testing Library and Playwright live in
[Peer dependencies](/recipes/peer-dependencies).

## What's in the box

| Area | What it does | Page |
|---|---|---|
| **Snapshots** | Deterministic strings of the a11y tree, heading outline, and tab order — diff-friendly, safe to commit. | [Snapshots →](/packages/testing/snapshots) |
| **Assertions** | `assert*` functions that throw descriptive errors on broken structure. | [Assertions →](/packages/testing/assertions) |
| **Matchers** | The same checks as ergonomic `expect` matchers, plus the `boxedTreeSnapshot()` serializer. Vitest + Jest. | [Matchers →](/packages/testing/matchers) |
| **Flow API** | Fluent interaction chains that assert about the tree after each step. | [Flow API →](/packages/testing/flow) |
| **Playwright adapter** | Run every helper against a real browser page via `attach(page)`. | [Playwright →](/packages/testing/playwright) |

New to the idea of snapshotting the accessibility tree? Start with the concept: [**Accessibility Snapshots**](/guide/accessibility-snapshots).

## Which do I reach for?

- **Catch regressions in CI** → [Snapshots](/packages/testing/snapshots) (`treeSnapshot`, `outlineSnapshot`, `tabSequenceSnapshot`, plus `numberTabStops` for a human-read listing) committed with `toMatchSnapshot()`. For **headless page-set audits** of a deployed site — no test suite — reach for [`@real-a11y-dev/cli`](/packages/cli)'s `snapshot` / `diff` instead.
- **Assert a specific invariant** ("one `<h1>`", "no unlabeled buttons") → [Assertions](/packages/testing/assertions) or, for `expect` style, [Matchers](/packages/testing/matchers). `assertRules` runs an arbitrary subset of the rule set, and `formatFindings` renders findings for your own reporting.
- **Test an interaction** (open a menu, submit a form, dismiss a modal) → [Flow API](/packages/testing/flow).
- **Assert what an interaction _changed_** (options appeared, `aria-expanded` flipped, focus moved) → [`capture` + `a11yDiff` or `flow().expectChanges`](/packages/testing/flow#asserting-what-an-interaction-changed).
- **Audit a real, rendered page** (not jsdom) → [Playwright adapter](/packages/testing/playwright).

## The semantic tree

Every helper above reads the same tree. `extract(root, mode?)` builds it from a DOM element, in `"a11y"` mode (the default) or `"dom"`, and returns an `ExtractionResult`:

```ts
interface ExtractionResult {
  nodes: Map<string, SemanticNode>;
  rootId: string;
  focusedId?: string;            // the node that had focus, when it's in this tree
  source: { producer: "dom" | "native"; chrome?: string };
}
```

### `SemanticNode`

```ts
interface SemanticNode {
  id: string;                    // the same element keeps its id across extractions, not across reloads
  parentId: string | null;       // null only for the root
  childIds: string[];
  depth: number;
  a11y: {
    role: string;
    name: string;
    description: string;
    value?: string;              // what a screen reader announces for a field ("Spain", not "es");
                                 // "[redacted]" for a filled password, card or one-time-code field
    states: Record<string, string | boolean>; // checked, expanded, pressed, disabled…
    properties: Record<string, string>;       // aria-* properties, and a heading's "level"
    isExposedToAT: boolean;
  };
  dom?: {
    tagName: string;
    attributes: Record<string, string>;
    textContent: string | null;  // direct text-node children only
    descendantText: string;      // truncated text of the whole subtree
    isHidden: boolean;
  };
  interaction?: {
    isInteractive: boolean;
    isFocusable: boolean;
    isEditable: boolean;
    actions: ActionType[];       // click, focus, type, toggle, select…
  };
}
```

`dom` and `interaction` are optional in the type. The in-page walk this package runs always fills them, but a tree [read from Chromium](/guide/reading-the-a11y-view#two-producers) has no element behind some of its nodes. Roles follow [How roles are resolved](/guide/reading-the-a11y-view#how-roles-are-resolved), and names [Accessible Names](/guide/accessible-names).

### Queries

Each one takes an `ExtractionResult` or its `nodes` Map.

| Function | Returns |
|---|---|
| `findByRole(tree, role, options?)` | The first node with that role, in document order, or `null`. `options` narrows by `name` (a string must match the whole name, ignoring case and extra whitespace; a RegExp is tested against it), a heading's `level`, and the `checked`, `expanded`, `selected`, `pressed` and `disabled` states. Nodes hidden from assistive technology are skipped unless `includeHidden: true`. |
| `findAllByRole(tree, role, options?)` | Every such node, in document order. |
| `getOutline(tree)` | `{ id, level, name }` for each heading assistive technology can reach, in document order — what `outlineSnapshot()` and `assertHeadingOrder()` read. |
| `getTabSequence(tree)` | Focusable nodes in Tab order: positive `tabindex` ascending, then the rest in document order, leaving out `tabindex="-1"`. It doesn't model shadow roots, iframes or focus traps. |
| `linearize(tree, options?)` | Every node in document order, except those hidden from both sight and assistive technology unless `includeHidden: true`. |
| `diffTrees(before, after)` | `{ added, removed, changed }` between two extractions of the same document, matched by node id. Each `changed` entry lists the fields that differ as dot-paths, such as `"a11y.name"` or `"a11y.states.expanded"`. [`capture` + `a11yDiff`](/packages/testing/flow#asserting-what-an-interaction-changed) are built on it. |

## See it running

- **Vitest + jsdom** — [`examples/testing-vitest/`](https://github.com/real-a11y/real-a11y-dev/tree/main/examples/testing-vitest): snapshot tests, the custom matchers, `flow()` interactions, tab-sequence structure assertions.
- **Jest + ts-jest** — [`examples/testing-jest/`](https://github.com/real-a11y/real-a11y-dev/tree/main/examples/testing-jest): the minimal Jest setup for the matchers.
- **Playwright E2E** — [`examples/playwright/`](https://github.com/real-a11y/real-a11y-dev/tree/main/examples/playwright): a "good fixture" where every assertion passes and a "broken fixture" where each throws — the pattern to keep in CI.
- **CI tree-diff bot** — the [CI Diff Bot recipe](/guide/ci-diff-bot) runs [`@real-a11y-dev/cli`](/packages/cli)'s `real-a11y snapshot` (each audited page → one diffable JSON artifact) and `real-a11y diff` (new / changed / fixed findings) in a PR workflow.
