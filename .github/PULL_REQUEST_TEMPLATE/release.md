<!-- Release PR — open with: gh pr create --template release.md -->

## Summary

<!-- What this release ships, in a sentence or two. -->

## Version bumps

| Package | From | To  | Why |
| ------- | ---- | --- | --- |
|         |      |     |     |

## Changesets consumed

<!-- The changesets folded into this release. In pre mode they stay on disk
     (recorded in pre.json) until `changeset pre exit`. -->

## Mechanical notes

<!-- Anything non-obvious: dependency cascades, the pre-mode counter, manual
     version bumps, packages intentionally left unbumped. -->

## Verify

- [ ] `pnpm verify` green
- [ ] `pnpm packaging:check` green (publint + attw)

## After merge

- [ ] Tag `vX.Y.Z-beta.N` at the squash commit → the Publish workflow publishes and advances `latest`
- [ ] Extension changed? also tag `extension-vX.Y.Z`
