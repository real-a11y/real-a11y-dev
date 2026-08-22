---
"@real-a11y-dev/cli": patch
---

Stop claiming the `latest` dist-tag is unpublished.

The README and website Prerequisites said an unpinned `@real-a11y-dev/cli`
resolves `latest` and fails with "No matching version found." Both `latest` and
`beta` have pointed at the current prerelease since D1's pre-mode rule — measured
on 0.1.0-beta.5. Pinning `@beta` is still the right advice; saying the tag does
not exist is not.
