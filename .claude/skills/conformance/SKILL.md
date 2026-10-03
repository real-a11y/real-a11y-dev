---
name: conformance
description: >-
  Check that what our packages report matches the accessibility standards and
  the browser: the DOM producer against Chromium's native tree and W3C's own
  tests (WPT for WAI-ARIA, HTML-AAM and AccName), and the audit rules against
  the W3C ACT Rules that tie each check to a WCAG success criterion. Use when
  asked to verify WAI-ARIA / WCAG / W3C alignment, to sweep for DOM↔native
  divergences, after a Playwright or Chromium bump, before changing role, name
  or state computation or an audit rule, or when someone asks whether a finding
  is real. Produces root-caused findings and Notion tickets, not fixes — fixes
  go through the `pr` skill.
---

# Conformance

The repo's promise is that a finding is a **real** accessibility issue. That
holds only if the tree is what assistive technology actually receives, and the
rules flag what the standards actually require. Unit tests can't establish
either: they encode what we _believed_ when we wrote them. This skill checks
both against oracles we don't control.

## 0. The model — read before judging a single row

Three oracles, each answering a different question:

| Oracle                                                       | Answers                                | Read through                                         |
| ------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------- |
| **Spec** — WAI-ARIA 1.2/1.3, HTML-AAM, AccName 1.2, CORE-AAM | what an element _should_ expose        | WPT's `data-expectedrole` / `-label` / `-properties` |
| **Chromium** at the pinned milestone                         | what a Chrome user's AT _does_ receive | raw CDP, and the native producer over it             |
| **WCAG 2.2**, via ACT Rules                                  | what counts as a _failure_             | ACT examples + `accessibility_requirements`          |

**The policy this skill applies: the DOM producer's reference is Chromium at the
pinned milestone. The spec is the tie-breaker and the reference for rules.**

Why Chromium rather than the spec: the CLI and MCP read the native tree, the
extension is Chrome-only, and `testing`/`react` in jsdom are predictions of what
Chrome would expose. A DOM producer that is "more correct than Chrome" describes
a tree no Chrome user gets. The run of `fix(core): … the way Chromium does`
commits in `git log` is this policy applied one case at a time; this skill
applies it in sweeps.

`probe.mjs` sorts each element into a verdict. What a verdict means:

| DOM vs native | Against spec / raw                      | Verdict + hint                   | It is                         | Do                                                                                                        |
| ------------- | --------------------------------------- | -------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| agree         | meets                                   | `ok`                             | conformant                    | —                                                                                                         |
| differ        | native meets spec, or no spec           | `dom-gap`                        | DOM producer bug              | fix `core/src/extraction/`                                                                                |
| differ        | raw Chromium = DOM, normalized native ≠ | `dom-gap` + "suspect normalizer" | **native normalizer** bug     | fix `core/src/native/`, bump `NATIVE_AX_VOCABULARY_VERSION`                                               |
| differ        | DOM meets spec, Chromium doesn't        | `dom-gap`                        | a policy call — Chromium wins | align to Chromium, cite the spec divergence in a comment; `ready-for-human` if it hides a user-facing bug |
| agree         | both miss, raw Chromium misses too      | `chromium≠spec` + "mirrored"     | Chromium deviates; we mirror  | not a bug — confirm a comment or parity test records it                                                   |
| agree         | both miss, raw Chromium meets           | `chromium≠spec` + "both lose it" | both producers wrong          | fix both                                                                                                  |

A divergence is a **two-way signal** (CLAUDE.md): never assume the DOM side is
the broken one until you have read raw against normalized.

### Not findings — the representation conventions

Check these before filing anything. The probe already discounts the first four;
know them anyway, because a hand-run comparison won't.

- **Folded text.** Where Chromium leaves a node unnamed, the tree folds its
  visible text into `name` (prose roles in `NATIVE_AX_OWN_TEXT_ROLES`, text-only
  leaves — `promoteNameFromDroppedDescendants`). That's display, not an
  accessible-name claim. A DOM≠native difference there is still a parity gap,
  but a low-severity one.
- **UA shadow content** — media controls, a date input's picker — is visible
  only to native, by design. The probe compares only elements the page owns.
- **Unnamed generics** are dropped by both producers.
- **States outside the shared vocabulary.** `hidden`/`current` are DOM-only;
  `focusable`/`editable`/`invalid`/`modal`/… are native-only. The probe compares
  `SHARED_STATES` and treats `false` as absent only for `disabled`, `required`,
  `readonly` and `busy`; "not checked", "collapsed" and "not pressed" are
  spoken, so those stay strict. Re-derive `SHARED_STATES` whenever
  `ARIA_STATE_ATTRIBUTES` (core) or `STATE_PROPS` (browser) changes.
- **`tabs` is DOM-only.** Its oracle is real Tab presses (`--tabs`), never the
  native tree. Do not "unify" it.
- **`.tentative.html` WPT files** are proposals. A miss there is never a spec
  violation.
- **Blink-internal role names in native output** (`Date`, `DateTime`,
  `ColorWell`, `DescriptionList`, `SvgRoot`, `Abbr`, …) are either a normalizer
  vocabulary gap or milestone drift. Settle which on the pinned Chromium before
  filing. If it is the normalizer, the audit consequence is real:
  `INTERACTIVE_ROLES` doesn't know `Date`, so an unlabeled date input goes
  unreported on the native producer.

## 1. Setup

Work in a worktree (CLAUDE.md). The scripts load the **built** packages, which
is the code every surface ships, so build first and again after any edit. They
warn when `src/` is newer than `dist/`.

```bash
pnpm install
pnpm --filter "@real-a11y-dev/browser..." build
```

The oracles are sparse clones, kept **outside** the repo:

```bash
C=~/.cache/real-a11y-conformance
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/web-platform-tests/wpt.git "$C/wpt"
git -C "$C/wpt" sparse-checkout set accname html-aam wai-aria core-aam
git clone -q --depth 1 --filter=blob:none --sparse https://github.com/act-rules/act-rules.github.io.git "$C/act-rules"
git -C "$C/act-rules" sparse-checkout set _rules
```

Refresh with `git -C "$C/wpt" pull`, and record both short SHAs in the report,
because expectations change upstream. Override locations with
`REAL_A11Y_CONFORMANCE_CACHE`, `REAL_A11Y_WPT_DIR` and `REAL_A11Y_ACT_DIR`. For
spec text, `raw.githubusercontent.com/w3c/{aria,accname,html-aam,core-aam}/main/index.html`
serves the same source where `w3c.github.io` is blocked by a proxy.

**The Chromium milestone is part of every result.** The scripts read the pin
from `playwright-core`'s `browsers.json` (153 as of this writing) and warn when
the running build differs. `REAL_A11Y_CHROMIUM=<path>` points them at another
binary. A cloud container may only carry an older build, and must not run
`playwright install`. Sweep there for triage if you must, but **a finding counts
only once it reproduces on the pinned milestone**: locally, or in CI as a
`native-parity.e2e.test.ts` case. The DOM producer was tuned against that
milestone (grep the `Chromium 15x` comments), so an older browser reports drift
that isn't there.

## 2. Lane A — the tree (`probe.mjs`)

```bash
P=.claude/skills/conformance/scripts/probe.mjs
node $P wpt:accname wpt:html-aam wpt:wai-aria --summary   # sweep (~10 s)
node $P wpt:accname/name/comp_label.html                  # one page, row detail
node $P --html '<a href="#"><img src="x.png" aria-label="Home"></a>'   # a snippet
node $P page.html --tabs                                  # + tab order vs real Tab presses
node $P wpt:html-aam --json > sweep.jsonl                 # for grouping
```

Each row shows `dom`, `native`, `raw` (un-normalized CDP) and `spec`, along
with the hint the decision table needs. Exit status is 1 on any `dom-gap` or
tab-order difference. `chromium≠spec` alone does not fail.

Triage, in this order:

1. **Group by pattern, not by row. The counts lie.** One sweep reported 41
   `dom-gap` rows on `comp_name_from_content.html`, and they came down to three
   causes: CSS generated content (`::before`/`::after`, counters), an image's
   text alternative inside name-from-content, and `text-transform`. Group the
   JSON by field and shape, e.g. "name, DOM ⊂ native" or "description, DOM
   empty", then read the test names within each group. **One ticket per root
   cause.**
2. **Minimize to a snippet** and re-probe with `--html`. The minimal form often
   shows the real trigger, which the page-level symptom hid.
3. **Read raw against native** before blaming either producer (the decision
   table's rows 3 and 6).
4. **Find the code and its history.** Use `git log -S'<construct>'` or
   `git log --grep`. A deliberate divergence has a comment saying why, and a
   parity test pinning it. If it was decided before, the finding is "the
   decision is stale on milestone N", not "this is wrong".
5. **Reproduce on the pinned milestone** (§1). Otherwise it isn't a finding.

## 3. Lane B — the rules (`act.mjs`)

Every `audit` rule must be able to name its **normative basis**, and its
severity should follow from it. The seed table below is the claim under test;
the ACT half of it lives in `MAPPED` in `act.mjs`.

| Rule                       | Severity today  | Basis                                            | ACT rules                      |
| -------------------------- | --------------- | ------------------------------------------------ | ------------------------------ |
| `no-unlabeled-interactive` | error           | WCAG 4.1.2 (A)                                   | 97a4e1, c487ae, e086e5, m6b1q3 |
| `image-alt`                | warning         | WCAG 1.1.1 (A)                                   | 23a2a8                         |
| `dialog-labeled`           | error           | WAI-ARIA: `dialog` requires a name (author MUST) | —                              |
| `label-title-only`         | warning         | best practice (axe `label-title-only`)           | —                              |
| `heading-order`            | warning         | best practice (axe `heading-order`)              | —                              |
| `landmark-structure`       | error / warning | best practice (axe `landmark-one-main`)          | —                              |

**Severity policy to apply:** `error` iff failing the check fails a WCAG A/AA
success criterion (an ACT rule with `forConformance: true`) or an ARIA author
MUST. Otherwise `warning`. The table already shows two mismatches to raise:
`image-alt` is a warning on a Level A criterion, and a missing `<main>` is an
error with no success criterion behind it. Raise them as **questions, never
as auto-fixes**. Severity is public output: snapshots, CI gates and SARIF
consumers key on it, so changing it needs a changeset and possibly a
breaking-change note (`docs/STABILITY.md`).

```bash
A=.claude/skills/conformance/scripts/act.mjs
node $A                       # every mapped ACT rule
node $A --only-wrong          # just the misses
node $A ffd0e9 --as heading-order   # test a rule against a requirement it doesn't claim yet
```

For each example it runs `collectFindings` over **both** producers and keeps
only the mapped rule's findings. Read the output as:

- **false negative**: a Failed example where the rule stays quiet.
- **false positive**: a Passed or Inapplicable example where it fires. These
  are the worst kind for this product, because each one teaches a developer to
  ignore the tool.
- **producers disagree**: the rule gave different verdicts on one page. It is
  almost always a tree gap underneath, so `probe.mjs --html` the example.
- **UNCOVERED**: a requirement no rule claims (e.g. empty headings, ffd0e9).
  These are listed, not failed. They're the roadmap.

`act.mjs` aborts network so runs stay offline and repeatable. An example that
depends on a loaded image may behave differently. Before filing such a case,
re-probe it with a `data:` image.

**`validate` (manual for now).** ACT 674b10, ff89c9, bc4a75, 4e8ab6, 5c01ea,
6a7281, 5f99a7 and 307n5z map to `toBeValidA11yTree` in `testing`, which runs
`validate` in jsdom. Its SemanticNode→ValidatedNode adapter isn't exported, so
run those examples through the matcher in a scratch vitest file with the same
pass/fail semantics. If that becomes routine, add a jsdom mode to `act.mjs`
rather than repeating it by hand. jsdom is also where most `testing` users run
the DOM producer.

## 4. Turning findings into work

**Verify against source before reporting anything.** Name the `file:line` that
computes the wrong value. A finding that describes only a symptom gets argued
about.

**One Notion ticket per root cause** in Tasks (`docs/agents/issue-tracker.md`):

- **Project**: the published package the behaviour reaches users through. `core`
  is internal, so pick `Testing`, `CLI` or another real project. If none fits,
  ask before creating a project, because Projects is a shared database.
- **Body**: the minimized probe output; the spec citation (section URL plus the
  WPT file and test name, or the ACT rule and example); the Chromium milestone;
  the decision-table row; where the fix goes; and the probe command that
  verifies it.
- **Triage**: `ready-for-agent` when the decision table settles it and the fix
  is mechanical. `ready-for-human` for policy calls (DOM meets spec, Chromium
  doesn't) and for any severity change.

**One report per sweep.** It holds the summary lines, the WPT and ACT SHAs, and
the Chromium milestone, so the next run can diff against it and file only
what's new. No conformance reports database exists yet, so ask where it goes
the first time.

**The fix shape.** This is the house pattern; read `git show e502e40` for a
full instance:

- a jsdom unit test in `core` (`dom-extractor.test.ts` / `role-map.test.ts`);
- a both-producer assertion in `packages/browser/e2e/native-parity.e2e.test.ts`;
- a comment citing the spec section and the Chromium milestone;
- `pnpm --filter @real-a11y-dev/browser test:e2e`, which `verify` does not run;
- a changeset naming the published packages, plus the extension's
  `## Unreleased` entry, then the `pr` skill.

Keep it to **one root cause per PR**. A sweep session files tickets; it doesn't
batch twelve fixes into one diff.

## 5. On a schedule

What changes here without a commit is **Chromium**, through Playwright bumps,
and **the specs**, through WPT. So the useful triggers are a Playwright bump PR
and a weekly run. A routine should run lanes A and B in summary mode on the
pinned milestone, diff against the last report, and file tickets only for new
root causes. That needs an environment with the pinned Chromium. A container
that carries only an older one produces drift, not findings.

## Traps

- **A stale build tests yesterday's code.** Heed the warning and rebuild.
- **An older Chromium invents gaps.** Heed the milestone warning; §1.
- **WPT pages that build their DOM through `testdriver`** run here without
  testharness. Expectations on elements created later may be missing, so
  "0 expectations" is not a pass.
- **Don't fix toward the spec when Chromium disagrees** without making the
  policy call explicitly (decision table, row 4).
- **Never edit the WPT/ACT caches**, and never add a `MAPPED` row to make a run
  greener. Both oracles are only worth something because we don't control them.
