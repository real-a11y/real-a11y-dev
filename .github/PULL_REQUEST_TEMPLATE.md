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
- [ ] `@real-a11y-dev/audit`
- [ ] `@real-a11y-dev/snapshot`
- [ ] `@real-a11y-dev/browser`
- [ ] `@real-a11y-dev/validate` (internal — ships inside `testing`)
- [ ] `@real-a11y-dev/semantic-navigator-ui` (internal — ships inside `inspector` / `storybook-addon` / the extension)
- [ ] `@real-a11y-dev/inspector`
- [ ] `@real-a11y-dev/react`
- [ ] `@real-a11y-dev/testing`
- [ ] `@real-a11y-dev/storybook-addon`
- [ ] `@real-a11y-dev/cli`
- [ ] `@real-a11y-dev/mcp`
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
- [ ] Changed `core`, `semantic-navigator-ui` or `validate`? Everything that bundles them is re-released too, so nothing ships a stale engine — `inspector`, `storybook-addon` and the Chrome extension for the first two, `testing` for `validate` (confirm with `pnpm changeset:status`)
- [ ] `validate` and `semantic-navigator-ui` are workspace-internal, not published. A changeset names the **consumers** that bundle them, never the packages themselves — one that mixes a private package in with published ones fails `pnpm changeset:status`

## Test scenarios

<!-- The Regression (pre-publish, `scenarios/regression/R*`) and Dogfood
     (post-publish, `scenarios/dogfood/D*`) suites live in the repo, so they
     diff alongside the code that breaks them: `pnpm surface:check` rejects a
     `covers:` path that isn't in `docs/surface.json`, and fails when a shipped
     command or MCP tool has no Active row at all. Notion now holds only the
     per-run `Result` / `Notes`; nothing there is authoritative about what a
     scenario says.

     What no check can see is whether a row still describes a *sensible* test.
     That part is editorial and rots the way docs do, so name the IDs. "None"
     is a fine answer; a blank is not, because a blank is indistinguishable
     from having forgotten.

     `pnpm surface:plan` prints this block ready to paste — IDs resolved from
     each row's `covers:`, version stamps filled in from your changesets. Format
     and rules: `scenarios/README.md` and `.claude/skills/pr/SKILL.md` §4b. -->

- **Added:** <!-- R23 — CLI act path -->
- **Updated:** <!-- R8 — tool list is now 20 -->
- **Deprecated:** <!-- R11 — compare_producers removed; validUntil: mcp ≤ 0.1.0-beta.2 -->
- [ ] None needed, because: <!-- e.g. internal refactor, no user-visible change -->

New scenarios carry `validFrom` **package-qualified** (`cli ≥ 0.1.0-beta.2`) —
packages version independently here, so a bare version number is ambiguous. A
deprecated row keeps its `covers:` and gains a matching `validUntil`.

## Linked issues

<!-- "Fixes #123" or "Related to #456" -->

## Notes for reviewers

<!-- Anything reviewers should pay extra attention to, or context that isn't obvious from the diff -->
