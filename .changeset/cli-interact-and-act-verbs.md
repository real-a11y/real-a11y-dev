---
"@real-a11y-dev/cli": minor
---

`real-a11y interact` — drive a page, then see what it changed for a screen reader. Plus one-step sugar verbs `click`, `type`, and `focus`.

A page audited as it loads never shows the dialog, the expanded menu, or the validation error. `interact` runs steps against a live page and prints the accessibility-tree diff they produced:

```sh
real-a11y interact http://localhost:3000 --step 'click button "Open menu"'
# + link "Alpha"
# + navigation "Main"
# ~ button "Open menu": a11y.states.expanded false → true
# ~ main: childIds 1 child → 2 children
```

Steps are written in the vocabulary the tree already prints — `<verb> <role> ["<name>"] [nth=<n>] [= <text>]`, verbs `click | type | focus` — so a line of `real-a11y tree` output is nearly a step already. `--step` is repeatable and ordered, stopping at the first failure. Omit the name to match any; pass `""` to target the unlabeled control an audit just flagged. The one-step cases have sugar: `real-a11y click <url> --role button --name "Save" --nth 2`, and likewise `type` (with `--text`) and `focus`.

Targeting is **role + accessible name only**, resolved against Chromium's own accessibility tree immediately before each dispatch — never a CSS selector, and no node id ever reaches the command line. If a control can't be reached that way, assistive technology can't reach it either, and that is surfaced as the accessibility finding it is. Ambiguous matches list their copy-paste `nth=` candidates; a disabled target is refused with the cause, because a swallowed click plus an empty diff reads as "that button does nothing" rather than "you can't click it".

Two producers are in play by design: acting is native (CDP, whole-document), while the diff is the in-page DOM walk — which is what `--root` scopes. These commands therefore take no `--producer` at all, rather than accepting one they'd ignore. A step that navigates discards the in-page checkpoint; the run reports that and still exits `0`.

A typed value is never echoed — not in progress output, not in `--format json`, where the step renders as `= ‹hidden›`. There is deliberately no credential workflow here: a password on the command line is visible to other processes and lands in shell history, so `real-a11y login` remains the way to authenticate.

The JSON envelope gains three additive optional fields on a page: `steps` (rendered, redacted), `diff`, and `navigated` — the last so a consumer can tell that a step navigated (which discards the tree checkpoint) without string-matching the diff prose. `url` is re-read after the steps run, so it reports where the page LANDED rather than where the run opened it. Chromium only.
