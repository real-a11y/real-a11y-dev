---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
"@real-a11y-dev/testing": minor
---

Stop publishing `@real-a11y-dev/audit`, `@real-a11y-dev/serialize` and `@real-a11y-dev/snapshot`; they are internal now.

They were on npm because the workspace grew that way, not because anyone chose them as products. None had a documentation page, and nothing on the website recommended installing one. Together they were 95 of the 295 modelled exported symbols.

**Nothing changes for you unless you imported one directly.** They move from `dependencies` to `devDependencies` and are bundled into the packages that use them, so `browser`, `cli`, `mcp` and `testing` install fewer packages, not more.

If you did import one directly:

- `@real-a11y-dev/audit` (last published `0.1.0-beta.12`) → `@real-a11y-dev/testing` re-exports `Finding`, `A11yRule`, `ALL_RULES`, `collectFindings` and the `assert*` primitives. That is the only published home for them — `mcp` names `Finding` in its own signatures but does not re-export it.
- `@real-a11y-dev/serialize` (last published `0.1.0-beta.12`) → `@real-a11y-dev/testing` re-exports `extract`, `SerializeOptions`, and the `auditSnapshot` / `outlineSnapshot` / `tabSequenceSnapshot` serializers.
- `@real-a11y-dev/snapshot` (last published `0.1.0-beta.12`) → **there is no drop-in replacement.** The snapshot engine — fingerprints, the diffable `a11y-snapshot.json`, baselines — is now reachable only through the `real-a11y` CLI. `real-a11y snapshot` and `real-a11y diff` take `--format json` and write with `-o`, which is the supported way to drive it from a script or CI. `@real-a11y-dev/mcp` exposes the same engine as MCP tools.

Every consumer pairs `noExternal` with `dts.resolve`, so no shipped `.d.ts` names a package npm cannot resolve — `surface:check` fails if that regresses, and the packed tarballs were checked directly.
