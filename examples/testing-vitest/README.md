# Vitest integration example — `@real-a11y-dev/testing`

Uses `@real-a11y-dev/testing` inside plain Vitest + jsdom to audit rendered React components without a real browser.

## What this shows

- `auditSnapshot(root)` as a deterministic, diff-friendly snapshot for CI
- `outlineSnapshot(root)` — heading outline audits (regression-catches missing `<h1>`, skipped levels)
- `tabSequenceSnapshot(root)` — focus-order regression tests
- `assertHeadingOrder`, `assertNoUnlabeledInteractive`, `assertDialogsLabeled`, `assertLandmarkStructure` as one-liner assertions inside `expect`
- `flow()` interaction chains — `select`, `submit`, `toggle`, `click`, plus `expectActiveModal` for dialog open/close assertions
- `waitForMutations()` for content that updates over time (toasts, a progress log, a streaming response) — await the tree settling, or resolve at a bounded `timeout` for a stream that never settles, then assert
- **Custom `expect` matchers** (`@real-a11y-dev/testing/matchers`) — `toHaveNoUnlabeledInteractive`, `toHaveValidHeadingOrder`, `toHaveLabeledDialogs`, `toHaveValidLandmarks`, `toHaveTabSequence`, registered once in [`src/setup.ts`](./src/setup.ts)
- The `a11ySnapshot()` serializer so `toMatchSnapshot()` produces semantic (role + name) output, not a DOM dump — including modal scoping (content behind an open dialog drops out of the tree)

## Run it

From the repo root:

```bash
pnpm install
pnpm --filter @real-a11y-dev/example-testing test
```

Watch mode:

```bash
pnpm --filter @real-a11y-dev/example-testing test:watch
```

## Key files

- [`src/fixtures.ts`](./src/fixtures.ts) — small rendered components used by the tests
- [`src/snapshot.test.ts`](./src/snapshot.test.ts) — `auditSnapshot` / `outlineSnapshot` / `tabSequenceSnapshot` (the plain functions)
- [`src/assertions.test.ts`](./src/assertions.test.ts) — the assertion helpers
- [`src/flow.test.ts`](./src/flow.test.ts) — `flow()` chains: `select`, `submit`, `toggle`, dialog open/close with `expectActiveModal`
- [`src/dynamic-content.test.ts`](./src/dynamic-content.test.ts) — `waitForMutations()` on content that updates over time: waiting for a burst to settle, and resolving at a bounded `timeout` when a stream never settles
- [`src/setup.ts`](./src/setup.ts) — registers the custom matchers + serializer (wired via `setupFiles`)
- [`src/matchers-basic.test.ts`](./src/matchers-basic.test.ts) — **simple**: each matcher in isolation, pass / `.not` / failure
- [`src/matchers-account-page.test.ts`](./src/matchers-account-page.test.ts) — **complex**: the matchers as one accessibility gate over a realistic screen, plus a `flow()`-driven modal that shows tree scoping
- [`src/__snapshots__/`](./src/__snapshots__) — committed snapshots; edit them intentionally, never blindly

## See also

- [`@real-a11y-dev/testing` package docs](../../packages/testing)
- [`@real-a11y-dev/testing/playwright` adapter](../../packages/testing#playwright) for browser-based E2E audits
