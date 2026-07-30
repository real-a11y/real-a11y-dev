---
id: D1
suite: dogfood
scenario: "Registry health — every package resolves at the published version with the right dist-tag and contents"
area: Install health
type: Automated
priority: P0
status: Active
validFrom: "every published release. While pre-mode `beta` is active, the `beta` dist-tag moves and `latest` must not"
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
2. Confirm the intended tag moved and, for a beta, that **`latest` did not**
3. `npm view <pkg> files` / inspect the packed contents — no source maps or fixtures that
   shouldn't ship
4. Fresh scratch project: `npm i <pkg>@<new-version>` for each
5. Import each as **ESM**; `require()` each as **CJS**
6. Type-resolve each entry
7. `npx real-a11y@<version> --version` and `npx @real-a11y-dev/mcp@<version>` — with **no**
   local install
8. Repeat 5 on Node 24
9. Check the linked family all published together at one version, and that `cli`/`mcp` are
   at their own (correct) versions

## Expected

- Every package resolves at the new version with the intended dist-tag
- A beta publish leaves `latest` alone — someone running `npm i @real-a11y-dev/cli` with no
  tag must still get the last stable
- Fresh installs import cleanly under both module systems, with types
- `npx` works with nothing installed locally — this is how most people will first run it
- No package left behind at an older version within the linked family

## Why this exists

The pre-publish suite (**R1**) checks tarballs; this checks what the **registry actually
served**, which can differ: a publish can partially fail, a dist-tag can be applied to the
wrong version, and a `files` list can behave differently once npm has packed it.

Step 2 is the irreversible one. Moving `latest` to a beta breaks every unpinned consumer,
and it cannot be undone by unpublishing — only by publishing again and re-pointing the tag,
by which time people have installed it.
