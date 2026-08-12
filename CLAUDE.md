# CLAUDE.md

Orientation for Claude Code working in this repo.

[CONTRIBUTING.md](./CONTRIBUTING.md) is the canonical guide and it is thorough —
**read it rather than guessing** for: the surface manifest (`docs/surface.json`)
and the load-bearing `version-packages` order, `pnpm surface:plan` and
`pnpm pr:risk`, the two docs channels and `/preview`, branch naming, conventional
commits, and the stability policy.

This file carries what CONTRIBUTING doesn't: how to _operate_ in the repo without
stepping on anything, and the traps that fail silently.

## What this is

An accessibility inspection toolchain. It builds a semantic tree of a page and
gives you ways to read, diff, assert on and act through it — a matcher, a panel,
a command, a server, a browser extension.

Seven of the sixteen packages are published — `cli`, `core`, `inspector`, `mcp`,
`react`, `storybook-addon`, `testing` — and the other nine ship bundled inside
them. CONTRIBUTING's _Project structure_ carries the annotated map and the
reasoning for each seam; each `package.json`'s `private` field is the authority.

> `core` is on its way to internal (#325), which lands the "six published
> packages" plan. Until it merges, treat `core` as published.

Everything depends on `core`, so most real changes are cross-package. Check
consumers before assuming a change is contained.

## Two producers build the tree

This is the most important thing to know before changing anything about trees,
and it cuts across packages rather than along them.

|            | **`dom`**                                                                | **`native`**                                     |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------------------ |
| What it is | in-page walk, this project's own ARIA/AccName implementation             | Chromium's own accessibility tree, read over CDP |
| Lives in   | `core/src/extraction/`                                                   | `browser/src/native-tree.ts`                     |
| Reached by | extension content script, `inspector`, `react`, the injected page bundle | `cli`, `mcp`, over Playwright CDP                |

Both stamp `source.producer` on every `ExtractionResult`. The intent recorded on
`TreeSource` in `core/src/types.ts` is that serializers render it into their
header **so a DOM-produced baseline and a native-produced one are never silently
compared** — but nothing in `serialize` or `snapshot` reads it today, so that is
a convention rather than an enforced check. Preserve the stamp through anything
that transforms a tree, and don't assume something downstream will catch a
cross-producer comparison for you.

Four consequences that are easy to get wrong:

- **The facets are producer-dependent.** `a11y` is always present; `dom` and
  `interaction` are optional and only the DOM producer fills them. A native tree
  has no light-DOM element to hang them on for UA-internal nodes. Code that
  reaches for `node.dom` without a guard works until it meets a native tree.
- **The two will never agree byte for byte, by design.** Chromium's vocabulary
  differs (file input as `button`, `<details>` as a disclosure), name placement
  differs, and UA-shadow media controls are visible only to native. The parity
  harness in `packages/browser/e2e/` therefore measures _overlap_
  (`shared / domCount`, ~89%), not equality, and a divergence is a two-way
  signal — it can be a DOM-producer gap **or** a native-normalizer bug.
- **The CLI has no `--producer` flag any more.** Each surface has exactly one
  correct producer, recorded in `producers` in `packages/cli/src/args.ts`. Nearly
  everything is `native`.
- **`tabs` is the one DOM holdout, and it is not a fallback.** A native tree
  knows per-node focusability but not the _sequence_ — `tabindex` never reaches a
  native node — so an in-page walk is the only source there is. It is also why
  `tabs` alone still takes `--root`. Do not "unify" it.

The normalization vocabulary lives in `core/src/native/` (`normalizeNativeAX`,
`ax-vocabulary.ts`) rather than in the package that does the CDP read, so a
native transport stays a thin adapter over shared vocabulary instead of growing
its own engine. Changing that vocabulary reaches every native transport at once.

**The extension is DOM-only today.** A native path over `chrome.debugger` is
proposed in #229 as a dev-only dogfood build — it is not on `main`, so nothing
under `packages/extension/src/native/` exists yet. What is already true, and what
that PR is built to preserve: the shipped
`packages/extension/public/manifest.json` carries exactly `activeTab`,
`sidePanel` and `webNavigation`. **A new permission forces every existing user to
re-consent and raises the Chrome Web Store review bar**, so `chrome.debugger` must
never reach the published listing — in #229 it stays out via a build-time
`__DOGFOOD__` constant the store build dead-code-eliminates, a runtime
`devFlags.nativeMode` gate, and a separate `dist-dogfood/` output. If you work on
that branch, confirm the production bundle contains zero `chrome.debugger`
references before pushing.

## Working in this repo

**Branch in a worktree under `.claude/worktrees/`, never in the main checkout.**
Concurrent sessions share one working tree and one HEAD — a `git checkout -b` in
place can move the branch out from under another agent mid-edit.

**Never `git stash`.** In a shared checkout it pockets someone else's uncommitted
work along with yours.

**Update a branch by rebasing onto `origin/main`** (force-push with lease), never
a merge commit. Regenerate a11y baselines fresh afterwards rather than carrying
the pre-rebase ones.

**Node 20.20.2 (Volta-pinned) and pnpm 9.15.0.** `engines` says `>=20`: the
`verify` matrix runs 20 and 22, and a separate `packages-node24` job exercises
the libraries on 24 — so a Node 24-only failure can and does come from CI. Work
on 20 regardless, because the docs build needs it (see CONTRIBUTING for why).
If a package fails to build in a worktree with implicit-`any` or dts errors in
code you never touched, its deps aren't materialized: run `pnpm install` **in the
worktree**.

Both git hooks are real gates: `pre-commit` runs lint-staged, `pre-push` runs
`pnpm verify` **and** `pnpm size-limit`. Do not reach for `--no-verify` — every
time it has looked like the answer here, the failure was real.

## What `pnpm verify` does not cover

`verify` is build → typecheck → format:check → lint → surface:check → test →
website build → surface:check-built. What it leaves out has bitten this repo more
than once:

- **Every `test:e2e` suite.** Root `test` runs each package's `test`, not
  `test:e2e`. The CI `e2e` job separately runs `testing`, `mcp`, `cli`, and
  `browser` (advisory). After any change to CLI output, a renderer, an MCP tool
  schema, or the injected page bundle, run the relevant suite by hand —
  otherwise CI's `e2e` job is where you find out.
- **Windows.** The `verify` matrix is ubuntu + macos only. Because `pre-push`
  runs `verify` locally, a Windows-fragile test (usually a tight timing bound)
  blocks your push while passing CI. Confirm it fails on `origin/main` too before
  concluding your change caused it — then fix the test, don't skip the hook.
- **The website e2e / a11y baselines**, which have their own suite and their own
  regeneration gotchas (networkidle wait; commit new pages first so `lastUpdated`
  is right; a sidebar change moves every page's baseline).

## Private packages: `noExternal` and `dts.resolve` are one change

npm can never resolve an internal package, so a published package that uses one
must **bundle** it (`noExternal` in `tsup.config.ts`) and hold it as a
`devDependency` — a published `dependencies` entry breaks every install.

`noExternal` alone bundles the JS and leaves the types behind. The emitted
`.d.ts` keeps `from "@real-a11y-dev/<internal>"`, which is `TS2307` for a
consumer — or, under the usual `skipLibCheck: true`, **types silently degrading
to `any`**. The build does not fail. Add the package to `dts.resolve` as well,
which inlines the declaration text instead.

**The test is "does any emitted declaration _name_ it", not "do we re-export
it".** A structural reference is enough: `mcp`'s `renderAudit(findings: Finding[])`
emits `from "@real-a11y-dev/audit"` with no `export … from` statement anywhere.
Checking `index.ts` for re-exports, finding none, and skipping `dts.resolve` is
how an unresolvable specifier ships.

Verify by reading module **specifiers**, not type names — `dts.resolve` inlines
declaration text, so grepping for `SemanticNode` proves nothing either way:

```bash
pnpm build && grep -rlE "(from|import\(|reference types=) *[\"']@real-a11y-dev/(browser|audit|serialize|snapshot|validate|session-registry|semantic-navigator-ui)" packages/{cli,core,inspector,mcp,react,storybook-addon,testing}/dist --include="*.d.ts" --include="*.d.cts"
```

Expect no output. Any hit is a package whose `dts.resolve` is missing a name.
Two things make this report false positives if you shortcut them:

- **Build first.** A `dist/` older than the `tsup.config.ts` that fixed it will
  keep reporting the bug you already fixed.
- **Only published packages are checked**, hence the explicit directory list
  rather than `packages/*/dist`. A private package's declarations may name
  another private package freely — nobody can install either one, so there is no
  reader to break. `snapshot` does exactly this today and is not a defect.

When #325 lands, move `core` out of the directory list and into the pattern.

Related: **tsup externalizes only `dependencies`.** Moving a package to
`devDependencies` makes esbuild walk into it, which is how `core` was once
silently inlined into `cli` and `mcp`. Declare what you actually want inlined
rather than relying on where a dep happens to sit.

## `core` runs as more than one copy

`inspector` and the extension bundle the engine rather than importing it, so
**two or more copies of `core` loaded at once is the normal case**, and it gets
more common as packages go internal.

Consequence: **module-scope state in `core` is a bug.** Two copies each get their
own, and anything keyed across them stops matching — a node id minted by one copy
resolves to nothing in another, so `dispatch()` returns having done nothing and
_nothing errors_.

Two such singletons are still on `main` — `elementRefs` in
`core/src/extraction/dom-extractor.ts` and the counter in
`core/src/utils/id-generator.ts`. #326 moves both into a realm-wide registry keyed
by `Symbol.for()`, which returns the identical symbol to every copy in the realm.
Realm rather than process is deliberate: an iframe or worker gets its own store,
matching the DOM it describes. That key carries a **shape** tag, bumped only when
what is stored changes and **never per release** — a per-release bump would stop
two betas in one app from sharing, which is the bug it exists to prevent.

Until that lands, do not add more module-scope state, and treat any id or ref
that has to survive a package boundary as suspect.

## When a size-limit budget may go up

Raising a budget is sometimes right and sometimes a cover-up, and the symptom is
identical. The discriminator is one question: **did the same code get inlined
twice into one artifact?**

- **Legitimate:** something that was an external the consumer resolved separately
  is now bundled. Delivered bytes go _down_ overall even though the artifact
  grows — the consumer no longer downloads it as a second package.
- **A bug:** the same code landed twice in one bundle. An esbuild `define` is
  inlined at _every_ occurrence, which is how the inspector once shipped its
  stylesheet twice.

If a budget fails by more than your change plausibly weighs, look for duplication
before touching `.size-limit.json`.

## Changesets: the exceptions

CONTRIBUTING covers the normal flow. Two things it doesn't:

- **The extension takes no changeset** — it's in the `ignore` list in
  `.changeset/config.json`. It needs a `packages/extension/CHANGELOG.md`
  `## Unreleased` entry with a PR link instead. Being changesets-ignored means it
  is not _versioned_ automatically, not that it ships separately: npm and the
  extension go out in one release PR. Bump it by hand in **both**
  `packages/extension/package.json` and `packages/extension/public/manifest.json`
  (they must match), and do it **before `pnpm version-packages`**, not after.
  `version-packages` runs `surface:extract`, and `docs/surface.json` records the
  extension's version like any other package's — bump afterwards and the manifest
  is stale, so `surface:check` fails inside the release gate. Recovery is nasty
  because `changeset version` is not idempotent and a second run silently bumps
  an extra beta. (The `release` skill lists this as step 3, _after_ versioning;
  that ordering cost a recovery cycle on beta.13 and the skill has not been
  corrected yet.)
- **Release before privatizing a package.** In prerelease mode a changeset entry
  lands in the changelog of the packages it names; privatize first and that
  changelog stops being published, so the entry is silently lost.

## Risk, review, and what an agent may do

`pnpm pr:risk` grades the branch and CI applies it as a blocking check. It grades
blast radius, not correctness — a one-character typo in `publish.yml` is high.

- 🟢 **low** — an agent may merge it (`--squash`; `--auto` is unavailable here).
- 🟡 **medium** / 🔴 **high** — stop and hand it back.

**Run the passes the tier calls for** — `/code-review` on 🟡, plus
`/security-review` on 🔴. Both are agent-runnable; they look for different things
and neither substitutes for the other. `/code-review ultra`, the multi-agent
cloud review, is user-triggered and billed — an agent cannot launch it.

**On 🔴, applying `reviewed:deep` is yours, and it is the last thing you do.**
The `pr-risk` check stays red until the label is there, so leaving it off strands
the PR with a failing check nobody realises is theirs to clear. But the label
clears on every push, and a review round that prompted fixes no longer describes
the diff those fixes produced — so apply it only after the final push, never to a
diff that changed after you read it. Name the passes you ran in the PR body too;
the label records that a diff was reviewed, the body records how.

Open normal, non-draft PRs — no "don't merge yet" or WIP tags. Every PR
description needs a `## How to verify / test` section with copy-pasteable steps
and expected output. Public-surface changes update README and the website
markdown **in the same PR**; that's what keeps the docs from drifting.

Do not reference the improvement audit or its finding numbers in a PR title or
body — a bare `#N` mislinks to an unrelated PR. Describe the bug on its own terms.
