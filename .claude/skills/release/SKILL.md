---
name: release
description: >-
  Cut and publish a release of the @real-a11y-dev npm packages, and/or the
  Chrome extension. Use whenever the user asks to release, publish, ship a new
  version, cut a beta, bump versions for release, or graduate to stable. Covers
  changeset versioning, the version-bump PR, and the tag-triggered CI publish +
  Chrome Web Store handoff. Publishing is public and irreversible — this skill
  prepares everything and stops for explicit sign-off before anything ships.
---

# Release

How to cut a release in this monorepo. Publishing runs in CI — you never
`npm publish` or `pnpm publish` from a laptop. Your job is to prepare a clean
version-bump PR, then (after it merges, and only with the user's explicit go)
push the tags that trigger the publish workflows.

## Mental model — read this first

- **Changesets pre-mode.** The repo is in changesets prerelease mode on the
  `beta` tag (`.changeset/pre.json` → `mode: "pre"`). Every `changeset version`
  bumps the `-beta.N` counter; the base `0.1.0` was fixed when pre-mode was
  entered, so a `minor` changeset on `0.1.0-beta.9` becomes `0.1.0-beta.10`, not
  `0.2.0`.
- **Consumed changesets stay on disk.** In pre-mode the `.md` files are NOT
  deleted after `changeset version` — they're recorded in `pre.json.changesets`
  and all collapse into the stable version at `changeset pre exit`. Seeing dozens
  of `.md` files that look "already released" is normal. Do not delete them.
- **Linked cohort** (versions move together): `core`, `serialize`,
  `semantic-navigator-ui`, `inspector`, `react`, `storybook-addon`, `testing`.
  `validate`, `mcp`, and `cli` version independently.
- **The Chrome extension is changesets-ignored** (`.changeset/config.json`
  `ignore`). Bump its version by hand; it ships to the Chrome Web Store, never
  npm.
- **Internal deps are `workspace:*`.** pnpm rewrites them to the **exact**
  version at publish time, so a release is coherent by construction
  (e.g. `mcp@x` → `testing@<exact>`). Never hand-edit internal dep ranges.
- **`latest` is advanced automatically.** `publish.yml` publishes betas under
  `--tag beta` (which never moves `latest`), then runs
  `scripts/advance-latest.mjs` to point `latest` at each package's just-published
  version. It self-guards: no-op if the publish already went to `latest`, and
  no-op once out of pre-mode (so it can never regress a stable `latest` to a
  beta). **You do not move dist-tags by hand.**

## Choose the flavor

|             | Next beta                       | Graduate to stable                               |
| ----------- | ------------------------------- | ------------------------------------------------ |
| Command     | `changeset version`             | `changeset pre exit` then `changeset version`    |
| Result      | `-beta.N` → `-beta.N+1`         | all accumulated changesets collapse into `0.1.0` |
| dist-tag    | `beta` (auto-advances `latest`) | `latest` (own publish owns it)                   |
| Reversible? | mostly (it's a beta)            | no — a stable can't be un-published              |

If the user just says "release" and it's ambiguous, **ask** which one — it sets
the versions, the tag, and whether pre-mode ends.

## Steps

### 1. Fresh branch off `main`

```bash
git fetch origin main
git checkout -b release/<label> origin/main   # e.g. release/beta.10
```

Release from `main`, not from a feature branch — the bump must reflect exactly
what's merged.

### 2. Version the packages

```bash
npx changeset status            # read-only preview of what will bump
# next beta:
npx changeset version
# OR graduate to stable:
# npx changeset pre exit && npx changeset version
pnpm install --lockfile-only    # (usually a no-op with workspace:* — commit if it changes)
```

Then **inspect before trusting it**:

- Every publishable `packages/*/package.json` version is what you expect.
- A package with no new changeset and no changed dependency **stays put** —
  that's correct; `pnpm publish -r` will skip it (it already exists on npm).
- The generated `CHANGELOG.md` entries read well (new packages get a fresh
  `CHANGELOG.md` — remember to `git add` it).

### 3. Bump the extension (only if shipping it)

The extension is changesets-ignored, so bump it manually in **both** files (they
must match; `prebuild` also syncs the manifest from package.json):

- `packages/extension/package.json` → new version
- `packages/extension/public/manifest.json` → same version

Chrome Web Store versions are plain `MAJOR.MINOR.PATCH` (no `-beta`).

### 4. Gates

```bash
pnpm verify              # build + typecheck + format:check + lint + test + website build
pnpm packaging:check     # publint + attw on every package — catches broken exports/types
```

Both must be green. `packaging:check` matters most when a package is publishing
for the first time.

### 5. Open the release PR

Stage precisely (avoid stray untracked files), commit with a conventional
message, push, and open the PR **using the release template**:

```bash
git add packages/ .changeset/pre.json
git commit -m "chore(release): version packages for <label>"
git push -u origin release/<label>
gh pr create --base main --template release.md   # fill in the table + notes
```

The template (`.github/PULL_REQUEST_TEMPLATE/release.md`) has the checklist:
version-bumps table, changesets consumed, mechanical notes, `verify` +
`packaging:check` boxes, and the after-merge tags. Fill it in — don't replace it
with a freeform body.

### 6. Publish — after the PR merges, and only on explicit sign-off

Publishing is **public and irreversible**. Stop here and get the user's explicit
"go" before pushing any `v*` tag. Then:

```bash
# npm — from the squash commit on main:
git tag v0.1.0-beta.N && git push origin v0.1.0-beta.N
#   → publish.yml: pnpm publish -r --tag beta, then advance-latest.mjs moves latest.
#   (Or run the "Publish to npm" workflow via workflow_dispatch with tag=beta.)

# extension — if it was bumped:
git tag extension-v0.1.7 && git push origin extension-v0.1.7
#   → extension-release.yml builds the zip + a DRAFT GitHub Release.
```

Then the **only** manual step: download the zip from the draft release and
upload it to the Chrome Web Store — see `docs/maintainers/publishing.md`. Publish
the draft GitHub Release once the CWS submission is in.

## Verify the publish

- `npm view @real-a11y-dev/<pkg> dist-tags` shows the new version on `beta` and
  `latest`.
- `npm view @real-a11y-dev/<pkg> versions` includes the new one.
- The publish workflow run is green (both the publish and advance-latest steps).

## Gotchas

- **A publish that "skips" packages is fine** — `pnpm publish -r` skips versions
  already on npm (unchanged packages). Not an error.
- **Private packages never publish** — `pnpm publish -r` skips `private: true`
  (the extension), so it can't leak to npm.
- **Don't hand-move `latest`.** If it looks wrong (e.g. pointing at a stray
  preview build), a normal beta publish fixes it via `advance-latest.mjs` — a
  re-run of the publish is the fix, not `npm dist-tag`.
- **`--frozen-lockfile` in CI** means the committed `pnpm-lock.yaml` must match.
  `workspace:*` bumps usually don't touch it, but if `pnpm install --lockfile-only`
  changed it, commit that too.
- **Stable graduation is a one-way door** for the version — confirm the user
  really means `changeset pre exit`, not just another beta.
