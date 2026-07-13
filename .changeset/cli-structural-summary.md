---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/testing": minor
---

`diff` now shows structural drift as a **real unified diff** — context lines, order, and indentation, like a PR file diff — so a reviewer can see _where_ in the tree a change happened, not just a bare list of added/removed lines. Shown in full by default:

````text
#### home
```diff
@@ -3,7 +3,8 @@
     link "About"
-    button "Toggle theme"
+    button "Switch to dark mode"
   main
+    complementary "Semantic Navigator"
```
````

Add **`--explain`** for an opt-in plain-language summary on top — statements a non-expert can act on. The default stays **neutral** (findings + the unified diff, both facts); `--explain` is the interpretive layer (pairing heuristics, cross-view inference), so the default never makes a claim the diff can't back up:

```text
· Heading level changed: "Setup" h2 → h3
· Keyboard tab stop added: link "Skip" (now stop 2 of 14)
```

The taxonomy covers what assistive-tech users feel: landmarks added/removed/renamed (removing `main` calls out broken skip-links), heading level changes and renames, keyboard tab stops added/removed with their position — including the dangerous variant where the element is **still on the page but no longer keyboard-focusable** — interactive elements outside the tab order, and **pure reorders** of the tab order or heading outline. Anything unrecognized degrades to one honest `Other content changed` rollup — never silence. Rename/level pairings are count-aware and strictly 1:1; ambiguity degrades to add/remove, so the summary never guesses.

New flags for CI comments (default: full):

- **`--max-lines <n>`** — cap each page's structural diff to _n_ lines, then `… N more`.
- **`--max-pages <n>`** — detail the first _n_ changed routes; list the rest.
- **`--ignore-view-line <regex>`** (repeatable) — drop volatile lines (a "last updated" timestamp, a build hash) before diffing.

Where it lands:

- **pretty** — a colored unified diff per changed page; `--explain` adds the `· <statement>` lines; a one-line `--explain` hint otherwise.
- **md** — a route index (`Pages with a11y changes (N): …`), findings, then (under `--explain`) statements, then the color-coded ` ```diff ` hunks — inline, not in `<details>`, so PR-notification emails keep the green/red. The header names the drift (`… · structure changed on N page(s)`) so a findings-clean-but-structure-moved diff doesn't read as an all-zero "nothing changed".
- **json** — additive `pages[].structural: [{ kind, view, message, … }]` and `pages[].structuralDiff` (a boolean: does the unified diff have any hunk — the honest "structure changed" signal, since `structural` misses a pure tree reorder), always present regardless of the flags (machine surface); `schemaVersion` stays 1, `pages[].views` untouched.

The a11y-diff workflow prints the **full uncapped diff to the job log** and posts a capped comment (`--max-pages 5 --max-lines 20`) that links back to it, so the complete diff is always one click away.

Structural output is advisory by construction: the exit gate never reads it.

`@real-a11y-dev/testing` newly exports the `INTERACTIVE_ROLES` set and re-exports `ROLE_FILTER_GROUPS` from `@real-a11y-dev/core`, so the CLI's structural summary shares one source of truth for role classification.
