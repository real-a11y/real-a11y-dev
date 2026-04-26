# Vitest integration example — `@real-a11y-dev/testing`

Uses `@real-a11y-dev/testing` inside plain Vitest + jsdom to audit rendered React components without a real browser.

## What this shows

- `auditSnapshot(root)` as a deterministic, diff-friendly snapshot for CI
- `outlineSnapshot(root)` — heading outline audits (regression-catches missing `<h1>`, skipped levels)
- `tabSequenceSnapshot(root)` — focus-order regression tests
- `assertHeadingOrder`, `assertNoUnlabeledInteractive`, `assertDialogsLabeled`, `assertLandmarkStructure` as one-liner assertions inside `expect`
- Using the Vitest serializer so `toMatchSnapshot()` produces semantic, not DOM, output

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
- [`src/snapshot.test.ts`](./src/snapshot.test.ts) — `auditSnapshot` / `outlineSnapshot` / `tabSequenceSnapshot`
- [`src/assertions.test.ts`](./src/assertions.test.ts) — the assertion helpers
- [`src/__snapshots__/`](./src/__snapshots__) — committed snapshots; edit them intentionally, never blindly

## See also

- [`@real-a11y-dev/testing` package docs](../../packages/testing)
- [`@real-a11y-dev/testing/playwright` adapter](../../packages/testing#playwright) for browser-based E2E audits
