# Jest integration example — `@real-a11y-dev/testing`

A deliberately minimal Jest + `ts-jest` + jsdom setup that proves the custom
matchers from `@real-a11y-dev/testing/matchers` register and type-check under
**Jest** (the [Vitest example](../testing-vitest) covers the matcher behavior
in depth — the runtime matchers are framework-agnostic, so this guards the
Jest-specific registration and typing path).

## What this shows

- Registering the matchers with `registerA11yMatchers(expect)` in a Jest
  `setupFilesAfterEnv` file ([`src/setup.ts`](./src/setup.ts))
- The matchers typed on Jest's `expect` via the package's global
  `jest.Matchers` augmentation — **no separate type import needed** (Vitest
  needs `import "@real-a11y-dev/testing/matchers/vitest"`; Jest does not)
- `toHaveValidLandmarks`, `toHaveNoUnlabeledInteractive`, `toHaveTabSequence`
- The `a11ySnapshot()` serializer feeding `toMatchSnapshot()` with semantic
  (role + name) output

Resolution note: this package is CommonJS (no `"type": "module"`), so it loads
`@real-a11y-dev/testing` through the package's `require` export conditions —
the same path a typical Jest project uses.

## Run it

From the repo root:

```bash
pnpm install
pnpm --filter @real-a11y-dev/example-testing-jest test
```

## Key files

- [`jest.config.cjs`](./jest.config.cjs) — `ts-jest` preset, `jsdom` env, setup file
- [`src/setup.ts`](./src/setup.ts) — registers the matchers + serializer
- [`src/matchers.test.ts`](./src/matchers.test.ts) — the matchers and serializer under Jest

## See also

- [Vitest example](../testing-vitest) — the full matcher + `flow()` walkthrough
- [`@real-a11y-dev/testing` package docs](../../packages/testing)
