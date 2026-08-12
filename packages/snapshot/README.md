# @real-a11y-dev/snapshot

The Real A11y **snapshot engine** — deterministic finding fingerprints, the diffable `a11y-snapshot.json` artifact, the findings/views/unified diff, and baselines. Node-only, pure data. It depends on nothing but [`@real-a11y-dev/audit`](../audit), [`@real-a11y-dev/serialize`](../serialize), and [`@real-a11y-dev/core`](../core).

> **Internal package — not published to npm.** It is bundled into the
> `real-a11y` CLI and the MCP server, the only two surfaces this engine reaches
> you through. There is nothing to install and nothing to import by this name.
> The examples below are written from inside the workspace, for anyone working
> on the engine itself.
>
> It was published up to `0.1.0-beta.12` before becoming internal, and unlike
> the other internal engines it has **no drop-in replacement** — nothing
> published re-exports `buildArtifact`, `diffArtifacts`, `fingerprintFindings`,
> the baseline helpers, or any other symbol here. The route is the CLI:
> `real-a11y snapshot` writes the artifact and `real-a11y diff` compares two,
> both taking `--format json` and `-o <file>`, so a CI action, a GitHub App or a
> dashboard shells out and reads JSON instead of importing. For an agent, the
> MCP `checkpoint_findings` / `diff_findings` / `export_checkpoint` tools cover
> the same ground — `export_checkpoint` returns this exact artifact.

This is the single place a Real A11y snapshot is built and compared, so a snapshot captured by the CLI and diffed by the MCP server (or vice-versa) is byte-for-byte identical.

## Fingerprints

`fingerprintFindings` assigns each finding a stable `v1:` id derived from its identity (the page it was found on + rule + role + locator + normalized message), so the same problem keeps the same id across runs and across tools:

```ts
import { fingerprintFindings, pageIdOf } from "@real-a11y-dev/snapshot";

const withIds = fingerprintFindings(pageIdOf("https://example.com/pricing"), findings);
// [{ ...finding, fingerprint: "v1:9c2f…" }, …]
```

The first argument is the **page's identity**, not its display name — see [Page identity](#page-identity). Passing a label here makes the fingerprint change when the label does, which is the defect that field exists to prevent.

The `v1:` scheme is frozen — improvements ship as `v2:` alongside it, never by mutating `v1:` — so a baseline recorded months ago still matches today.

## Page identity

A page has an `id` (what it **is**) and a `name` (what you **call** it). Only the first one joins:

| field  | job                                              | default                 |
| ------ | ------------------------------------------------ | ----------------------- |
| `id`   | join key — diffs, baselines, fingerprints        | the URL's path + search |
| `name` | display label, free to change                    | the redacted URL        |
| `url`  | where it was captured                            | —                       |

`pageIdOf` derives one from a URL: path + search + hash, **origin dropped**, one trailing slash stripped. So the same route on `localhost:3000`, `localhost:3001` and prod is one page — base and PR pair up without you keeping two labels character-identical by hand — while `/pricing` and `/careers` never merge. It returns `undefined` for anything unparseable rather than inventing an id, because a made-up id silently joins two unrelated pages.

These were one field until recently, and the join key was the label, so renaming a page for readability un-suppressed its baseline. If you build pages by hand, `buildArtifact` refuses two that share an id — naming both URLs and the fix. Blending two pages' findings is the one failure here that is invisible afterwards, so it is a hard error rather than a warning.

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

Entries are bucketed by the page's **id**, so accepted debt survives a rename and follows the page across environments.

`BASELINE_SCHEMA_VERSION` is `2`. `loadBaseline` refuses a version-1 file by name, with the command that re-records it: those entries key on the display label, and mapping a label to a page id means guessing — a wrong guess silently suppresses a real finding, which is worse than the error. Artifacts have no such problem; `parseSnapshotArtifact` back-fills a missing `id` from the page's `url`, so an older artifact stays readable.

The read/serialize helpers take and return data; the file writes stay with the caller, so the engine never touches the filesystem on your behalf beyond an explicit `loadBaseline`.

## Design

Everything here is **Node-only and browserless** — `node:crypto` for fingerprints, plain data structures for artifacts and diffs. The extraction that produces findings happens elsewhere (in the page, via [`@real-a11y-dev/core`](../core) + [`@real-a11y-dev/audit`](../audit)); this package only ever operates on the results. That split is deliberate: the snapshot engine can run anywhere Node runs, and the page bundle stays free of Node.
