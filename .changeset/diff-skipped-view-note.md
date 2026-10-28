---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

`real-a11y diff` now gives the right advice when it skips a view. Every diff of two current snapshots ended with "Not compared: the tabs view — at least one snapshot didn't measure it (re-capture both sides with the same version to compare it again)", but `snapshot` never captures tab order, so re-capturing changes nothing. The note now tells the two cases apart:

- **Neither side measured it**, which is every pair of current snapshots: "Not compared: the tabs view — `real-a11y snapshot` doesn't capture tab order, so neither side has one (check it with `real-a11y tabs <url>`)."
- **Only one side measured it**, such as an older artifact that carries a tabs view against a current one: "Not compared: the tabs view — only the base snapshot measured it (re-capture both sides with the same version so they measure the same views)."

The `pretty` and `md` formats both change. `--format json` is unchanged: `skippedViews` still lists the skipped views. `mcp` re-releases the bundled diff engine; its output is unchanged by this release.
