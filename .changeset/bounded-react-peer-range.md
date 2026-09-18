---
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
---

Bound the `react` / `react-dom` peer ranges to the majors these packages are built against: `^18.0.0 || ^19.0.0`, previously `>=18`.

`>=18` accepted React 20 and every major after it sight unseen. A consumer landing on such a major would have installed cleanly and met the breakage later, as a runtime fault or a type error with nothing at install time pointing at the cause. The bounded range makes it fail the peer check instead — an `ERESOLVE` error on npm, a warning on pnpm and Yarn — naming the version that isn't supported.

**No effect on any React release that exists today.** React's newest published major is 19, and neither range matches a pre-release (semver only matches a prerelease when a comparator shares its exact version tuple), so `>=18` and `^18.0.0 || ^19.0.0` resolve identically for every version on npm — including canaries and RCs. The two diverge only at `20.0.0`. Nothing to migrate.

This brings both packages in line with every other peer the suite publishes (`playwright: ">=1.49.0 <2"`, `@jest/expect: ">=29 <31"`, storybook `^8.0.0`), and `scripts/react-peer-range.test.mjs` now holds the two manifests to one range so they cannot diverge from it — or from each other — without an edit that says so.
