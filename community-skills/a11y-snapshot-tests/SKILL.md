---
name: a11y-snapshot-tests
description: >-
  Add Real A11y tests with @real-a11y-dev/testing: tree/outline/tab snapshots,
  assert* helpers, expect matchers, flow() interactions, and the Playwright
  attach(page) adapter. Use for Vitest, Jest, or Playwright a11y coverage in a
  test suite.
---

# Accessibility snapshot tests

Use `@real-a11y-dev/testing` **inside the test suite**. For deployed URL gates
without a test runner, use `gate-ci-a11y` (CLI) instead.

Docs: https://real-a11y.dev/packages/testing

## Install

The package brings no runner and no DOM — install next to both:

```sh
# Vitest
npm i -D @real-a11y-dev/testing@beta vitest jsdom

# Jest
npm i -D @real-a11y-dev/testing@beta jest jest-environment-jsdom
```

Vitest **requires** `environment: "jsdom"` or every helper fails with
`document is not defined`.

## First test

```ts
import { expect, test } from "vitest";
import {
  treeSnapshot,
  assertNoUnlabeledInteractive,
} from "@real-a11y-dev/testing";

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

Committed snapshots are accessibility trees, not DOM dumps.

## Deeper toolkit (load docs as needed)

- Assertions: https://real-a11y.dev/packages/testing/assertions
- Snapshots (`treeSnapshot`, `outlineSnapshot`, `tabSequenceSnapshot`):
  https://real-a11y.dev/packages/testing/snapshots
- Matchers (`registerA11yMatchers`) — import the types for the correct runner
  (`matchers/vitest` vs `jest` vs `jest-globals`):
  https://real-a11y.dev/packages/testing/matchers
- `flow()` interactions (`findByRole`, `click`, `expectChanges`, …):
  https://real-a11y.dev/packages/testing/flow
- Playwright: `attach(page)` from `@real-a11y-dev/testing/playwright` —
  https://real-a11y.dev/packages/testing/playwright

`flow()` complements Testing Library / `userEvent`; it does not replace them.

## Pitfalls

- Follow **published** install steps only — missing jsdom/config in the docs is a
  product bug, not something to silently patch from memory.
- Jest + TypeScript needs the project’s usual ts-jest/babel setup.
- Keep snapshots stable: avoid non-deterministic names/content in the audited
  subtree.

## Related

- CI URL diffs without a suite → `gate-ci-a11y`
- Which package → `choose-real-a11y-surface`
