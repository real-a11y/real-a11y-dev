---
---

No release. Tooling + import-order autofix only:

- `eslint --fix` reordered imports in four files (cli, validate test, extension, example-patterns) — a pure reorder, no change to behavior, types, or emitted output.
- Promoted the `import/order` ESLint rule from `warn` to `error` so the `lint` gate blocks future drift instead of letting it accumulate silently (a warning never fails CI). The rule is fully autofixable via `pnpm lint:fix`.

Nothing to tell consumers, so this is an empty changeset — present only to satisfy the `changeset` CI gate, which fires on any `packages/*/src/` edit to a published package.
