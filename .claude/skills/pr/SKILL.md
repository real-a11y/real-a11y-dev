---
name: pr
description: >-
  The house workflow for opening (or updating) a pull request in this repo:
  branch off main, make the change, KEEP THE DOCS IN SYNC, add a changeset,
  verify, conventional commit, and open a normal (non-draft) PR. Use whenever
  you're about to open or push a PR. Enforces that README and website markdown
  move with any public-surface change, in the SAME PR — this is how the docs
  stay current instead of drifting. (For cutting a release, use the `release`
  skill instead.)
---

# pr

The end-to-end flow for a pull request here. Step 3 (docs) is not optional: a
change to the public surface updates its docs in the same PR.

## 1. Branch off main

```bash
git fetch origin main
git checkout -b <type>/<slug> origin/main   # feat|fix|docs|chore|ci|refactor
```

Never commit to `main`. Branch from `origin/main`, not another feature branch.

## 2. Make the change

Write code that reads like the surrounding code. Add/adjust tests — for a bug
fix, a test that fails without the change is the gold standard.

## 3. Test the change — exercise it, don't just run the gate

`pnpm verify` (step 6) proves the suite passes; it does **not** prove YOUR change
works. Actually exercise the new behavior, then write what you did in the PR's
**How was this tested?** section — "ran `pnpm verify`" is not an answer.

By change type:

- **Library / logic** — add a unit test that fails without the change and passes
  with it (`pnpm --filter @real-a11y-dev/<pkg> test`). A regression test is the
  gold standard for a bug fix.
- **CLI** — build it (`pnpm --filter @real-a11y-dev/cli build`) and run it for
  real against a fixture or URL: `node packages/cli/dist/index.js <cmd> …`. Check
  the output, the **exit code**, and `--format json`.
- **MCP** — exercise the tool end to end, or run `pnpm --filter @real-a11y-dev/mcp test`.
- **Website / docs / UI** — run the dev server and **look**: start the `website`
  preview, open the page in the browser, and check the rendered output, the
  console, and dark mode. Never "verify" a rendered change by reading the
  markdown source.
- **React / inspector / storybook / ui** — exercise it in an example app or
  Storybook (`pnpm --filter @real-a11y-dev/example-… dev`), or the browser preview.
- **Extension** — `pnpm --filter @real-a11y-dev/semantic-navigator-extension test`,
  and load the unpacked `packages/extension/dist` in Chrome for a real check.

The commands you run here **are** the reviewer's verification steps. Capture each
one and its expected result for the PR's **How to verify** section (step 8), so a
reviewer can reproduce your check on a fresh checkout instead of reverse-
engineering it from the diff. (That reviewer-facing "how to verify" is a
different thing from a past-tense "here's what I ran" — write the instructions.)

## 4. Update the docs — same PR, no exceptions

If the change touches the **public surface** (a package, command, flag, export,
option, MCP tool, env var, exit code, error message, or a whole product), update
its docs now. Map the change with the table below, then confirm the branch
actually touched each doc in scope (`git diff --name-only origin/main...HEAD`) —
anything in scope but untouched is a required update.

| A change to…                                                                         | Update                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A package's public API (export, option, command, flag, MCP tool, env var, exit code) | `packages/<pkg>/README.md` **and** `website/packages/<pkg>.md` (testing also has `website/packages/testing/{assertions,matchers,flow,playwright,snapshots}.md`)                                                                                                                                                                                                                                                                                    |
| A thrown/printed error message                                                       | every doc that shows it (usually the testing assertion/matcher/playwright pages)                                                                                                                                                                                                                                                                                                                                                                   |
| Auth / storage-state behavior                                                        | `website/guide/authenticated-pages.md` + the package page's auth section                                                                                                                                                                                                                                                                                                                                                                           |
| CI / snapshot / diff behavior                                                        | `website/guide/ci-diff-bot.md`, `website/guide/accessibility-snapshots.md`, `website/packages/testing/snapshots.md`                                                                                                                                                                                                                                                                                                                                |
| What a package sends over the network / collects                                     | `website/privacy.md` (its "no network requests" line is scoped to the pure libraries — cli/mcp load the user's target URL)                                                                                                                                                                                                                                                                                                                         |
| The Chrome extension                                                                 | `packages/extension/README.md`, `website/guide/chrome-extension.md`, the manifest/package version                                                                                                                                                                                                                                                                                                                                                  |
| **A brand-new published package or product surface**                                 | **all of:** root `README.md` (packages table + pitch + quick-start + architecture), `website/index.md` (home hero tagline + a feature card), `website/guide/architecture.md` (table + dep graph), `website/guide/getting-started.md` (an entry point), a new `website/packages/<pkg>.md`, `.changeset/config.json` (`linked` or `ignore`), and the surface-list guides (`why.md`, the `reading-the-*-view.md` pages, `accessibility-snapshots.md`) |

**The pages the naive glob misses** — `git ls-files "website/**/*.md"` does NOT
match markdown directly in `website/`. Always list both:

```bash
git ls-files "website/*.md" "website/**/*.md"
```

The three it hides: **`website/index.md` (the home page** — hero `tagline` +
`features:` grid; a new product MUST land here, it's the most-visible and
most-forgotten page), `website/accessibility.md` (product **UI** surfaces only —
headless cli/mcp correctly absent), and `website/privacy.md`.

**Ground every symbol against source** before writing it — read the package's
`src`/`package.json` and confirm the real name. A wrong name in a doc is
copy-paste-broken code. `website/**/*.md` and every `README.md` are
prettier-ignored — don't format them.

## 5. Changeset — only if a published package's `src` changed

```bash
pnpm changeset   # pick the packages + bump level; write the house-style entry
```

Skip for docs-only / examples / CI-only PRs. The `changeset` CI check requires
one when `packages/*/src/**` changed, so this is enforced. (README-only changes
ship with the next release without their own changeset.)

## 6. Verify

```bash
pnpm verify   # build + typecheck + format:check + lint + test + website build
```

**If you touched any `website/*.md`, also regenerate the a11y baselines** — a
plain `pnpm verify` does NOT run the `website-a11y` job, so baseline drift is
only caught in CI otherwise:

```bash
pnpm --filter @real-a11y-dev/website build   # dead-link + frontmatter check (both FAIL the build)
pnpm --filter @real-a11y-dev/website exec playwright test --update-snapshots
git add website/tests/a11y.spec.ts-snapshots
```

`200 passed` also confirms the edits added no axe violation. Dead links (every
`/guide/…`, `/packages/…` must be a real route) and malformed frontmatter (a
`: ` inside an unquoted value breaks YAML — quote it) both fail the build.

## 7. Commit — conventional, with the co-author trailer

Conventional message (`feat|fix|docs|chore|ci: …`; commitlint is enforced).
End the body with:

```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

Push triggers the pre-push hook (runs `pnpm verify`) — don't `--no-verify`.

## 8. Open the PR — NORMAL, not draft

```bash
gh pr create --base main   # add --template release.md only for releases
```

- **Non-draft.** No "WIP" / "don't merge yet" tags — the user merges on their own
  cadence.
- Fill the PR template (`.github/PULL_REQUEST_TEMPLATE.md`, or `package.md` for a
  new package); don't replace it with a freeform body.
- In **How to verify**, give the reviewer the exact steps to run on a fresh
  checkout and what they should see (the commands from step 3) — reviewer
  instructions, not "ran `pnpm verify`." For a UI/docs change, name the page to
  open and what to look for.
- Link issues (`Fixes #123`).

## Scaling the docs step

For a repo-wide doc sweep (not one PR), fan out one reviewer per doc cluster,
each grounding findings against source — see how the post-beta.10 audit ran. For
a single PR, the step-3 checklist is enough.
