---
id: D1
suite: dogfood
scenario: "Registry health — every package resolves at the published version with the right dist-tag and contents"
area: Install health
type: Automated
priority: P0
status: Active
validFrom: "every published release. While pre-mode `beta` is active, BOTH `beta` and `latest` move to the new prerelease — `scripts/advance-latest.mjs` advances `latest` deliberately, and self-disables once `changeset pre exit` puts a stable there. After that day this inverts and a beta must leave `latest` alone. For any package that has gone PRIVATE, every assertion here INVERTS too — npm keeps serving its last published version, so assert nothing moved. Read that set from `private: true` in the manifests."
validUntil: ""
expected: "npm view shows the new version + intended tag; a fresh install of each package imports (ESM + CJS) with types"
twin:
  - R1
  - R2
  - R22
covers:
  - packages.@real-a11y-dev/core
  - packages.@real-a11y-dev/serialize
  - packages.@real-a11y-dev/audit
  - packages.@real-a11y-dev/snapshot
  - packages.@real-a11y-dev/browser
  - packages.@real-a11y-dev/validate
  - packages.@real-a11y-dev/semantic-navigator-ui
  - packages.@real-a11y-dev/inspector
  - packages.@real-a11y-dev/react
  - packages.@real-a11y-dev/testing
  - packages.@real-a11y-dev/storybook-addon
  - packages.@real-a11y-dev/cli
  - packages.@real-a11y-dev/mcp
notion: "https://app.notion.com/p/3aa1c354b0b58124b5bdef3550f9079c"
---

## Steps

From a clean machine or container — **no** workspace, no pnpm store warmed by the
monorepo.

1. `npm view <pkg> version dist-tags` for every published package
2. Confirm the intended tag moved — and, while pre-mode is active, that **`latest`
   moved with it**. Read the rule from `.changeset/pre.json`, not from this line:
   `mode: "pre"` means both tags advance; once that file is gone, a beta must leave
   the stable `latest` where it is
3. `npm view <pkg> files` / inspect the packed contents — no source maps or fixtures that
   shouldn't ship
4. Fresh scratch project: `npm i <pkg>@<new-version>` for each
5. Import each as **ESM**; `require()` each as **CJS**
6. Type-resolve each entry
7. `npx real-a11y@<version> --version` and `npx @real-a11y-dev/mcp@<version>` — with **no**
   local install
8. Repeat 5 on Node 24
9. Check the linked family members **this release moved** share one version, and that
   `cli`/`mcp` are at their own (correct) versions. `linked` aligns only packages
   already in the release; a member with no changeset legitimately stays behind at
   its previous number
10. For every package that has gone **private**, the check inverts — assert nothing
    moved. Take the set from `private: true` in `packages/*/package.json` rather than
    from a list here; it grows each release. For each, `npm view` still reports the
    version it was last published at, its dist-tags sit where that release left them,
    and `npm i` of a pinned old version still resolves. Do not unpublish, do not
    re-point a tag — `npm deprecate` is the only thing that should have changed

## Expected

- Every package resolves at the new version with the intended dist-tag
- Pre-1.0, a beta publish takes `latest` with it — someone running
  `npm i @real-a11y-dev/cli` with no tag gets the newest beta, because there is no stable
  to fall back to. Once one exists, the same publish must leave `latest` untouched
- Fresh installs import cleanly under both module systems, with types
- `npx` works with nothing installed locally — this is how most people will first run it
- No package the release **moved** is left behind within the linked family — but a member
  with no changeset staying at its previous version is correct, not a miss
- A package that went internal stays exactly where it was left — same version, same
  tags, still installable. Going private stops future publishes; it does not retract
  the ones that already happened

## Why this exists

The pre-publish suite (**R1**) checks tarballs; this checks what the **registry actually
served**, which can differ: a publish can partially fail, a dist-tag can be applied to the
wrong version, and a `files` list can behave differently once npm has packed it.

Step 2 is the irreversible one, and it **inverts at `changeset pre exit`** — which is why
it is written as a rule to look up rather than a fixed expectation. Pre-1.0 there is no
stable to protect, and `--tag beta` alone never moves `latest`, so `npm i <pkg>` keeps
handing out an old prerelease and the npm page headlines it. That is the bug
`scripts/advance-latest.mjs` exists to fix; it is guarded to `mode: "pre"` and stops the
day a stable ships. From then on, moving `latest` to a beta breaks every unpinned
consumer, and it cannot be undone by unpublishing — only by publishing again and
re-pointing the tag, by which time people have installed it.

Both halves of step 2 got this backwards until `0.1.0-beta.14`. The suite was imported
from Notion in #270 asserting the post-stable rule, while the pipeline had been advancing
`latest` since #115 — so the scenario shipped already contradicting the release it
verifies, and a runner following it would have failed a correct release on the step this
paragraph calls the most important one. Step 9 had the twin of that bug: it read the
linked family as one number, which `0.1.0-beta.14` disproved by publishing
`testing`/`storybook-addon` while `core`/`inspector`/`react` stayed at `0.1.0-beta.13`.
Neither is the kind of rot `surface:check` can catch — it validates that a scenario
parses and that its `covers` paths are real, not that its assertions match the pipeline.

Step 10 only appears once a package goes internal, and it is the step most likely to
be "tidied up". The registry has no notion of "we stopped publishing this":
`validate@0.1.0-beta.7` and `semantic-navigator-ui@0.1.0-beta.11` keep resolving and
keep carrying whatever dist-tag they had, which is correct rather than leftover mess.
Unpublishing them, or re-pointing a tag to look consistent, breaks installs that work
today and cannot be undone any more than step 2 can. `npm deprecate` is the tool if
they should stop being recommended: every existing install keeps working, and anyone
installing one gets a message pointing at the package that bundles it now.
