---
"@real-a11y-dev/testing": patch
---

Document a quick-start that actually reaches a passing test.

The install line was `npm install -D @real-a11y-dev/testing` and stopped there.
That package brings no test runner and no DOM, so following the docs from an
empty directory got you a dependency and no way to run anything — the two
load-bearing pieces, a runner plus `jsdom`, and `environment: "jsdom"` in the
config, were stated nowhere. The first example then used
`@testing-library/react` without saying it was optional, making the smallest
working setup look much heavier than it is.

The README (and `real-a11y.dev/packages/testing`) now carry a two-file
walkthrough — config plus one test, no framework — that goes from `npm init` to
a green run, with the exact tree it prints. Verified by following it literally
in a fresh project rather than from memory.

Also corrected: the Jest path needs `testEnvironment: "jsdom"`, and Jest does
not parse TypeScript on its own — a `.ts` test dies in the Babel parser until
`ts-jest` or `babel-jest` is added, so the transform-free quick-start is a `.js`
test. That is the kind of omission this change exists to remove, so it is
spelled out rather than implied.

A patch release so the corrected README reaches npm, which is where most people
meet this package first.
