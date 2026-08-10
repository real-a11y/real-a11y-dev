---
id: R22
suite: regression
scenario: "Release integrity — versions, changelogs, and dist-tags are consistent before publishing"
area: Release
type: Automated
priority: P1
status: Active
validFrom: "every release. Pre-mode `beta` is active (.changeset/pre.json). The linked family and cli/mcp version independently — differing numbers are correct, not a bug. The linked group SHRINKS each time a package goes internal, so read it out of `.changeset/config.json`'s `linked` array rather than from memory or from this line."
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
2. Confirm the linked family members **this release moves** all moved to one version
   together — `linked` never pulls an unchanged member in, so one left at its previous
   number is correct (see the last paragraph). **Read the
   group out of `.changeset/config.json`'s `linked` array — do not use a list from
   memory or from this file.** It loses a name every time a package goes internal
   (ten originally; six after `ui`, `serialize`, `audit` and `snapshot` left), and a
   remembered count makes you either fail a good release or "fix" it by re-adding a
   private package to `linked` — which recreates the mixed-changeset group that
   breaks `changeset version` outright
3. Confirm `cli` and `mcp` versioned **independently** — they are not in the linked
   group, so their numbers legitimately differ — read both from the manifests
   rather than expecting a particular pair
4. Every bumped package has a matching CHANGELOG entry, and the entry describes the
   change rather than repeating the version
5. `.changeset/pre.json` — `mode: "pre"`, `tag: "beta"` for a beta; absent/exited for
   a stable
6. Intended dist-tag: while `mode: "pre"`, a `beta` publish **also advances `latest`**
   (`scripts/advance-latest.mjs`, so `npm i` hands out the newest beta rather than a
   stale one). After `changeset pre exit` it must not — the stable owns `latest`
7. Cross-package consistency: anything bundling a changed package is re-released, so
   none ships a stale engine. For a **private** dependency changesets cannot do this
   for you — `ui` and `validate` have no version to cascade from, and they are
   `devDependencies` of the packages that publish them besides — so a fix in
   `packages/ui` or `packages/validate` bumps nothing at all unless the changeset
   names the consumers itself: `inspector` and `storybook-addon` for `ui`,
   `testing` for `validate`, plus the extension (which holds `ui` as a runtime
   dependency) on its own track
8. Confirm the tag you're about to push matches the versions just written

## Expected

- One version across the linked family members the release moves; unmoved members stay
  where they were; `cli`/`mcp` independent and deliberate
- Every bump has a changelog entry a user could act on
- Beta publishes go to the `beta` dist-tag and, pre-1.0, take `latest` with them; once a
  stable exists they leave it untouched
- No package bundling a changed engine is left behind at an older build
- A change confined to a private package has a changeset naming its **consumers** —
  otherwise the release silently ships the code with no version bump and no changelog
  line anywhere a user reads. Naming the private package alone is accepted and then
  ignored, so it looks done. The mapping, derived from `noExternal` in each
  consumer's tsup config rather than memorised:

  | private | a changeset must name |
  | --- | --- |
  | `audit`, `serialize` | `testing`, `browser`, `cli`, `mcp` |
  | `snapshot` | `cli`, `mcp` |
  | `semantic-navigator-ui` | `inspector`, `storybook-addon` (+ the extension, own track) |
  | `validate` | `testing` |
  | `session-registry` | `cli`, `mcp` |

## Why this exists

The independence of `cli`/`mcp` from the linked family (3) is the trap: seeing
`cli 0.1.0-beta.1` next to `core 0.1.0-beta.11` looks like a mistake and isn't.
Someone "fixing" that alignment would publish nine packages for no reason and break
the linked group's contract.

Step 7 is the one with the longest tail — a bundler shipping a stale engine produces
bugs already fixed upstream, reported against a version that contains the fix.

Privatizing a package erodes the mechanism that used to make step 7 automatic — and
it was never fully automatic, which is the part worth knowing. While `ui` was
published, `storybook-addon` listed it in `dependencies`, so a ui bump cascaded
there, and `linked` then put the released members on one number. `linked` only
aligns packages already IN the release; it never pulls an unchanged one in.
`inspector` already held `ui` as a devDependency, which changesets deliberately
does not bump for — so half of step 7 was manual before this PR, and privatizing
`ui` makes it all of it. Now `changeset:status` is clean, the release goes out, and
the fix is in nobody's tarball — silent in both directions, since there is also no
changelog entry to notice missing. Expect this to grow as more packages go internal:
each one subtracts a name from `linked` (2) and adds one to the set step 7 has to
check by hand.

`0.1.0-beta.14` is the release that made both of those concrete. It published
`testing`/`storybook-addon` at `beta.14` and left `core`/`inspector`/`react` at
`beta.13` — a linked family on two numbers, and correct. Step 2 said "all moved to one
version together" and would have called it a bug. Step 6 was wrong in the other
direction: it said a beta never moves `latest`, when `scripts/advance-latest.mjs` has
advanced it on every prerelease since #115 — predating this suite's import in #270, so
the assertion was never true while it was written down.

Note the mechanical guard: CI's changeset gate keys on a newly **added**
`.changeset/*.md`. Editing an existing changeset does not satisfy it, by design — one
changeset per change is what keeps the generated changelog readable.
