---
name: pr
description: >-
  The house workflow for opening (or updating) a pull request in this repo:
  classify its risk, branch off main, make the change, KEEP THE DOCS IN SYNC,
  add a changeset, verify, conventional commit, open a normal (non-draft) PR,
  and land it — including when an agent may merge a low-risk PR itself and how
  to rebase a branch whose merge button is blocked for being behind main. Use
  whenever you're about to open, push, review, or merge a PR. Enforces that
  README and website markdown move with any public-surface change, in the SAME
  PR — this is how the docs stay current instead of drifting. (For cutting a
  release, use the `release` skill instead.)
---

# pr

The end-to-end flow for a pull request here. Step 4 (docs) is not optional: a
change to the public surface updates its docs in the same PR.

Step 0 decides how much of the rest applies. Not every PR deserves the same
effort, and spending a full review on a typo is the thing that makes the full
review get skipped on the PR that needed it.

## 0. Classify the risk — it decides how much of this skill applies

```bash
pnpm pr:risk
```

Prints the tier, which rule set it, and the evidence. It's a **rubric, not a
score**: named reasons that either apply or don't, computed from the diff
against the merge base. So it says the same thing on your machine and in CI —
where the `pr-risk` workflow applies it as a `risk:*` label and a sticky comment.

Run it early. The tier is an input to how you work the PR, not a verdict issued
at the end of it.

| Tier          | Set by                                                                                                                                                                                                                                                                                                                                                                                                                    | Review (§3a)                                                   | Merge (§9)                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------- |
| 🟢 **low**    | only recognised-inert paths — website, root/package docs, examples, tests, changeset prose, issue templates                                                                                                                                                                                                                                                                                                               | CI only                                                        | **an agent may merge it** when green  |
| 🟡 **medium** | a published package's `src`, the surface manifest gaining entries, `pnpm-lock.yaml`, a scenario — **or any path the rubric doesn't recognise**                                                                                                                                                                                                                                                                            | `/code-review`                                                 | a human merges                        |
| 🔴 **high**   | `.github/workflows`, CODEOWNERS, the PR templates, `.claude/`, `scripts/`, `.husky/`, the test/lint config, `.changeset/config.json`, root `scripts`/`packageManager`/`engines`, a `major` changeset or `!` subject or `BREAKING CHANGE:` footer, a release cut, the extension manifest, a package's `exports`/`files`/`private`/`scripts`, a tsup config, a **removed** surface entry, or code touching redaction/tokens | `/code-review` + `/security-review`, and §4b worked explicitly | a human merges, after `reviewed:deep` |

**The tier grades blast radius, not correctness.** A one-character typo in
`publish.yml` is high; a 2,000-line docs rewrite is low. Nothing in the rubric
reads the diff for whether the change is any _good_ — that's what the review is
for, and the tier only decides how much review to buy.

**Unknown paths grade 🟡 medium, not 🟢 low.** For a control whose whole job is
blast radius, "the rubric has never heard of this path" is not the same as
"harmless" — so a path nobody has classified costs you a human, and the report
names it. If it genuinely is inert, add it to `LOW_SHAPED` in
`scripts/pr-risk.mjs` rather than working around it.

**Escalate freely, and say why in the PR body.** The rubric is a floor. If you
touched something the rules can't see — a subtle behavioral change in a hot
path, an error message users script against, anything you had to think hard
about — treat it as the next tier up. Nothing stops you; the label just won't
agree, and a sentence in the description reconciles it.

**De-escalating needs a written reason, not just a label.** If a high rule fired
on something genuinely inert, add the `risk-override` label **and** put a line in
the description:

```
risk-override: <reason>
risk-override: <rule-id>[, <rule-id>] — <reason>
```

The check reads that line back and fails without it, so "the override is
recorded" is a fact rather than a hope. Naming rule ids narrows the waiver to
those rules — worth doing, because an unscoped override waives `ci-workflows`,
`packaging` and `secrets-and-redaction` all at once, and a waiver applied by
habit means nothing on the PR where it mattered.

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

## 3a. Review to the tier §0 gave you

Run these yourself, before pushing for review — not after someone asks:

- **🟢 low** — nothing. CI is the review. Don't spend a review pass here; that
  restraint is what makes the budget available where it matters.
- **🟡 medium** — `/code-review` over the branch diff.
- **🔴 high** — `/code-review`, then `/security-review`, and work §4b's scenario
  table explicitly rather than concluding "none needed". Name which ones ran in
  the PR body, then add the `reviewed:deep` label — the `pr-risk` check stays red
  until you do, deliberately.

Two passes on high because they look for different things, and the overlap is
smaller than it sounds: `/code-review` hunts consistency defects (two paths that
should agree and don't), `/security-review` hunts the redaction and credential
boundaries.

**Only name passes that exist.** This list said `/a11y-review` for a while, which
is not a repo skill and not a session one — so a blocking check told every
high-risk author to run something unrunnable, and "say which ran" could only be
answered falsely. A gate whose clearance instruction can't be carried out teaches
people to route around the gate. Check `ls .claude/skills/` before adding one
here. (If you do want an a11y pass, `.claude/skills/a11y-review/` is the thing to
write; this line moves the day it exists.)

**`reviewed:deep` is dropped automatically whenever you push.** It records "this
diff was reviewed", not "this PR was reviewed once" — the label analogue of
`dismiss_stale_reviews`. Without that, a reviewed `feat!:` PR could be
force-pushed into something else and keep its green gate.

Fix what they find in this PR. A finding deferred to a follow-up is a finding
that shipped.

## 4. Update the docs — same PR, no exceptions

**Start here — the mapping is computed:**

```bash
pnpm surface:plan
```

It diffs `docs/surface.json` against the merge base and prints what moved, which
documents that obliges you to update, which of them the branch has already
touched, and what §4b says to do to the scenarios — with the version stamps
filled in from your pending changesets. The same report lands on the PR as a
sticky comment. Read the table below to understand _why_ a page is in scope, and
for the cases the manifest can't see (an error message's wording, a network
behavior change).

**Then let the mechanical part happen on its own:**

```bash
pnpm surface:apply
```

This rebuilds the managed regions — the CLI command tables, the exit codes, the
MCP tool index — so a new command or tool cannot be missing from the at-a-glance
tables. It is the only surface verb that writes, and it deliberately writes very
little: it owns whether a row **exists**, never its prose, its wording, or its
position. A row it adds arrives as `TODO`, and `surface:check` fails until you
replace that with a sentence. Everything it leaves alone is yours, and the
sentence is the part worth your time.

It won't place a new **MCP tool** for you — the manifest carries no group for a
tool, so which table it belongs in is a judgement. `check` names the tool and
lists the groups; you pick.

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

## 4b. Test scenarios — the same obligation as docs

The pre-publish **Regression suite** (`scenarios/regression/`, `R*`) and
post-publish **Dogfood suite** (`scenarios/dogfood/`, `D*`) are how a release gets
checked by a human. They rot exactly like docs do — nothing fails when a scenario
stops describing reality — and they did, for as long as they lived only in Notion:
one asserted "all 9 commands" long after there were fourteen, another named a
`get_native_tree` tool that never existed.

They're in the repo now, so that class of rot is a build failure: `pnpm surface:check`
rejects a `covers:` path that isn't in the manifest, and fails when a shipped command
or tool has no Active row at all. Notion keeps `Result` and `Notes` as the per-run
surface; nothing syncs those back. See `scenarios/README.md` for the format.

So if this PR moved the public surface, say what happens to the scenarios. One of
three, and "none" is a valid answer that still has to be stated:

| This PR…                                       | Do                                                                                                                                                                              |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| adds a capability users can invoke             | **Add** a scenario. Set `Valid from` to the version it first ships in, package-qualified (`cli ≥ 0.1.0-beta.2`) — packages version independently, so a bare number is ambiguous |
| changes behaviour an existing scenario asserts | **Update** that scenario's Steps/Expected, and note the transition so a run against the _previous_ release still makes sense                                                    |
| removes a surface a scenario exists to test    | **Deprecate** it — `Status: Deprecated`, `Valid until: <pkg> ≤ <last version that had it>`. Keep the row; deleting it takes the reason it existed with it                       |
| changes what a surface **prints**              | **Update** the scenarios asserting that text. `surface:plan` can't see this — it models the inventory, not the output — so this row is on you                                   |
| changes nothing user-visible                   | Nothing — say so in the PR body, and mean it                                                                                                                                    |

Distinguish **evolves** from **dies**: a scenario that loses one step to a removed
flag stays `Active` with that step version-ranged inline; a scenario whose whole
subject is gone becomes `Deprecated`.

**"Nothing user-visible" is a claim about output, and no tool checks it.**
`surface:plan` reports the command / tool / flag / env inventory, which is _what
exists_, not what any of it prints. A branch that reworded the MCP checkpoint-diff
headers and `list`'s empty-category line moved nothing in the manifest and still
obliged three docs and three scenarios. `surface:check` has the same blind spot —
`check/samples.mjs` validates that documented invocations parse and says outright
that it does not check semantics. Output text is the third staleness axis, after
counts and names, and it is the one with no guard.

Each scenario carries **Steps**, **Expected**, and **Why this exists** (the check
requires all three), plus an optional **Notes** for durable design history. Write
the third one — it is the failure being guarded, and it is what lets a runner spot
a near-miss instead of ticking a box. Ground it in a real defect where there was
one.

A new scenario also needs `covers:` — the manifest paths it genuinely exercises, in
the same vocabulary `surface:plan` reports. That list is what makes the next PR's
plan able to name it. `covers` means "exercises the behaviour of", not "touches":
listing everything a row happens to invoke satisfies the coverage gate for
capabilities nothing really drives.

Record the IDs in the PR body (`R23` new, `R8` updated, …) so the release run can
be traced back to the change that caused it. `pnpm surface:plan` prints this block
ready to paste — with the version stamps filled in **and the IDs resolved**, matched
from each scenario's `covers:` list against the manifest paths that moved. It also
names the `twin` on the other side, since a change that invalidates one altitude
usually invalidates the other and the forgotten one is always in the suite you
aren't currently running.

An `R??` left in the output means nothing covers that path. For a new capability
that's expected — write the row and fill in its id. For a change to something that
already ships, it means the surface had no scenario to begin with, which is its own
finding: `pnpm surface:scenarios --coverage` prints the matrix.

## 5. Changeset — only if a published package's `src` changed

```bash
pnpm changeset   # pick the packages + bump level; write the house-style entry
```

Skip for docs-only / examples / CI-only PRs. The `changeset` CI check requires
one when `packages/*/src/**` changed, so this is enforced. (README-only changes
ship with the next release without their own changeset.)

## 6. Verify

```bash
pnpm verify   # build + typecheck + format:check + lint + surface:check + test + website build + surface:check-built
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

- **Non-draft.** No "WIP" / "don't merge yet" tags. On anything above 🟢 low the
  user merges on their own cadence — opening it non-draft is what lets them.
- Fill the PR template (`.github/PULL_REQUEST_TEMPLATE.md`, or `package.md` for a
  new package); don't replace it with a freeform body.
- In **How to verify**, give the reviewer the exact steps to run on a fresh
  checkout and what they should see (the commands from step 3) — reviewer
  instructions, not "ran `pnpm verify`." For a UI/docs change, name the page to
  open and what to look for.
- Link issues (`Fixes #123`).

## 9. Land it

### 9a. Behind main? Rebase — that's what's blocking the button

`main`'s ruleset sets `strict_required_status_checks_policy: true`, so a branch
that is merely **behind** cannot merge no matter how green it is. This is not a
failure state and nothing on the PR says "rebase me" — the checks all show ✅ and
the button is simply dead, which is why it reads as a bug the first few times.

Confirm it before doing anything:

```bash
gh pr view <n> --json mergeStateStatus,mergeable,reviewDecision,isDraft
```

`"mergeStateStatus": "BEHIND"` with `"mergeable": "MERGEABLE"` is exactly this.
Fix it by rebasing — **never** with a merge commit and never with GitHub's
"Update branch" button, which makes one:

```bash
git fetch origin main
git rebase origin/main
git push --force-with-lease
```

Then wait for CI again: the rebase is a new SHA, so every check re-runs from
scratch (`verify` ~5 min, `website-a11y` ~7.5 min). Budget the wait — a PR is not
mergeable the moment the push lands.

**If the branch touched any `website/*.md`, regenerate the a11y baselines after
the rebase, not before** — you're rebasing onto whatever else has since changed
the site, and stale snapshots taken against the old base will fail
`website-a11y`. Re-run the §6 baseline block.

The other blocked states, so you can tell them apart:

| `mergeStateStatus` | What it is                                                    | Do                                                                                                                                        |
| ------------------ | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `BEHIND`           | green, but not up to date with main                           | rebase, above                                                                                                                             |
| `DIRTY`            | genuine merge conflict                                        | rebase and resolve. Note the main `Test` workflow **silently does not run** on a conflicting PR, so checks look absent rather than failed |
| `BLOCKED`          | a required check is failing, or a review thread is unresolved | `gh pr checks <n>`; the ruleset sets `required_review_thread_resolution: true`, so an open thread alone does this                         |
| `UNSTABLE`         | a non-required check is failing                               | look at it anyway — it is required-in-spirit or it should be deleted                                                                      |
| `CLEAN`            | mergeable now                                                 | §9b                                                                                                                                       |

### 9b. Merging — who is allowed to

**🟢 low only.** On a low-risk PR, whichever agent is driving it — Claude,
Cursor, Devin, whoever — merges it rather than parking it on a human. On
🟡 medium and 🔴 high the agent stops at "ready", and says so.

Every one of these has to hold. They are cheap to check and the list is short
because each item is something that has actually blocked a merge here:

- `pnpm pr:risk` says **low**, and the PR carries `risk:low` (CI agreeing with
  you is the point — if it doesn't, the diff you classified isn't the diff that's
  pushed)
- not a draft, and the title has no `!`
- `mergeStateStatus` is **`CLEAN`** — not `BEHIND`, not `BLOCKED`
- every check has passed, including the non-required ones
- `reviewDecision` is not `CHANGES_REQUESTED`
- no unaddressed review comment. **Read the PR rather than assuming a bot got
  there first** — `copilot_code_review` is armed in the `branches` ruleset and
  `cursor[bot]` is installed, but as of 2026-08-08 neither has ever produced a
  review here (checked across #300, #306, #307, #308, #313, #309); Cursor says
  outright that Bugbot isn't enabled. Two review bots configured, zero running.
  A precondition that names a reviewer who never speaks is a precondition that
  always passes.

```bash
gh pr checks <n> --watch --fail-fast
gh pr view <n> --json mergeStateStatus,mergeable,reviewDecision,isDraft,statusCheckRollup
gh pr merge <n> --squash --delete-branch
```

**`--squash` is not a preference** — the ruleset sets
`allowed_merge_methods: ["squash"]` and rejects anything else.

**`gh pr merge --auto` does not work here.** The repo has
`allow_auto_merge: false`, so GitHub's queue-it-and-forget-it auto-merge is
unavailable and the command fails outright. Watching the checks and merging is
the mechanism; if that ever changes, this line is what to delete.

**Never merge, whatever the tier says:** a release PR (`chore(release)` — that's
the `release` skill's job and it stops for sign-off), or any PR where the user
has said they want to look at it first. When in doubt, don't — an unmerged PR
costs a message, and a merged one costs a revert plus whatever the deploy did in
between.

This list used to also say "anything touching `.github/`", which contradicted the
machine-readable policy for the same diff — and the permissive one was the
machine. It's gone because the rubric now grades `.github/`, `.claude/`,
`scripts/` and `.husky/` 🔴 high outright, so the rule enforces itself instead of
relying on a human remembering a second, prose-only list. **If you find yourself
adding another "never merge X" line here, add a rule instead.**

**After merging, watch what it did.** `main` deploys real-a11y.dev on a
successful publish, so a docs merge is a production change. If the post-merge
`Test` run on main goes red, say so in the same breath as reporting the merge —
"merged, and main is red" is the useful sentence, not two separate ones.

## Scaling the docs step

For a repo-wide doc sweep (not one PR), fan out one reviewer per doc cluster,
each grounding findings against source — see how the post-beta.10 audit ran. For
a single PR, the step-3 checklist is enough.
