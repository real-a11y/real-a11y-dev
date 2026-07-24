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

### 6. Publish — merging the PR is the sign-off

Publishing is **public and irreversible**, and **merging the release PR starts
it**. `release-tag.yml` fires on any merged `release/*` PR: from the merge commit
it creates one tag per publishable package (`@real-a11y-dev/core@0.1.0-beta.10`,
matching the changesets convention) for every version not already tagged, then
dispatches `publish.yml` against that commit — plus `extension-v<version>` →
`extension-release.yml` when the extension version changed. So get the user's
explicit "go" **before merging**, not after; there is no second gate behind it.

The dist-tag is derived from the version, not chosen: `0.1.0-beta.N` publishes
under `beta` (then `advance-latest.mjs` moves `latest`), a plain `0.1.0` under
`latest`. Nothing to pass, nothing to remember.

A release that bumps only some packages (versions do drift — `cli`/`mcp` at
`beta.0` while the core cohort is at `beta.10`) just tags those; there is no
"which package anchors this" tag to invent. The one manual step the automation
will **not** do is touch the Chrome Web Store — `extension-release.yml` only
builds the zip and drafts the GitHub Release.

Both workflows stay runnable by hand from the Actions tab, so a merge that didn't
publish (automation bypassed, or you're recovering a failed run) is always
recoverable — either re-run **Publish to npm** from the Actions tab, or push the
break-glass aggregate tag:

```bash
# break-glass only — the automation uses per-package tags, not this:
git tag v0.1.0-beta.N && git push origin v0.1.0-beta.N
```

Then the **only** manual step: download the zip from the draft release and
upload it to the Chrome Web Store — see `docs/maintainers/publishing.md`. Publish
the draft GitHub Release once the CWS submission is in.

## Verify the publish

- The publish workflow run is green — check the **Publish** step and the
  **Advance latest dist-tag** step. The latter prints `+latest: <pkg>@<version>`
  for each move (or `warn ... already set`); that is npm's own write
  confirmation and is the source of truth.
- Confirm the tags from the registry. **`npm view` / `npm dist-tag ls` lag** —
  they read the full packument, which is CDN-cached ~5–10 min, so right after a
  publish they show the OLD `latest`. Don't trust them immediately, and don't
  "re-fix" `latest` because of a stale read. For a fresh answer hit the dedicated
  dist-tags endpoint:

  ```bash
  curl -s "https://registry.npmjs.org/-/package/@real-a11y-dev%2F<pkg>/dist-tags"
  # → {"latest":"0.1.0-beta.N","beta":"0.1.0-beta.N"}
  ```

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
