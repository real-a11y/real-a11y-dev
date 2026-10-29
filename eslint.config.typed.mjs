import tseslint from "typescript-eslint";

import base from "./eslint.config.mjs";

/**
 * Type-aware lint, run by `pnpm lint:typed` as a step of `pnpm verify`.
 *
 * Separate from `eslint.config.mjs` because these rules need type information,
 * and type information needs a build: a workspace import resolves to the
 * package's `dist/` declarations, so before `pnpm build` every cross-package
 * call reads as an unresolved type and the rules below quietly report less.
 * `pnpm lint` stays build-free so `pre-push` and lint-staged can run it; this
 * config runs only after the build, in `verify` and so in CI.
 *
 * Only rules that find bugs rather than style, each at a setting with no
 * false positives on this codebase today:
 *
 *   - `no-floating-promises` — a promise nobody awaits, catches or `void`s.
 *     Its rejection surfaces as an unhandled rejection; on a content script
 *     that is an error in the host page's console.
 *   - `no-misused-promises` — a promise where a boolean or a void callback is
 *     expected (`if (promise)`, `emitter.on("x", async …)`). JSX attributes
 *     are exempt: Preact and React discard a handler's return value, and an
 *     async handler's rejection is reported just as a sync handler's throw is.
 *   - `await-thenable` — `await` on something that isn't a promise, including
 *     `Promise.allSettled` over values that aren't all promises.
 *   - `switch-exhaustiveness-check` — a switch over a union that misses a
 *     member, so a new message type can't fall through unhandled. A `default`
 *     clause counts as handling the rest.
 *
 * No `eslint-disable` for these rules: `pnpm lint` doesn't run them, so it
 * would report the directive as unused. Restructure the code instead (`void`
 * a promise whose rejection is already handled inside, or add the missing
 * case). For the same reason this run doesn't judge other rules' directives,
 * and it loads every plugin `eslint.config.mjs` loads so that a directive
 * naming one of their rules still resolves.
 *
 * Nor other rules' suppressions. ESLint applies `eslint-suppressions.json` to
 * every run, whatever the config, and this one runs none of the budget rules
 * recorded there, so each entry would read as unused and fail the run. So
 * `pnpm lint:typed` passes `--pass-on-unpruned-suppressions`; `pnpm lint` is
 * where an unused one is caught. That is also why these rules take no
 * suppressions of their own: `--suppress-rule` with this config would write
 * into the same file, and `pnpm lint` would then report the entry as unused.
 *
 * Tests are not covered yet. They hold several hundred unawaited promises, most
 * of them Preact's `act(() => …)` with a synchronous callback, which flushes
 * before it returns and leaves its promise nothing to wait for. Sorting the
 * real misses from those is its own change.
 */
const plugins = Object.assign({}, ...base.map((layer) => layer.plugins ?? {}));

export default [
  {
    ignores: [
      "**/dist/**",
      "**/dist-dogfood/**",
      "**/node_modules/**",
      "**/*.test.*",
      "**/*.spec.*",
      "**/__tests__/**",
      "**/__fixtures__/**",
    ],
  },
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    plugins,
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": [
        "error",
        { checksVoidReturn: { attributes: false } },
      ],
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/switch-exhaustiveness-check": [
        "error",
        { considerDefaultExhaustiveForUnions: true },
      ],
    },
  },
];
