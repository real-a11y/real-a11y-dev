---
---

Refactor only: `parseSnapshotArtifact` in the internal `snapshot` package normalizes each page and falls colliding back-filled page ids back to `name` in two helpers. Releases nowhere — `cli` and `mcp` carry it, and no behaviour changes in either.
