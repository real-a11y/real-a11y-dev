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

Tagging is automatic: merging this PR runs
[`release-tag.yml`](../workflows/release-tag.yml), which tags the squash commit
once per published package (`@real-a11y-dev/<pkg>@<version>`, plus
`extension-v<version>` if the extension changed) and starts the publish
workflows. Nothing to push by hand — just confirm:

- [ ] **Publish to npm** green — check the **Publish** and **Advance latest dist-tag** steps
- [ ] Extension changed? Download the zip from the draft Release and upload it to the Chrome Web Store
