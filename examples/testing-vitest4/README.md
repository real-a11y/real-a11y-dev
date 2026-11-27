# Vitest 4 types example — `@real-a11y-dev/testing/matchers/vitest4`

A Vitest 4 project that type-checks the matcher types entry for Vitest 3 and 4, with `skipLibCheck: false`. Nothing here runs: `tsc` is the whole test.

- [`src/setup.ts`](./src/setup.ts) is the setup file a Vitest 3 or 4 project writes: `import "@real-a11y-dev/testing/matchers/vitest4"` for the types, and `registerA11yMatchers(expect)` for the runtime.
- [`src/matchers.ts`](./src/matchers.ts) calls every matcher, the `.not` and asymmetric forms, and `.resolves`, and checks that each matcher returns `void`. Two `@ts-expect-error` lines prove the checker isn't simply accepting everything.

## Run it

From the repo root:

```bash
pnpm install
pnpm --filter @real-a11y-dev/testing build
pnpm --filter @real-a11y-dev/example-testing-vitest4 typecheck
```

The root `pnpm typecheck`, and so `pnpm verify`, runs it too.

## Why it exists

`@real-a11y-dev/testing/matchers/vitest` merges into Vitest 5's `Assertion<R, T>`. An interface merge has to repeat the original's type parameters exactly, so on Vitest 3 or 4, whose `Assertion` is `Assertion<T = any>`, it reports TS2428. `./matchers/vitest4` declares that older shape instead.

The rest of this repo is on Vitest 5, which `./matchers/vitest4` deliberately doesn't match, so this project is the only place it's compiled. Two edits show what it guards:

| Change in `src/setup.ts`                       | `typecheck` reports                                                     |
| ---------------------------------------------- | ----------------------------------------------------------------------- |
| import `./matchers/vitest` instead             | `TS2428: All declarations of 'Assertion' must have identical type parameters`, in `matchers-vitest.d.ts` |
| delete the `./matchers/vitest4` import         | `TS2339: Property 'toHaveValidLandmarks' does not exist`, at every matcher |

**Keep this project on Vitest 4.** A bump to Vitest 5 makes `typecheck` fail with TS2428. That's the entry being correct for the version it targets, not a bug to fix here. Decline the bump for this project.

The `paths` entry in [`tsconfig.json`](./tsconfig.json) is a workspace workaround, explained there: without it, the entry would augment the Vitest 5 that `packages/testing` develops against, not this project's Vitest 4.
