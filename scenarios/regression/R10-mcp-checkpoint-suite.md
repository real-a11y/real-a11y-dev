---
id: R10
suite: regression
scenario: "MCP checkpoint suite — checkpoint_findings/tree, diff_findings/tree/checkpoints, list/export/import"
area: MCP
type: Automated
priority: P1
status: Active
validFrom: "mcp ≥ 0.1.0-beta.1. The MCP tree checkpoint is Node-side and native from mcp ≥ 0.1.0-beta.6 (it was in-page, and DOM-producer, on ≤ 0.1.0-beta.5); see R26 for the CLI side, which moved first. Step 9's Expected carries both shapes. Step 7's a/b split is from mcp ≥ 0.1.0-beta.2 — before that, a diff across any two pages printed the structural summary regardless, so on an earlier release expect 7a to dump a large advisory section and treat that as the old behaviour, not a fail. The operation-naming headers in (3)/(6) are also mcp ≥ 0.1.0-beta.2; earlier releases print `Checkpoint diff …` for both. From mcp ≥ 0.1.0-beta.2 a page also carries an identity separate from its checkpoint LABEL, which changes what 7a's FINDINGS do (see its Expected) and stops import from rewriting what it stores (5)."
validUntil: ""
expected: "checkpoint → change page → diff reports exactly the introduced delta; export→import round-trips losslessly and unmodified; each diff's header names which operation ran and what it read; a diff across two different routes reports them as separate pages and suppresses the structural summary, while a diff across two deploys of one route compares them normally"
covers:
  - mcp.tools.checkpoint_findings
  - mcp.tools.checkpoint_tree
  - mcp.tools.diff_findings
  - mcp.tools.diff_tree
  - mcp.tools.diff_checkpoints
  - mcp.tools.list_checkpoints
  - mcp.tools.export_checkpoint
  - mcp.tools.import_checkpoint
notion: "https://app.notion.com/p/3aa1c354b0b58116b95bd8ac3cae0c6a"
---

## Steps

Two axes, deliberately different in kind — check both, and check that they behave
differently.

**Findings checkpoints (pure data, survive navigation):**

1. `open_page` → `checkpoint_findings`
2. Change the page so one violation is fixed and one is introduced
3. `diff_findings`
4. `list_checkpoints`
5. `export_checkpoint`, then `import_checkpoint` into a fresh session
6. `diff_checkpoints` between two stored checkpoints
7. Against the earlier checkpoint, `diff_findings` from somewhere else — two cases
   that must behave _differently_:
   - **a.** a different **route** (`/pricing` → `/careers`)
   - **b.** a different **deploy of the same route** (prod host → preview host)

**Tree checkpoint (Node-side; outlives the page):**

8. `checkpoint_tree` → click something → `diff_tree`
9. `checkpoint_tree` → navigate → `diff_tree`
10. `diff_tree` with no checkpoint taken

## Expected

- **3** — exactly the introduced delta: one fixed, one new. Not a re-listing of
  everything. From mcp ≥ 0.1.0-beta.2 the header also names the operation and the
  checkpoint it read: `Live page vs. saved checkpoint "<name>": …`
- **6** — and its header says no browser was read:
  `Saved checkpoints: "<base>" → "<head>" (no re-snapshot): …`. Run (3) and (6)
  back to back and confirm the two headers cannot be mistaken for each other —
  neither should say the old `Checkpoint diff …`
- **5** — round-trips losslessly; the imported checkpoint diffs identically to the
  original. From mcp ≥ 0.1.0-beta.2, check it round-trips **unmodified**: import
  stores the artifact's page as it arrived. Earlier releases rewrote it under the
  store label and re-fingerprinted — a workaround for the label being the identity,
  which now would _break_ the join rather than repair it. The payoff is worth
  checking directly: export a CLI-written artifact
  (`real-a11y snapshot <url> -o base.json`), `import_checkpoint` it, and
  `diff_findings` a live page against it. That cross-tool diff has never worked
  before this release; the imported page kept the store label as its identity while
  the live one derived its own
- **7** — both still run; findings checkpoints are pure data and survive navigation
  **by design**. What differs is the rest of the output:
  - **7a** — a `NOTE: different page` naming both addresses, and **no** "Structural
    changes (advisory)" section. From mcp ≥ 0.1.0-beta.2. The **findings** now also
    read as two separate pages: the checkpoint's report as fixed and the live page's
    as new, rather than pairing up. Read that as correct, not as a regression — it
    is what actually happened, and the `NOTE` above it is what makes it legible. On
    an earlier release the same run reported `0 new, 0 fixed`, because both sides
    were fingerprinted under the same checkpoint LABEL, which made two unrelated
    routes look like one page that hadn't changed
  - **7b** — the structural summary is **kept**, and the findings pair normally.
    Only the origin differs, and prod-vs-preview is the headline cross-deploy
    workflow
- **8** — the tree diff names what the interaction changed
- **9** — from mcp ≥ 0.1.0-beta.6, a report that the page navigated or reloaded,
  naming where it started and where it ended up, and telling you to re-checkpoint
  — NOT a diff claiming the whole page changed. On mcp ≤ 0.1.0-beta.5 this was
  instead a clean error, because the checkpoint lived in the page and the
  navigation destroyed it; either shape passes on its own release.
- **10** — tells the agent to `checkpoint_tree` first

## Why this exists

The asymmetry between the two axes in (7) and (9) is deliberate and is the thing
most likely to be "fixed" into uniformity by someone who reads it as a bug.
Findings are data about a page; a tree checkpoint is a handle into a live one.

Export/import (5) is what lets a checkpoint outlive a session, so a lossy
round-trip silently degrades every later diff rather than failing loudly.

The headers in (3) and (6) are worth checking together, not separately. Both
operations produce the same _shape_ of output, and the old wording
(`Checkpoint diff (vs. saved)` / `Checkpoint diff base → head`) technically
differed while saying nothing about which one ran — and the first never said WHICH
checkpoint, so with several stored an output could not be traced back to its input.
Reading either header alone will not catch a regression here; reading them side by
side will.

(7a) and (7b) are a matched pair and only mean something together. Suppressing the
structural summary across unrelated routes is the fix; suppressing it across two
deploys of one route would destroy the tool's headline use. A change that keys the
decision on the whole URL rather than on the path passes 7a and quietly breaks 7b,
which is why both are listed. The same pair now guards the **findings** join as
well, since both read the same page identity — see R29 for the CLI-side version of
that pair.

## Notes

Step 7 was one case ("navigate elsewhere, diff still works") until
mcp 0.1.0-beta.2 split it in two. The diff tools now compare the two sides'
addresses: a different path/query/fragment prints `NOTE: different page` and drops
the structural summary, while a difference in host/port/scheme alone changes
nothing. From cli/mcp ≥ 0.1.0-beta.6 those addresses are compared **after**
fragment redaction, so two pages differing only in a deny-listed fragment value
(`#code=A` vs `#code=B`) now read as the SAME page and the note is suppressed —
the values are both `[REDACTED]`. Their routes still separate them, which is why
the redactor truncates rather than replacing the whole fragment. A checkpoint also now records the LIVE url rather than whatever
`open_page` landed on, so a `click_element` that navigates before
`checkpoint_findings` is recorded honestly — without that, 7a could not be detected
at all, since both sides carried the opened address.

That comparison used to be advisory only: it decided whether to print a section,
while the findings underneath it still joined on the checkpoint's label. The same
release that split 7a/7b later promoted the rule to the page's actual identity, so
one definition of "same page" now drives both the note and the join. Two
workarounds went with it — `diffLabeledCheckpoints` re-fingerprinted both sides
under a neutral literal, and `import_checkpoint` rewrote what it stored (5) —
because both existed only to undo the label-as-identity conflation.
