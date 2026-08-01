---
id: R22
suite: regression
scenario: "Release integrity — versions, changelogs, and dist-tags are consistent before publishing"
area: Release
type: Automated
priority: P1
status: Active
validFrom: "every release. Pre-mode `beta` is active (.changeset/pre.json). Linked family and cli/mcp version independently — differing numbers are correct, not a bug"
validUntil: ""
expected: "linked group shares one version; every bumped package has a changelog entry; the intended dist-tag is correct for a beta"
twin: D1
notion: "https://app.notion.com/p/3aa1c354b0b581278f24e152bc49dcf9"
---

## Steps

Run **after** `changeset version` on the release branch, **before** tagging.
Publishing is irreversible; every check here is cheap and every miss is permanent.

1. `pnpm changeset:status` — no unconsumed changesets remain for packages being
   released
2. Confirm the **linked family** all moved to one version together: `core`,
   `serialize`, `audit`, `snapshot`, `ui`, `inspector`, `react`, `storybook-addon`,
   `testing`, `browser`
3. Confirm `cli` and `mcp` versioned **independently** — they are not in the linked
   group, so their numbers legitimately differ (today: family `beta.11`, cli/mcp
   `beta.1`)
4. Every bumped package has a matching CHANGELOG entry, and the entry describes the
   change rather than repeating the version
5. `.changeset/pre.json` — `mode: "pre"`, `tag: "beta"` for a beta; absent/exited for
   a stable
6. Intended dist-tag: `beta` publishes never move `latest`
7. Cross-package consistency: anything bundling `core` or `ui` (`inspector`,
   `storybook-addon`, extension) is re-released, so none ships a stale engine
8. Confirm the tag you're about to push matches the versions just written

## Expected

- One version across the linked family; `cli`/`mcp` independent and deliberate
- Every bump has a changelog entry a user could act on
- Beta publishes go to the `beta` dist-tag and leave `latest` untouched
- No package bundling a changed engine is left behind at an older build

## Why this exists

The independence of `cli`/`mcp` from the linked family (3) is the trap: seeing
`cli 0.1.0-beta.1` next to `core 0.1.0-beta.11` looks like a mistake and isn't.
Someone "fixing" that alignment would publish nine packages for no reason and break
the linked group's contract.

Step 7 is the one with the longest tail — a bundler shipping a stale engine produces
bugs already fixed upstream, reported against a version that contains the fix.

Note the mechanical guard: CI's changeset gate keys on a newly **added**
`.changeset/*.md`. Editing an existing changeset does not satisfy it, by design — one
changeset per change is what keeps the generated changelog readable.
