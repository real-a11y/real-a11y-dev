---
name: code-review
description: >-
  The house code review for this repo — the checks that catch what actually
  breaks here: redaction-boundary crossings, comments asserting behavior the
  code doesn't have, join-key drift across surfaces, guards on the write path
  but not the read path, and error messages whose remedy dead-ends. Use when
  reviewing a PR, a branch diff, or your own work before pushing. Replaces the
  generic review pass — the generic one doesn't know where this codebase bleeds.
---

# code-review

A review here is not a style pass. This codebase is unusually well-commented and
well-tested, so the defects that survive to review are not the ones a linter or a
generic reviewer finds — they are **consistency defects**: two paths that should
agree and don't, or a comment that describes an intention the code stopped
honoring.

Every section below is grounded in a defect that actually shipped to a PR here.

## 1. Get the diff

There is **no `gh` CLI** in the remote environment. Use the GitHub MCP tools:

```
mcp__github__pull_request_read   method: "get"        # title, body, state, mergeable_state
mcp__github__pull_request_read   method: "get_diff"   # the unified diff
```

If the local checkout is on the PR's head SHA (`git rev-parse HEAD` matches
`head.sha`), read files directly — it is faster and gives you surrounding
context the diff crops out. Otherwise the diff is the scope.

The PR diff is the review scope. Local working-tree changes are not.

## 2. The house checks

### Redaction is a boundary — find everything that crosses it

`redactUrl`/`sanitize` exist because preview URLs carry tokens and this tool
writes files that get **posted into PR comments**: `a11y-snapshot.json`, every
fingerprint tuple, the committed `.a11y-baseline.json`.

Any new field derived from a URL must sit on the safe side of that line.

```bash
rg 'pageIdOf\(|new URL\(|\.search|\.href' --type ts packages/*/src
```

For each hit, ask: **is the input redacted, and does the field next to it get
redacted differently?** A field derived from the raw url sitting beside a field
derived from the redacted one is the signature.

> Shipped twice in one PR (#288): `buildSnapshotPage` derived the page id from
> the raw url while redacting `page.url` on the very next line. Fixed. Then the
> **error branch** in `snapshot.ts` — which builds its page by hand rather than
> through the shared assembler — did the identical thing, and survived the round
> of review that fixed the first one.

**Failure and fallback branches are where this hides.** They construct objects
by hand instead of calling the shared assembler, so every invariant the
assembler enforces has to be re-established there, and nothing checks that it
was. Grep for object literals that duplicate an assembler's output shape.

### A comment that asserts behavior is a claim — verify it

Comment density here is a feature: they explain _why the alternative was
rejected_, and they are written to be trusted. That makes a stale one more
expensive than in an ordinary codebase — a reader acts on it.

When a diff changes a join, a key, or a message, grep for the prose that
described the old behavior:

```bash
rg -i 'join(s|ed)? (on|by)|matched by|stable id|same page|never the' --type ts --type md
```

> Shipped: `samePage()` carried a comment saying "the diff, the baseline matcher
> and the MCP's different-page note all have to agree on this, and they only
> will while it is one function" — while being called by **none** of them, and
> exported from a published package. Also shipped: a checkpoint note promising
> "findings are still matched by fingerprint" printed exactly when the two sides
> could no longer match, and a diff warning telling users to align page _names_
> after names stopped being the join key.

Three sub-checks, all cheap:

- **Does the named function have the call sites the comment claims?** (`rg` it.)
- **Is a newly-exported symbol called at all?** Dead public API in a published
  package is a support obligation for nothing.
- **Does a user-facing message still name a real remedy?**

### One rule, one derivation — check every surface

`cli`, `mcp`, `snapshot` and `testing` are separate packages that must agree on
identity, fingerprints, and what "the same page" means. A change to the rule in
one is a change to all of them.

```bash
rg 'fingerprintFindings\(' --type ts    # every call must pass the SAME kind of key
```

> Shipped: `buildSnapshotPage` moved to id-keyed fingerprints while
> `audit.ts` and `inspect.ts` kept passing `target.name`, so one finding had two
> different "stable" ids depending on which command reported it — against the
> package README's explicit cross-tool identity promise.

### Write path guarded, read path not

Guards get added where the author was working. The other path is reached later,
by a file from disk, from an older release, from another tool.

For every new assertion, ask: **what reaches this state without passing through
here?**

- `buildArtifact` vs `parseSnapshotArtifact`
- the normal run vs the `--update-baseline` early return
- in-process construction vs a JSON file from a previous version

> Shipped, both in one PR: `assertDistinctPageIds` ran in `buildArtifact` but not
> on the parse path, so a legacy artifact could silently merge two pages'
> findings through the diff's `Map` join. And `--update-baseline` returned before
> the guard, so the command that **writes** a file was the permissive one.

### An error's remedy must actually work

A refusal that names a command is a promise that the command resolves it. Run it.

> Shipped: the v1-baseline refusal said "regenerate it:
> `real-a11y snapshot --update-baseline`" — and that path loaded the old baseline
> first, hit the same refusal, and left no way out but deleting the file by hand.

Same class: a remedy pointing at config for a defect baked into a file on disk.
An archived CI artifact cannot be re-captured, so "re-capture it" is not a
remedy for anything already written.

### Schema bumps and back-compat on the read path

When a schema version moves or a field becomes required, walk the older-file
path explicitly:

- Can the old file still be read? (Back-fill, or a **named** refusal — never a
  generic parse error.)
- Does a back-filled value collide where the old file was coherent? A file that
  diffed correctly for months must not become permanently unreadable.
- Is the fallback the thing the old file was _actually_ keyed on?

> Shipped: back-filling page ids from urls hard-errored on a legacy artifact of
> two sites sharing `/` — a file that was correct when written, because pages
> joined on `name` back then. The fix was to fall back to `name` for exactly the
> colliding pages.

### URLs whose path is not a route

The e2e fixtures are `data:` URLs. Anything deriving meaning from a URL must
handle schemes whose path is opaque — `data:` (the path is the whole document),
`about:`, `blob:`, `javascript:`.

> Shipped: page ids derived from `data:` URLs embedded the entire page body in
> the artifact and changed whenever a byte did. It broke `e2e`, which is the only
> reason it was caught.

## 3. Verify before reporting

**Do not report a finding you have not run.** Reading is how you find a
candidate; executing is how you earn the right to call it a defect.

Write a throwaway test in the relevant package, run it, delete it:

```bash
pnpm --filter @real-a11y-dev/<pkg> exec vitest run src/scratch-review.test.ts
rm packages/<pkg>/src/scratch-review.test.ts
```

Print the actual values rather than asserting your guess — the output is what
goes in the report, and it is what distinguishes a defect from a theory.

**Then check the regression test isn't vacuous.** Revert the fix, confirm the new
test fails, restore it. A test that passes against the bug is worse than none.

## 4. Report

Rank by consequence, not by how interesting the bug is. The ordering that
matters here: **silent wrong output** > **secret leakage** > **crash** >
**cosmetic**. A crash is visible and gets fixed; a plausible-looking report with
the wrong findings in it is not, which is why this codebase hard-errors on
identity collisions rather than warning.

Each finding: file:line, one-sentence defect, the concrete failure scenario, the
verified evidence, and a fix. Say plainly when a finding is a design
disagreement rather than a bug — those are the author's call, and framing a
preference as a defect wastes the round.

End with a verdict and offer to push the fixes.

## 5. Known blind spots — check these by hand

- **`e2e/` and `website/tests/` are still not typechecked.** Every package's
  `include` is `["src/**/*.ts"]`, so those directories are outside the program
  entirely — a hand-built fixture there can miss a required field and only fail
  at runtime. Confirm rather than assume:
  `pnpm --filter <pkg> exec tsc --noEmit --listFiles | grep -c /e2e/` → `0`.

  **`src/**/*.test.ts` used to be in this bullet and no longer is** — the
  exclusion was removed from every package and from the root config, so the
  compiler now catches fixture drift there. Deleted rather than softened,
  because a blind-spot list that keeps closed entries teaches reviewers to
  hand-check what the gate already covers, and the next stale line is the one
  nobody trusts the list over.

  Two prior versions of this bullet were wrong: it said "12 of 15 packages",
  which a package extraction falsified in two days, and then described the whole
  exclusion, which the fix falsified. Both times the mechanism was the same —
  a countable asserted in prose instead of checked by a command. Prefer the
  command.

- **`pnpm surface:plan` models the inventory, not the output.** It sees commands,
  tools, flags, env vars — not printed text, not error messages, not config-file
  keys. A PR adding `urls[].id` to the config moves nothing in the manifest.
- **`surface:check/samples.mjs` validates that documented invocations parse**,
  and says outright it does not check semantics. A documented config that now
  hard-errors still passes.
- **Docs examples are not executed.** When behavior becomes stricter, grep
  `website/` and `packages/*/README.md` for configs that would now fail.
- **`mergeable_state`** on the PR read: `behind` means the base moved and is not
  a blocker; `dirty` means a real conflict and is; `blocked` usually means CI or
  a required review. Say which, rather than "not mergeable".

## 6. Staleness has four tiers, and each one is swept separately

This is the pattern behind more than half the sections above, and it is worth
holding as a shape rather than a list. A behaviour change propagates outward,
and each tier out is swept by a different pass — so fixing one tier reliably
leaves the next one wrong.

| Tier                   | What lives there                          | How it fails                             |
| ---------------------- | ----------------------------------------- | ---------------------------------------- |
| 1. Code                | the logic itself                          | tests catch it                           |
| 2. Prose in code       | comments, error strings, hints            | nothing catches it — a reader acts on it |
| 3. Docs                | `website/`, `README.md`, scenarios        | nothing catches it — a user acts on it   |
| 4. Generated from docs | committed a11y snapshots, surface regions | **CI** catches it, after you push        |

> Observed across one PR, in exactly this order. Round one fixed the code and
> the `diff.ts` message. Round three found `commands.md` still saying pages join
> by name — tier 3, missed because round one swept only tier 2. The round after
> that went red on `website-a11y`: the committed a11y-tree snapshots of that
> very prose. Three rounds, one behaviour change, each tier discovered by the
> failure of the last.

So when a diff changes behaviour, sweep **outward** in one pass rather than
reacting tier by tier:

```bash
rg '<the old behaviour>' --type ts                  # tier 2: comments, messages
rg '<the old behaviour>' website/ packages/*/README.md scenarios/   # tier 3
cd website && pnpm build && pnpm exec playwright test --update-snapshots   # tier 4
```

**Read the regenerated snapshot diff — never commit it blind.** "Regenerate the
baseline" is exactly how a real a11y regression gets rubber-stamped into a
committed file. Prose edits should show as added prose and nothing else; a
changed finding count or a structural change in that diff is a defect, not
noise. Cross-check against the `real-a11y diff` bot's comment, which recomputes
from live captures and does not read the committed snapshots — if it says
"A11y unchanged" and your regenerated diff shows structure moving, believe the
bot and go look.
