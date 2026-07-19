# @real-a11y-dev/snapshot

The Real A11y **snapshot engine** — deterministic finding fingerprints, the diffable `a11y-snapshot.json` artifact, the findings/views/unified diff, and baselines. Node-only, pure data. It depends on nothing but [`@real-a11y-dev/audit`](https://real-a11y.dev/packages/audit) and [`@real-a11y-dev/core`](https://real-a11y.dev/packages/core).

```sh
npm install @real-a11y-dev/snapshot
```

This is the single place a Real A11y snapshot is built and compared, so a snapshot captured by the CLI and diffed by the MCP server (or vice-versa) is byte-for-byte identical. Most people use it through the `real-a11y` CLI or the MCP server; install it directly to build or diff snapshots programmatically — a CI action, a GitHub App, a dashboard — without a browser or a test runner.

## Fingerprints

`fingerprintFindings` assigns each finding a stable `v1:` id derived from its identity (rule + role + locator + normalized message), so the same problem keeps the same id across runs and across tools:

```ts
import { fingerprintFindings } from "@real-a11y-dev/snapshot";

const withIds = fingerprintFindings(findings);
// [{ ...finding, fingerprint: "v1:9c2f…" }, …]
```

The `v1:` scheme is frozen — improvements ship as `v2:` alongside it, never by mutating `v1:` — so a baseline recorded months ago still matches today.

## Artifact

`buildArtifact` produces the diffable `a11y-snapshot.json`; `parseSnapshotArtifact` reads one back, throwing `SnapshotFormatError` on malformed input:

```ts
import {
  buildArtifact,
  serializeArtifact,
  parseSnapshotArtifact,
  SnapshotFormatError,
} from "@real-a11y-dev/snapshot";

const artifact = buildArtifact(pages, { toolName: "my-tool", toolVersion: "1.0.0" });
const json = serializeArtifact(artifact); // deterministic, stable key order

try {
  const parsed = parseSnapshotArtifact(json);
} catch (err) {
  if (err instanceof SnapshotFormatError) {
    // err.message + err.hint — present it however your surface wants.
  }
}
```

`SnapshotFormatError` is a plain domain error: the engine knows nothing about processes or exit codes. It carries an optional `hint` (a suggested remedy); the consuming surface decides how to show it — the CLI renders `real-a11y: error: <message>` and exits 2.

## Diff

Two artifacts diff along the two axes the whole toolkit is built around — **findings** (what regressed) and **views** (how the structure changed):

```ts
import { diffArtifacts, diffFindings, summarizeViews } from "@real-a11y-dev/snapshot";

const result = diffArtifacts(before, after);
// findings added/removed/unchanged (by fingerprint) + per-view structural changes
```

- `diffFindings` — fingerprint-aware set diff over findings (added / removed / carried-over).
- `diffViews` + `summarizeViews` — structural changes to the tree/outline/tab views, as plain-language statements.
- `unifiedDiff` — git-style hunks with context for the raw view text.

## Baselines

Baselines let you accept today's debt and gate only what's _new_ — a finding in the baseline doesn't fail the build:

```ts
import { loadBaseline, applyBaseline, buildBaseline } from "@real-a11y-dev/snapshot";

const baseline = loadBaseline(".a11y-baseline.json"); // throws SnapshotFormatError if malformed
const gated = applyBaseline(findings, baseline); // only findings absent from the baseline
```

The read/serialize helpers take and return data; the file writes stay with the caller, so the engine never touches the filesystem on your behalf beyond an explicit `loadBaseline`.

## Design

Everything here is **Node-only and browserless** — `node:crypto` for fingerprints, plain data structures for artifacts and diffs. The extraction that produces findings happens elsewhere (in the page, via [`@real-a11y-dev/core`](https://real-a11y.dev/packages/core) + [`@real-a11y-dev/audit`](https://real-a11y.dev/packages/audit)); this package only ever operates on the results. That split is deliberate: the snapshot engine can run anywhere Node runs, and the page bundle stays free of Node.
