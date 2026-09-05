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

`packages/` holds sixteen packages (plus one shared Vitest setup file), and the
distinction worth carrying while you read them is which ones anybody can
install. A package marked **private** below never reaches a registry — its code
still ships, bundled *into* whichever published package carries it, so there is
nothing to `npm install` and no version to pin. Each `package.json`'s `private`
field is the authority; the
[architecture guide](./website/guide/architecture.md) carries the current
published/internal split with the reasoning behind every seam.

```
packages/
│                      # Surfaces — a library you import or a command you run
├── cli/               # @real-a11y-dev/cli — the `real-a11y` shell command (bin only)
├── mcp/               # @real-a11y-dev/mcp — MCP server for AI agents (bin `real-a11y-mcp`)
├── testing/           # @real-a11y-dev/testing — audit/interaction helpers (Vitest/Jest/Playwright)
├── inspector/         # @real-a11y-dev/inspector — framework-agnostic tree panel (Shadow DOM embed)
├── react/             # @real-a11y-dev/react — React wrapper + hooks
├── storybook-addon/   # @real-a11y-dev/storybook-addon — per-story tree panel
│
│                      # Engine internals — bundled into the surfaces above
├── core/              # private — the extraction engine everything is built on: tree walk,
│                      #   role map, accessible-name computation, action dispatch, DOM
│                      #   observer, stable ids, queries. No UI, no deps. Every surface
│                      #   above bundles it
├── audit/             # private — the `Finding` model, the a11y rules, `collectFindings`, `assert*`
├── serialize/         # private — deterministic text serialization (tree / outline / tab sequence)
├── snapshot/          # private — fingerprints, `a11y-snapshot.json`, the diff, baselines (Node-only)
├── browser/           # private — the Playwright `BrowserSession` + the injected page bundle
├── session-registry/  # private — named sessions shared by the CLI daemon and the MCP server
├── validate/          # private — ARIA semantics validation, `aria-query`-backed
├── ui/                # private — @real-a11y-dev/semantic-navigator-ui — Preact tree components
│
│                      # Apps and fixtures — never on a registry either
├── extension/         # private — the Chrome extension (Side Panel + Content Script),
│                      #   "Semantic Navigator" — ships through the Chrome Web Store
├── example-patterns/  # private — APG component fixtures shared by the example apps
│
└── vitest.setup.jsdom.ts   # not a package — shared jsdom setup for the suites
                            #   that render Preact (ui, inspector, react,
                            #   storybook-addon, extension)
```

Dependency graph. Every arrow is a workspace dependency; an arrow into a private
package is **bundled** rather than installed — tsup's `noExternal` inlines the
JS and `dts.resolve` inlines the declarations, which is why no published `.d.ts`
names one:

- `cli → browser, snapshot, session-registry, audit, serialize → core`
- `mcp →` the same five `→ core` — the CLI and the server share one engine, so a
  snapshot captured by either diffs against the other byte for byte
- `testing → browser, audit, serialize, validate → core` (headless — no `ui` dep)
- `inspector → ui → core`
- `react → inspector → ui → core`
- `storybook-addon → ui → core` (+ `testing`)
- `extension → ui, serialize → core`
- Among the internals: `browser → audit, serialize`, `snapshot → audit,
  serialize`, `session-registry → snapshot`. `validate` has no internal
  dependency at all, and neither does `core`.

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

### The public-surface manifest

`docs/surface.json` is a generated, committed description of what the packages
expose — every CLI command and flag, every MCP tool and its schema, each
package's entry points, and the environment variables they read. It's extracted
from the source itself, so the docs can be checked against it instead of against
someone's memory of what shipped.

```bash
pnpm surface:check        # part of `pnpm verify` — fails if it's stale or the docs disagree
pnpm surface:extract      # regenerate it after changing a command, tool, or export
pnpm surface:check-built  # the slug function vs the built site (needs the website build)
```

`surface:check` validates every `#anchor` in the docs against heading ids it
computes with its own copy of VitePress's `slugify`, so on its own it only proves
the links and that copy agree. `surface:check-built` closes the loop against the
site VitePress actually emitted, which is what catches a VitePress bump changing
a slug rule under us. It needs a build, so it runs at the end of `pnpm verify`
and in the `website-a11y` CI job.

If you add a command or a tool, `surface:check` will tell you the manifest is
out of date — run `pnpm surface:extract` and commit the result. Its diff is how
a reviewer sees what moved in the public surface, so it belongs in the same PR
as the change. (Extraction imports the packages' built dependencies, so run
`pnpm build` first.)

### The released surface

`docs/surface.json` describes `main`. `docs/surface.released.json` describes the
newest **published** release, and `version-packages` writes it as part of the
release cut:

```bash
pnpm surface:snapshot     # freeze surface.json as the released surface
```

You should not need to run it by hand — `version-packages` does, as the last
step of:

```
build → changeset version → surface:extract → surface:snapshot → surface:apply
```

**That order is load-bearing, in three different ways.**

**`surface:extract` before the snapshot.** `changeset version` rewrites every
`packages/*/package.json` version, and the manifest records those versions — so
the moment it runs, `docs/surface.json` is stale. Snapshotting first would
freeze the *previous* release's version numbers, and the docs would then name an
older release than the one npm actually has.

**`surface:apply` after the snapshot**, and this is the subtle one. The managed
regions are rendered from the *difference* between the manifest and the
snapshot, so applying first renders them against the previous release —
producing a "not published yet" notice listing everything this very release is
publishing, at the moment it becomes available. Snapshotting then makes that
notice wrong, `surface:check` reports the region stale, and `pnpm verify` fails
on the release PR. Merged anyway, the site would tell readers that features they
can already install are missing.

That one stays invisible until the **second** release: with no snapshot on disk
the first cut renders empty, snapshots, and the two agree by accident.

The **build comes first** for a different reason: `changeset version` is not
idempotent. It is also the only irreversible step — everything after it is
deterministic and fast, while the build is the slow part and the one that
actually flakes. Running it first means a failure happens while nothing has
been mutated yet, so the fix is simply to run the command again.

> **If the chain does fail after the version bump**, do not re-run
> `version-packages` — `changeset version` would bump a second time and you'd
> ship `beta.13` where you meant `beta.12`, with nothing to warn you. Reset and
> start over:
>
> ```bash
> git checkout -- packages/ .changeset/ docs/ website/ pnpm-lock.yaml
> ```

The snapshot itself copies the committed manifest rather than re-extracting, so
it is byte-identical to the one the release PR reviewed.

The difference between the two files is the set of capabilities `main`
documents but `npm install` does not yet deliver. That gap is structural, since
`main` moves continuously and npm publishes on a release cut — what varies is
which site shows it. [next.real-a11y.dev](https://next.real-a11y.dev) ships
every push to `main`, so it always carries some; real-a11y.dev is gated on a
successful publish (see *Docs channels* below), so it normally carries none —
the exception being a manual **Deploy docs** run, which builds `main`'s tip on
purpose. The notice is what keeps both honest.

**The file is deliberately not seeded from `main`.** `docs/surface.json` did not
exist at `v0.1.0-beta.11`, the newest release when this landed, so there is no
honest way to reconstruct what that release exposed. Writing today's manifest
into it would assert that everything on `main` is published — precisely the
claim this exists to stop anyone from making. Until the next release cut runs
`version-packages`, the released surface is *unrecorded*, which is a different
fact from "nothing is unreleased" and has to stay distinguishable from it.

The CLI reference carries a managed `cli-unreleased` region that turns that
difference into a notice on the page — which commands and flags a reader can
see documented but cannot yet install. It is **empty** whenever there is no true
warning to give: when nothing is unreleased, and when the released surface is
unrecorded. `pnpm surface:apply` tells *you* which of those two it was, because
the page can't and the distinction is the whole point.

### What a change obliges you to update

```bash
pnpm surface:plan                      # vs origin/main
pnpm surface:plan -- --base upstream/main
```

Reads the manifest diff between your branch and its merge base, and prints the
documents that have to move with it — website pages **and** community Agent
Skills under `community-skills/` — and what happens to the release test
scenarios — the `pr` skill's §4 and §4b, computed rather than remembered. It
marks which of those docs your branch already touched, and stamps each scenario
with the version it applies from (or, for a removal, until), taken from your
pending changesets.

It needs no build: both manifests come out of git. The same report is posted as
a sticky PR comment by the `docs-currency` workflow. It only ever reports —
nothing here fails a build, because whether an obligation applies is a judgement
call and the answer is sometimes "none, and here's why".

### What a change is risking

```bash
pnpm pr:risk                           # vs origin/main
pnpm pr:risk -- --format markdown      # the PR comment body
```

Grades the branch 🟢 low / 🟡 medium / 🔴 high from its diff, and prints which
rule set the tier and the evidence for it. A rubric, not a score: every rule
names the damage it guards against, so it can be argued with rather than tuned.

The tier decides two things — how deep a review the change gets before it is
pushed for review, and whether it may be merged without a human. Both are
spelled out in the `pr` skill (§0, §3a, §9b). The `pr-risk` workflow computes the
same answer in CI, applies it as a `risk:*` label, and — unlike `docs-currency` —
**blocks**: a 🔴 high change fails the check until the deep review is recorded
with a `reviewed:deep` label, or waived with `risk-override` plus a
`risk-override: <reason>` line in the description, which the check reads back.

It grades blast radius, not correctness. A one-character typo in `publish.yml` is
high; a 2,000-line docs rewrite is low. A path it doesn't recognise grades 🟡
medium rather than 🟢 low, on the principle that "never heard of it" is not
evidence of harmlessness.

Two properties worth knowing before you change it:

- **CI grades with the base branch's copy of the rubric, not yours.** The
  workflow extracts `scripts/` from `origin/main` into a temp directory and runs
  that. Otherwise a pull request could rewrite the rubric that judges it — a stub
  printing `{"tier":"low"}` clears its own required check. The consequence is
  that a PR adding a rule is graded without it; the rule takes effect once it
  lands.
- **It fails closed.** Any git read it needs but can't get is a hard error, not
  an empty diff. An empty diff matches no rule, grades low, and exits 0 — a
  control that reports "nothing to see here" when it cannot see is worse than no
  control at all.

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

### Docs channels

The documentation ships on two sites, from the same source:

| | Serves | Deploys on |
| --- | --- | --- |
| [real-a11y.dev](https://real-a11y.dev) | the **released** docs | a successful `Publish to npm` — GitHub Pages, `docs.yml` |
| [next.real-a11y.dev](https://next.real-a11y.dev) | `main` as it stands | every push to `main` — Cloudflare Pages, `docs-next.yml` |

The split exists because the two audiences want opposite things. Someone who just ran `npm install` needs docs describing the version they actually have; someone following development needs `main`. One site cannot be both, and for most of this project's life it was quietly the second while presenting as the first.

Gating the stable deploy is what makes that structurally impossible rather than merely discouraged — real-a11y.dev cannot describe unreleased surface, because it is never built from a commit that has any. `next.` exists so the gate does not freeze docs fixes behind a release: a typo repair reaches `next.` immediately and stable with the next publish.

Two consequences worth knowing:

- **The stable site does not move between releases.** That is the point, not a fault. If something on it is wrong enough to need fixing now — a broken link, a wrong command — run **Actions → Deploy docs → Run workflow** with `sha` left empty, which deploys `main`'s tip. That will include unreleased surface, and the ["not published yet" notice](#the-released-surface) is what marks it — **but that notice renders nothing until the first release cut writes `docs/surface.released.json`**, so until then a manual deploy ships unreleased surface unmarked. Prefer `next.` while that is true.
- **The deploy builds the published commit, not `main`.** `publish.yml` dispatches `docs.yml` with the released commit as its `sha` input, and `docs.yml` refuses a `sha` that carries no release tag. Building `main`'s tip instead would reintroduce exactly the drift the gate removes.

**The two builds are not interchangeable.** `DOCS_CHANNEL=next` turns off the sitemap, replaces `robots.txt` with `Disallow: /`, adds `noindex` to every page, and labels the nav `next · unreleased`. Reproduce it locally with:

```bash
DOCS_CHANNEL=next pnpm --filter @real-a11y-dev/website build
```

Everything keys off that one variable in `website/.vitepress/config.ts`. Two details there are load-bearing and easy to undo by accident:

- **`rel=canonical` points at `real-a11y.dev` on both channels.** That is what tells a crawler the two copies are one document and stable is the real one. Pointing it at `next.` would invite indexing of docs for unreleased software.
- **`noindex` is belt and braces on top of that.** Canonical is a hint a search engine may overrule; `noindex` is a directive. The cost of being overruled — someone finding unreleased docs through a search and installing against them — is exactly what the split exists to prevent.

`docs-next.yml` asserts all of this against the built output before deploying, so a channel switch that silently stopped working fails the run instead of quietly publishing a crawlable second copy.

### Docs preview (`/preview`)

The two channels above both track branches. To browse a *pull request's* docs before merge, a repo collaborator can comment **`/preview`** at the start of a PR comment (alone or followed by more text).

That triggers `.github/workflows/docs-preview.yml`, which builds the PR head and uploads it to the Cloudflare Pages project `real-a11y-docs-preview`. The bot replies with a stable URL of the form:

```text
https://pr-<number>.real-a11y-docs-preview.pages.dev
```

Comment `/preview` again after new commits to refresh. Only works while the PR is **open** (a `/preview` on a closed PR is ignored so cleanup is not undone, and does not cancel an in-flight cleanup). Only `OWNER` / `MEMBER` / `COLLABORATOR` comments run the deploy (fork authors without write access cannot trigger it). You can also run **Actions → Docs preview → Run workflow** and pass a PR number.

When the PR is **merged or closed**, the same workflow deletes every Cloudflare Pages deployment on the `pr-<number>` branch (including the stable alias), so preview URLs stop serving. Cleanup runs with `pull_request_target` so it still works for fork PRs (secrets are unavailable on plain `pull_request` from forks); it never checks out PR code. A second delete pass covers the rare race where an in-flight deploy finishes after cancel.

### Changesets

Versioning and per-package CHANGELOGs are managed by [Changesets](https://github.com/changesets/changesets). If your PR changes a publishable package, run:

```bash
pnpm changeset
```

…and follow the prompts. The CLI writes a `.changeset/<random-name>.md` file describing the bump — commit it with the rest of your changes.

Notes:

- **Some packages are linked, not all of them.** `.changeset/config.json`
  defines a single `linked` group — the libraries a consumer installs side by
  side — so they bump together and nobody ends up holding two of them on skewed
  versions. `cli` and `mcp` are published and deliberately outside it: they are
  things you run, released on their own cadence, and a CLI fix has no business
  bumping the React wrapper. Read the `linked` array itself for the membership
  rather than a list written here — it moves as packages go internal, and this
  line claiming "all of them" outlived the truth of it by several releases.
- **A change to a private package still needs a changeset — naming a
  consumer.** Internal packages are bundled into published ones, so a fix in
  `audit` or `browser` reaches npm inside `testing`, `cli`, and `mcp`: it is
  user-visible and it needs a changelog entry. Changesets cannot version a
  private package (`privatePackages.version` is `false`), so name the published
  package(s) that carry the change. A changeset naming only the private package
  is accepted and then silently ignored — the `changeset` CI job checks that one
  exists, not that it names the right thing.
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
