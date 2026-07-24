---
"@real-a11y-dev/testing": patch
---

Make `flow()` failure messages actionable instead of dead ends.

- **`findByRole` misses now dump the current tree.** A miss used to say only `no node with role "button" and name … found in document.` — no clue what _is_ there. It now appends the serialized tree (the same view `expectTree` compares against), so you can see the roles and names that exist and correct the query, the way testing-library's `getByRole` dumps the available roles.
- **`expectTree` / `expectChanges` point at the first differing line.** A snapshot mismatch printed the full expected and actual blocks back-to-back, leaving you to eyeball-diff two 60-line dumps. The message now leads with `First difference at line N:` plus a couple of lines of context and a `- expected` / `+ actual` marker, then still includes the full blocks for copy-paste snapshot updates.

Failure-path message text only — no exported symbol, type, or signature changes, and the new output is produced solely when an assertion was already going to throw.
