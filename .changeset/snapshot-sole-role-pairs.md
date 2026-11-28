---
---

Refactor only: `summarizeViews` in the internal `snapshot` package finds its 1:1 tab-stop and landmark rename candidates through one helper instead of two copies of the same pairing loop. Releases nowhere — `cli` and `mcp` carry it, and no behaviour changes in either.
