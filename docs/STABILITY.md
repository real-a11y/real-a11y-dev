# API stability policy

This is a beta-version (`0.1.x`) library. The public surface is approaching final shape, but minor breaking changes will still happen before `0.2.0` and again before `1.0.0`. This document is the contract those changes follow.

## Versioning

Real A11y follows [Semantic Versioning](https://semver.org/), with the **0.x exception** every pre-1.0 library uses:

| Bump | What it means |
|---|---|
| `0.x.Y` (patch) | Bug fixes, internal refactors, doc-only changes. Safe to upgrade. |
| `0.X.0` (minor) | **May contain breaking changes.** New features, deprecation removals, or small contract breaks land here. Read the CHANGELOG before upgrading. |
| `1.0.0` (major) | Future. Marks the point where breaking changes require a major bump per standard SemVer. |

All `@real-a11y-dev/*` packages are linked: they bump together so consumers see one version across the suite. See [.changeset/README.md](../.changeset/README.md).

## Public vs. internal API

**Public** — anything exported from a package's `dist/index.{js,d.ts}` (or a documented sub-entry like `@real-a11y-dev/testing/playwright`). Typed by the published `.d.ts`. Covered by the version contract above.

**Internal** — exports tagged `@internal` in their JSDoc, exports that aren't re-exported from a package's index, and anything reachable only by deep-importing a `dist/<file>.js` we don't list in the package's `exports` map. **No stability promise.** Internal symbols may change in any release, including patch versions, without a CHANGELOG note.

If a refactor accidentally leaves an internal symbol reachable through an entry point, treating it as public is at your own risk — we'll close it back up the next time we touch the file.

## Deprecation policy

When a public API needs to go away, we deprecate it with two markers:

1. JSDoc `@deprecated` on the symbol, explaining what to use instead.
2. A note in the CHANGELOG of the release that introduces the deprecation.

Deprecated APIs are kept working for at least the next minor (e.g. deprecated in `0.2.0` → still works through all `0.2.x` → may be removed in `0.3.0`). Removals always coincide with a minor bump.

## Beta → stable promotion criteria

Each package promotes from `0.1.x-beta.*` to `0.1.x` (and eventually `1.0.0`) when:

- Its public API has been stable for two consecutive minor releases.
- It has a documented test coverage floor (target: 80% of public exports exercised).
- Real-world consumers have run it for at least 30 days without reporting an interface bug.
- The package's README and any `homepage_url` reference match the shipped behaviour.

The Chrome extension follows its own release train (Chrome Web Store cadence) and is not part of the npm version contract.

## How to break things on purpose

If you have to make a breaking change to a public API:

1. Open an issue with the proposal first if it's non-trivial — let the design get reviewed before code lands.
2. In the PR, include a Changeset (`pnpm changeset`) with `minor` bump and a "Breaking change" section in its body explaining the migration path.
3. If a deprecation path exists (you can keep the old API working alongside the new one), prefer that for at least one minor.

## Reporting an unstable public API

If you depend on something marked `@internal` or reachable only through a deep import, please open an issue. We'd rather promote a useful symbol to public than have you build on a moving target.
