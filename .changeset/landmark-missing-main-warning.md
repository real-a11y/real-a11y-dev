---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

The `landmark-structure` rule now reports a page with no `main` landmark as a `warning`, not an `error`. No spec requires a `main` landmark (WAI-ARIA 1.2 only says to mark no more than one, and axe treats it as best practice), so `real-a11y audit` no longer exits 1 by default for that alone; use `--fail-on warning` to keep the old gate. The message now reads `Missing <main>: a page should have one main landmark.` and the SARIF rule default is `warning`. `assertLandmarkStructure` still throws on a missing `main`. A saved snapshot taken before this change will show `severity error → warning` and the reworded message for this finding in `real-a11y diff`; the finding keeps its identity, so existing baselines still match.
