---
name: dogfood
description: >-
  Run a post-publish dogfood session: install a published @real-a11y-dev package
  from the registry into a project OUTSIDE the monorepo, walk its Dogfood (`D*`)
  scenario using only the published docs, and turn what breaks into verified
  findings, Notion tickets and scenario rows. Use after a release, when asked to
  dogfood or smoke-test a shipped package, when a `D*` row needs running, or when
  someone asks whether a package actually works from npm. NOT for pre-publish
  regression (`R*`) work — that runs against the built repo and packed tarballs.
---

# Dogfooding a published package

The Regression suite asks "does the code work". This asks the only question that
grows usage: **can a stranger get it working from what we actually shipped.**

Everything here exists because a session found it the hard way. Where a step says
a thing is non-negotiable, it is because skipping it produced a wrong answer.

## 0. The one rule that makes the session worth running

**Run outside the monorepo, always.** A workspace link resolves by path; a
published package resolves through its `exports` map. Broken subpaths, a missing
`dts.resolve` entry, a re-export that silently became `undefined`, an undeclared
peer dep — all invisible from inside the repo, all one `npm install` away from
obvious.

The second rule follows from it: **do not fill gaps from memory.** If the docs
omit `jsdom`, or a config line, or a peer dep — that omission _is_ the finding.
Working around it is precisely how a broken quick-start survives release after
release, because the only people who run it already know the answer.

And **time it**. "It works eventually" and "it works in five minutes" are
different products, and the second is the claim the docs make.

## 1. Pick the scenario and read it first

```bash
ls scenarios/dogfood/            # D1..D11
cat scenarios/dogfood/D5-testing-from-npm-fresh-project.md
```

Read its `twin:` rows too — they assert the same subject at the pre-publish
altitude and tell you what is already covered. The `## Why this exists` section
is the part to take seriously; it names the failure the row is guarding.

Check what the registry actually served, which is not always what you think:

```bash
npm view @real-a11y-dev/<pkg> --json | head -30
```

## 2. Use the existing harness — do not rebuild it

A working harness for **D5 / `@real-a11y-dev/testing`** already exists as a
sibling of your `real-a11y` checkout, at **`real-a11y-dogfood-testing`**. It is
deliberately not in this repo: inside the workspace, pnpm would resolve the
package by path and the session would test nothing.

It holds a small support-portal app — an accessible page, an un-migrated legacy
page with real defects, a page served with a genuine CSP response header, an
iframe host/widget pair, and a React-_controlled_ input — driven by Vitest, Jest
(CJS `require()`) and Playwright.

```bash
npm i -D @real-a11y-dev/testing@beta && npm test
npx playwright install chromium        # once per machine
```

Two conventions in it that will confuse you if nobody says them:

- **`it.fails(...)` marks a known package defect.** The suite is green _because_
  those fail. When a fix lands they start failing — that is the signal to promote
  them to ordinary assertions, not a regression.
- **Failure messages are snapshotted on purpose.** For an assertion library the
  message _is_ the product, so "does this read to someone who never saw the
  codebase" only stays honest if a change to it shows up in a diff.

**Before building anything for another `D*` row, go looking.** Other harnesses
and scratch apps live as siblings of the checkout too (`real-a11y-mcp-host`,
`real-a11y-live-tree-extractor`, …), and nobody maintains an index of which
scenario each one serves — so `ls` the parent directory and read what is there
rather than assuming a package has none. Rebuilding one silently forks the setup
that previous sessions recorded their results against.

When a package genuinely has no harness, build the app _real_ — realistic markup
with the defects real products ship, not a fixture soup. The defects you invent
are what the assertions get judged against, and a fixture containing only the
failure mode you already have in mind confirms what you assumed.

## 3. When something looks wrong: minimize, then verify

This is the step that separates a finding from a guess, and it is where a session
either earns its keep or produces noise.

**Minimize to a repro that fits in a comment.** Bisect the input until one line
triggers it. A session that started at "auditing the tickets page returns the
wrong tree" ended at:

```js
document.body.innerHTML = '<p role="status">4 tickets</p>';
const root = document.createElement("div");
root.innerHTML = "<button>Save</button>";
auditSnapshot(root); // → 'status "4 tickets"' — the button is absent
```

Same bug, but now it is reviewable, and the minimal form revealed the actual
trigger (any live region outside the root) which the page-level symptom hid.

**Then verify against repo source before reporting a single one.** Find the
function, read it, quote it. Findings that name `file:line` get fixed; findings
that describe a symptom get argued about.

**Do not treat the shipped JSDoc as ground truth.** A published `.d.ts` said
`toMatchA11yContract` was "Backed by `verifyContract` in
`@real-a11y-dev/serialize`". It is not — it lives in
`packages/testing/src/contract.ts` and is marked INTERNAL there. The row written
from the published types inherited the error and a reviewer caught it. You are
reading the docs as a consumer would, which is the point of the exercise; just
confirm against `packages/*/src/` before asserting where something lives.

**Watch for the vacuous check** — an assertion that passes whether or not the
behaviour works. A default-on option (`markFocus`) makes "pass the option and see
the marker" prove nothing, because the marker appears either way; only passing
`false` exercises the flag. When a step passes, ask what would have to break for
it to fail. If the answer is "nothing", the step is decoration.

## 4. Write it up — including what is good

Report the working surface honestly and specifically. A findings list with no
green in it reads as an axe-grind and gets discounted wholesale; a maintainer
also genuinely needs to know which parts they can stop worrying about.

Give each finding a severity you can defend, and separate **wrong** from
**spec-correct but unhelpful**. An icon-only `<button>` whose text is an emoji
has a non-empty accessible name, so passing is correct per accname — the finding
is that the scenario claimed otherwise, which is a different (and cheaper) fix
than changing the rule.

## 5. File it in Notion

Structure lives under the **🦴 dogfooding** page. Fetch it rather than
hardcoding ids — they rot:

```
notion-fetch  https://app.notion.com/p/3a81c354b0b5800c8bf8daf91b38f4c9
```

- **Reports** (inline database on that page) — one row per session. Set
  `Version`, `Date`, and `GitHub` once a PR exists.
- **Tasks** + **Projects** (separate databases) — one ticket per finding, each
  linked to a package Project via the `Project` relation. Projects are named per
  package (`CLI`, `Testing`). Give each ticket problem / repro / suggested fix /
  how to verify, so it stands alone months later.

Mechanics worth knowing before the API rejects you:

- `date:<Prop>:is_datetime` takes a **number** (`0`/`1`), not a string. Omitting
  it defaults to `0`, which is usually what you want.
- Notion **will not auto-create select options**. An unknown `Package` or `Stage`
  value is a hard error, and adding one is a schema change to a shared database —
  ask first rather than doing it silently.
- Notion normalizes markdown on write, so re-read the page before trying a
  targeted `update_content`; your original string may not exist verbatim.

## 6. Feed findings back into the suites

Scenario rows come **from findings, not from imagination** — a row invented
because a gap looked plausible is the kind that rots. Every row should trace to
something measured.

`pr` §4b and `scenarios/README.md` own the authoring rules; do not restate them,
follow them. Three things specific to dogfood-driven rows:

- **A private package has no version to pin.** Check before pinning — the set
  changes (`core` joined it in #325), so never trust a remembered list:

  ```bash
  for d in packages/*/; do node -p "require('./$d/package.json').private && '$d'"; done
  ```

  A private package is bundled into its consumers, so `validFrom` must pin the
  _published_ package the behaviour is reachable through — `testing ≥
0.1.0-beta.15` — and say the engine is internal. R13 and R15 show the wording.
  A pin like `core ≥ 0.1.0-beta.15` names a version installable from nowhere.

- **`area:` is an enum, and it differs per suite.** Both share `CLI, MCP,
Testing, Extension, React/Inspector, Storybook, Docs/Site`; **dogfood adds
  `Install health`** while `Packaging` and `Release` are regression-only. So a
  `D*` row must not use `Packaging` — `Install health` is usually what you want
  for a from-the-registry finding. There is no `Core` in either: a behaviour in
  `core` files under the surface it reaches users through. The list lives in
  `AREAS` in `scripts/surface/scenarios/load.mjs`; read it rather than guessing,
  because the frontmatter reader rejects an unknown value outright.
- **Amend the rows the session proved weak**, not just add new ones. If a step
  passed while the thing it names is broken, that step is the bug.

Then validate and open the PR:

```bash
pnpm surface:scenarios
```

Scenario edits grade **🟡 medium** (`pnpm pr:risk`), so `/code-review` the diff
and **a human merges**. Follow the `pr` skill from there.

## Traps that have each cost a session

- **`pnpm format:check` failing on files you never touched.** Almost always a
  local artifact, never `--no-verify`. See
  `.claude/skills/pr/SKILL.md` and the three causes — untracked file, prettier
  version drift, or working-tree CRLF. For the CRLF one the git blob is already
  clean, so `git add --renormalize` staging _nothing_ is the confirmation, not a
  failure; the fix is `rm <paths> && git checkout HEAD -- <paths>`.
- **Counting CR bytes in Git Bash lies.** `grep -c $'\r'` reports a hit on every
  line of a pure-LF file, and `git show` applies eol conversion on output. Count
  bytes in PowerShell: `([IO.File]::ReadAllBytes($f) | ? {$_ -eq 13}).Count`.
- **A worktree with no `node_modules`** fails `pre-push` by failing to _build_ a
  package you never touched. Run `pnpm install` in the worktree.
- **`pnpm verify` does not run any `test:e2e` suite**, and its CI matrix skips
  Windows. After a change to output, a renderer or the injected page bundle, run
  the relevant e2e suite by hand.
