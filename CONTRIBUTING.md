# Contributing to Real A11y

Thanks for your interest in contributing to Real A11y. This guide covers how to set up the project, make changes, and submit contributions.

## Getting started

### Prerequisites

- Node.js 20 — a `.nvmrc` is provided (`nvm use` / `fnm use`), and the repo is
  pinned to `20.20.2` for [Volta](https://volta.sh) users, who get it
  automatically on `cd`. The published packages support Node 20+ (`engines`) and
  CI exercises the libraries on 20, 22, and 24, but **the docs build needs
  Node 20**: VitePress 1.6 (the latest stable) throws `ERR_REQUIRE_CYCLE_MODULE`
  on Node's newer `require(esm)` cycle enforcement, which is present in current
  Node **22.x and 24.x** — 20.x is the last line where `pnpm --filter …/website
  build` still works. The fix only exists in the still-alpha VitePress 2.0, so
  we stay on 20 for the docs until VitePress 2 ships stable.
  > **Volta gotcha:** Volta binds a global `pnpm` to whatever Node was the
  > default when you installed it, and pnpm runs the docs build on _that_ Node
  > regardless of this pin. If `pnpm exec node --version` isn't 20.x, rebind:
  > `volta install node@20 && volta install pnpm@<version>`.
- pnpm >= 9

### Setup

```bash
git clone https://github.com/real-a11y/real-a11y-dev.git
cd real-a11y
pnpm install
pnpm build
pnpm test
```

### Project structure

```
packages/
├── core/              # @real-a11y-dev/core — tree extraction, data model, interaction engine
├── ui/                # @real-a11y-dev/semantic-navigator-ui — Preact tree components
├── extension/         # Chrome extension (Side Panel + Content Script) — "Semantic Navigator"
├── inspector/         # @real-a11y-dev/inspector — framework-agnostic tree panel (Shadow DOM embed)
├── react/             # @real-a11y-dev/react — React wrapper + hooks
├── testing/           # @real-a11y-dev/testing — audit/interaction helpers (Vitest/Jest/Playwright)
└── storybook-addon/   # @real-a11y-dev/storybook-addon — per-story tree panel
```

Dependency graph:
- `extension → ui → core`
- `inspector → ui → core`
- `react → inspector → ui → core`
- `storybook-addon → ui → core` (+ `testing`)
- `testing → core` (headless — no `ui` dep)

## Development workflow

### Building

```bash
pnpm build              # Build all packages
pnpm --filter @real-a11y-dev/core build   # Build a specific package
```

### Testing

```bash
pnpm test               # Run all tests
pnpm --filter @real-a11y-dev/core test    # Test a specific package
pnpm --filter @real-a11y-dev/core test:watch  # Watch mode
```

### Testing the Chrome extension

1. Run `pnpm build`
2. Open `chrome://extensions`
3. Enable Developer mode
4. Click "Load unpacked" and select `packages/extension/dist`
5. Navigate to any page and click the extension icon

## Making changes

### Branch naming

- `feat/description` — New features
- `fix/description` — Bug fixes
- `docs/description` — Documentation changes
- `refactor/description` — Code refactoring

### Commit messages

This repo follows [Conventional Commits](https://www.conventionalcommits.org/) — enforced by a `commit-msg` git hook running [`commitlint`](https://commitlint.js.org/). Examples from our log:

```
fix(core): flatten role=presentation/none from a11y tree per ARIA spec
feat(ui+examples): decorative code-block tokens via role=presentation
chore(ci): pass NODE_AUTH_TOKEN on publish
```

Allowed types: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `style`, `perf`, `build`, `ci`, `revert`. Scope is optional and may combine packages with `+` (e.g. `ui+examples`).

If a hook complains, run `pnpm commitlint --edit .git/COMMIT_EDITMSG` to see the exact rule that fired.

### Code style

- TypeScript strict mode is enforced
- Use meaningful variable and function names
- Keep functions focused and small
- Add JSDoc comments only where the intent isn't obvious from the code

### Public vs. internal API

Real A11y has a documented [stability policy](./docs/STABILITY.md). Anything re-exported from a package's `src/index.ts` is **public** and follows the version contract. Helpers that exist only to make the public API work — node-id generators, deep utility classes, the extension's pure helpers — should be tagged `@internal` in their JSDoc so consumers know not to depend on them.

If you're touching a public symbol, ask whether the change is breaking. If it is, the PR needs a Changeset with a `minor` bump and a "Breaking change" section in the body (see [Changesets](#changesets)).

### Testing expectations

- New features in `packages/core` should include unit tests
- Role mapping changes should be tested against the WAI-ARIA specification
- UI component changes should be manually tested in both the extension and npm package contexts

### Accessibility

This is an accessibility tool — the tool itself must be fully accessible:

- Follow the [WAI-ARIA TreeView pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/) for tree components
- All interactive elements must be keyboard accessible
- Use proper ARIA roles, states, and properties
- Support both light and dark themes
- Test with a screen reader before submitting UI changes

## Submitting a pull request

1. Fork the repo and create your branch from `main`
2. Make your changes and ensure all tests pass (`pnpm test`)
3. Ensure the build succeeds (`pnpm build`)
4. **Add a changeset** if you touched any `@real-a11y-dev/*` package (see below)
5. Write a clear PR description explaining what changed and why
6. Link any related issues

### Docs preview (`/preview`)

Production docs deploy from `main` to [real-a11y.dev](https://real-a11y.dev) (GitHub Pages). To browse a PR's docs site before merge, a repo collaborator can comment **`/preview`** at the start of a PR comment (alone or followed by more text).

That triggers `.github/workflows/docs-preview.yml`, which builds the PR head and uploads it to the Cloudflare Pages project `real-a11y-docs-preview`. The bot replies with a stable URL of the form:

```text
https://pr-<number>.real-a11y-docs-preview.pages.dev
```

Comment `/preview` again after new commits to refresh. Only `OWNER` / `MEMBER` / `COLLABORATOR` comments run the deploy (fork authors without write access cannot trigger it). You can also run **Actions → Docs preview → Run workflow** and pass a PR number.

When the PR is **merged or closed**, the same workflow deletes every Cloudflare Pages deployment on the `pr-<number>` branch (including the stable alias), so preview URLs stop serving.

### Changesets

Versioning and per-package CHANGELOGs are managed by [Changesets](https://github.com/changesets/changesets). If your PR changes a publishable package, run:

```bash
pnpm changeset
```

…and follow the prompts. The CLI writes a `.changeset/<random-name>.md` file describing the bump — commit it with the rest of your changes.

Notes:

- All `@real-a11y-dev/*` packages are **linked** — they bump together so consumers see a consistent version across `core`, `ui`, `inspector`, `react`, `testing`, and `storybook-addon`.
- The extension, website, and examples are ignored — no changeset is needed for them.
- Docs-only or tooling-only PRs don't need a changeset.

## Reporting issues

When reporting a bug, please include:

- Browser and version
- Steps to reproduce
- Expected vs actual behavior
- The page URL (if the issue is specific to a page's DOM structure)

## Code of conduct

Be respectful, constructive, and inclusive. We're building tools to make the web more accessible — let's make our community accessible too.
