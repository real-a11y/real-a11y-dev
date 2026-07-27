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

Targeting, acting, and the diff all read the same tree — Chromium's own, over CDP — so a node you aim at by one name can't come back in the report under another. That tree is whole-document, so these commands take neither `--producer` nor `--root`, rather than accepting flags they'd ignore. A step that loads a new document (a navigation, or a reload) leaves the captured tree describing a page that no longer exists; the run reports that, says where it landed, and still exits `0`.

Each step gets `--step-settle` (default 200ms) to land before the next one resolves its target and before the diff is taken — a React state update flushes on a later tick, a dialog mounts on the next frame, and an immediate read reports "no changes" for a click that plainly did something. It is a heuristic wait, not a synchronisation point: nothing can tell you a page is _about_ to navigate, so a slower reaction still needs a larger number. `0` opts out; `stepSettleMs` sets it project-wide.

A typed value is never echoed — not in progress output, not in `--format json`, where the step renders as `= ‹hidden›`. There is deliberately no credential workflow here: a password on the command line is visible to other processes and lands in shell history, so `real-a11y login` remains the way to authenticate.

The JSON envelope gains three additive optional fields on a page: `steps` (rendered, redacted), `diff`, and `navigated` — the last so a consumer can tell that a step loaded a new document (so there is no diff) without string-matching the diff prose. `url` is re-read after the steps run, so it reports where the page LANDED rather than where the run opened it. Chromium only.
