<!-- Thanks for contributing! A few quick notes before you hit Create:

1. If this is your first PR here, please skim CONTRIBUTING.md.
2. Small, focused PRs get reviewed faster than big ones.
3. If you're fixing a bug, a failing test that the fix makes pass is the gold standard.
4. If this PR is still a work-in-progress, please open it as a Draft PR.

Cutting a release or adding a package? There are tailored templates:
  gh pr create --template release.md
  gh pr create --template package.md -->

## Summary

<!-- One or two sentences describing what this PR does and why. -->

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change (API change, behavior change, dependency bump that affects consumers)
- [ ] Documentation / examples only
- [ ] Refactor / internal cleanup (no behavior change)
- [ ] CI / tooling / chore

## Packages touched

<!-- Check all that apply -->

- [ ] `@real-a11y-dev/core`
- [ ] `@real-a11y-dev/serialize`
- [ ] `@real-a11y-dev/validate`
- [ ] `@real-a11y-dev/semantic-navigator-ui`
- [ ] `@real-a11y-dev/inspector`
- [ ] `@real-a11y-dev/react`
- [ ] `@real-a11y-dev/testing`
- [ ] `@real-a11y-dev/storybook-addon`
- [ ] Chrome extension
- [ ] Website / docs / examples

## How to verify

<!-- Concrete steps a reviewer can run on a fresh checkout of this branch: the
     commands to run and what they should see. (These double as your own test
     record — run them before opening.) For a bug fix, point at the regression
     test that fails without the change.

     Example:
       pnpm i && pnpm --filter @real-a11y-dev/cli build
       node packages/cli/dist/index.js audit https://example.com
         -> exits 1 and lists the unlabeled-button finding
     UI / docs: pnpm --filter @real-a11y-dev/website dev -> open the page ->
       confirm the change renders (check the console and dark mode too). -->

- [ ] The steps above run clean on a fresh checkout of this branch
- [ ] `pnpm verify` passes (build + typecheck + format + lint + test — the gate CI and the pre-push hook run)
- [ ] Added / updated tests where appropriate

## Changesets & release

<!-- Skip only for docs / examples / CI-only PRs. -->

- [ ] Changeset added for every published-package change (`pnpm changeset`; confirm with `pnpm changeset:status`)
- [ ] Changed `core` or `semantic-navigator-ui`? The packages that bundle them — `inspector`, `storybook-addon`, and the Chrome extension — are re-released too, so none ships a stale engine (`pnpm bundlers:check`)

## Linked issues

<!-- "Fixes #123" or "Related to #456" -->

## Notes for reviewers

<!-- Anything reviewers should pay extra attention to, or context that isn't obvious from the diff -->
