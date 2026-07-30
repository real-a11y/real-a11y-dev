# Release test scenarios

The two suites that gate a release, one file per scenario.

- **`regression/`** (`R*`) — **pre-publish.** Run against the built repo and packed
  tarballs, before anything reaches npm.
- **`dogfood/`** (`D*`) — **post-publish.** Run against what the registry actually
  served, from a clean machine.

Both suites test the same products at two altitudes, which is why they aren't one
list. A packaging fault is invisible to `regression` in the ways that matter (the
workspace resolves by path, a published package resolves by its `exports` map) and
a broken quick-start is invisible to `dogfood` until someone follows it. Rows that
assert the same subject on both sides are linked with `twin:`.

## Why these live here and not only in Notion

They used to live only in Notion, which made them unreviewable in the one way that
counts: a PR could change the behaviour a scenario asserts and nothing connected
the two. The suites drifted exactly as you'd expect —

- a row named a `get_native_tree` MCP tool **that never existed**;
- another asserted "all 9 commands" long after there were 14;
- a third asserted "the 18 tools" through 20 and then 19.

None of that was catchable, because the assertion was in Notion and the truth was
in TypeScript. In the repo they diff alongside the code that breaks them, and
`pnpm surface:check` fails when a scenario names a surface that isn't real.

Notion keeps what it is good at: **`Result` and `Notes` are the per-run surface**,
where a human records Pass/Fail/Blocked and what they saw. Nothing here syncs those
back, and nothing there is authoritative about what a scenario *says*.

## Format

Frontmatter, then a body with `## Steps`, `## Expected`, `## Why this exists`, and
optionally `## Notes`.

```markdown
---
id: R3
suite: regression
scenario: "CLI `audit` — exit codes, findings, --format json"
area: CLI
type: Automated          # Automated | Manual
priority: P0             # P0 | P1 | P2
status: Active           # Active | Deprecated
validFrom: "cli ≥ 0.1.0-beta.1"
validUntil: ""           # set only when Deprecated
expected: "clean page → exit 0; violating page → exit 1 + rule id"
twin: D2                 # or a `  - D2` list; twins are not 1:1
covers:
  - cli.commands.audit
  - cli.exitCodes
notion: "https://…"
---
```

**The frontmatter is not YAML**, and deliberately so. `plan` is its main consumer
and runs in a CI job with no `node_modules` — that is what lets it post an advisory
comment with no install — so a parser dependency would reintroduce the exact
`ERR_MODULE_NOT_FOUND` that shaped `scripts/surface/index.mjs`. The reader supports
`key: value` and `  - item` and **nothing else**; anything a real YAML parser would
accept and this wouldn't is a hard error naming the file and line, so the
restriction can never silently mis-read a file into a plausible wrong value.

Two consequences worth knowing before you edit a row:

- **There are no trailing comments.** A `#` at the start of a line is a comment; a
  `#` anywhere else is literal text. It has to be, because real rows carry `(#258)`
  in `validFrom` and `expected`. `priority: P0 # flagship` is the string
  `P0 # flagship`, which the enum check then rejects by name.
- **Values are single-line.** No block scalars, no continuations — long prose lives
  in the body, which is ordinary markdown and can be as long as it needs to be.

### `covers:` — the part that does the work

`covers` lists **manifest paths**, in the same vocabulary `plan/diff.mjs` already
emits when something moves (`cli.commands.audit`,
`mcp.tools.type_text.params.text`, `packages.@real-a11y-dev/cli`). One vocabulary
on both sides is the whole trick: a change path can be matched against `covers`
directly, with no mapping table in between, which is what lets `plan` name the
affected rows instead of saying "check them by hand".

A prefix counts — a row covering `cli.commands.audit` covers its flags too, since
someone running `audit` end to end is exercising `--fail-on`.

**`covers` means "exercises the behaviour of", not "touches".** R7 runs `--help`
for all 14 commands and lists none of them; R8 asserts the MCP tool *list* and
lists no tools. A row claiming everything it touches would satisfy the coverage
gate for capabilities whose behaviour nothing actually drives — the false
confidence the gate exists to prevent.

## Commands

```bash
pnpm surface:scenarios              # the suites on their own
```

Add `--coverage` for the per-capability matrix. `pnpm surface:check` runs the same
gate as part of the whole surface check, and `pnpm surface:plan` reports which rows
a branch's surface changes oblige you to update.

### What is checked mechanically

Ids are unique and match their filename · every `covers` path exists in the
manifest · every shipped CLI command and MCP tool has at least one **Active** row
covering it · every `twin` exists, sits in the other suite, and is reciprocated ·
`Deprecated` rows carry a `validUntil` and `Active` rows don't · `validFrom` names
a package · the body has its required sections.

Whether a row's Steps still describe a *sensible test* is editorial and stays
human. The checks cover what is objectively true or false.

## Adding a scenario

Copy the nearest existing row and edit it — `R3` for a short one, `R9` for one with
many `covers` entries. Then:

1. Give it the next free id in its suite, and name the file `<id>-<slug>.md`.
2. Fill `covers` with the paths it genuinely exercises.
3. Add `twin:` if the other suite asserts the same subject, **and add the reverse
   link** — a one-way twin reports the pair when one side changes and stays silent
   when the other does, which the check rejects.
4. `pnpm surface:scenarios`.

If a capability ships with no row, the coverage gate fails and names it. That is
how `R27` came to exist: `real-a11y login` — the one command that writes a live
session credential to disk — had no scenario in either suite, and nothing had ever
been able to say so.
