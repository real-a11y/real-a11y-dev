---
id: D9
suite: dogfood
scenario: "Storybook addon from npm in a fresh Storybook project"
area: Storybook
type: Manual
priority: P2
status: Active
validFrom: "storybook-addon ≥ 0.1.0-beta.11 from the registry on the `beta` tag. Record the Storybook major used — addon APIs move between majors"
validUntil: ""
expected: "installs per the docs, the panel appears, and it tracks stories — the addon's exports subpaths resolve in a real SB build"
twin: R21
covers:
  - packages.@real-a11y-dev/storybook-addon
notion: "https://app.notion.com/p/3aa1c354b0b581f69748dd227ccfb841"
---

## Steps

A fresh Storybook project, installing from the registry and following only the published docs.

```bash
npx storybook@latest init
```

Then install `@real-a11y-dev/storybook-addon@beta` as a dev dependency.

1. Register the addon exactly as the docs describe
2. `npm run storybook` — does the panel appear in the addons tray?
3. Open a few stories; switch between them
4. Change a control that alters the DOM
5. `npm run build-storybook`, serve the static output, repeat 2–4
6. Check the browser console in both dev and static builds
7. Try with the **current** Storybook major, and note which version you used
8. Note anything the docs omit that you needed

## Expected

- The addon registers per the docs, with no undocumented extra config
- The panel appears and tracks stories and controls
- **The static build works** — this is where the addon's `exports` subpaths get resolved by
  Storybook's production builder
- No console errors in either mode
- The docs match the Storybook version people will actually be on

## Why this exists

Step 5 is the reason this row is worth its P2. Storybook's dev server and its production builder
resolve subpath exports through different paths, so an addon can work perfectly in `storybook`
and fail in `build-storybook` — and the static build is what teams deploy and share. A failure
there is invisible to anyone who only ever runs dev.

Step 7 exists because Storybook majors move fast and break addon APIs; a doc pinned to a version
nobody installs any more is a doc that doesn't work, even though nothing about our code changed.
