---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/testing": minor
---

`diff` gains **`--explain`**, an opt-in plain-language summary of structural drift — statements a reviewer who isn't an a11y expert can act on, instead of raw serialized view lines. The default `diff` stays **neutral** (findings + the raw `+`/`-` view diff, both facts); `--explain` adds the interpretive layer (pairing heuristics, cross-view inference), so the default never makes a claim the raw diff can't back up:

```text
structure changed (advisory): tree +2/-1 · outline +1/-1 · tabs +1/-0
  · Heading level changed: "Setup" h2 → h3
  · Keyboard tab stop added: link "Skip" (now stop 1 of 2)
```

The taxonomy covers what assistive-tech users actually feel: landmarks added/removed/renamed (removing `main` calls out broken skip-links), heading level changes and renames, keyboard tab stops added/removed with their position — including the dangerous variant where the element is **still on the page but no longer keyboard-focusable** (cross-checked against the PR tree) — interactive elements outside the tab order, and **pure reorders** of the tab order or heading outline, which add/remove no lines and were previously invisible in every output. Anything unrecognized degrades to one honest `Other content changed: +N/-N lines` rollup — never silence. Rename/level pairings are count-aware and strictly 1:1; any ambiguity degrades to add/remove, so the summary never guesses.

Where it lands (statements only under `--explain`; the raw view diff shows either way):

- **pretty** — neutral output shows the `structure changed (advisory): tree +N/-N …` counts and a one-line `--explain` hint; `--explain` adds the `· <statement>` lines.
- **md** — neutral output shows the finding bullets + the color-coded raw `+`/`-` diff (inline, not in `<details>`, so PR-notification emails keep the green/red — 25 lines/view/direction, capped) + a `--explain` hint. `--explain` adds the `**Structure (advisory — never blocks merge):**` statements above the raw diff and names the drift in the header (`… · structure changed on N page(s)`) so a findings-clean-but-structure-moved diff doesn't read as an all-zero "nothing changed". Structural-only pages now render (they were skipped entirely).
- **json** — additive `pages[].structural: [{ kind, view, message, role?, name?, from?, to?, position?, of?, count? }]`, **always present** regardless of `--explain` (machine surface); `schemaVersion` stays 1, `pages[].views` untouched. Key on `kind` — `message` wording may be refined in patches.

New repeatable flag `--ignore-view-line <regex>` drops matching view lines before diffing (tested against the trimmed line), so generated content that differs on every build — a "last updated" timestamp, a build hash — doesn't read as drift on every page. The a11y-diff workflow now uses it instead of filtering in the comment script, and the CLI's md output is the entire comment body.

Structural statements are advisory by construction: the exit gate never reads them.

`@real-a11y-dev/testing` newly exports the `INTERACTIVE_ROLES` set and re-exports `ROLE_FILTER_GROUPS` from `@real-a11y-dev/core`, so downstream consumers (the CLI's structural summary) share one source of truth for role classification.
