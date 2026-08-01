---
id: D5
suite: dogfood
scenario: "Testing package from npm in a fresh vitest + Playwright project"
area: Testing
type: Automated
priority: P0
status: Active
validFrom: "testing ≥ 0.1.0-beta.11 from the registry on the `beta` tag. Follow only the published docs — gaps you have to fill from memory ARE the finding"
validUntil: ""
expected: "a brand-new project can install, follow the docs, and get a passing a11y test against real-a11y.dev in minutes"
twin:
  - R12
  - R13
  - R15
covers:
  - packages.@real-a11y-dev/testing
notion: "https://app.notion.com/p/3aa1c354b0b5816e80fbe1e24385353b"
---

## Steps

Start from **nothing** — a fresh directory, following only the published docs. Do not consult
the monorepo; if a step is missing from the docs, that is the finding.

1. `npm init -y`, install vitest + playwright + `@real-a11y-dev/testing@beta`
2. Follow the quick-start on real-a11y.dev exactly as written
3. Write one test asserting something about `https://real-a11y.dev`
4. Run it
5. Add a snapshot assertion; run twice — confirm it's stable
6. Add a failing assertion deliberately; read the message
7. Do the same in a **Jest** project, using the `/matchers` entry
8. Time the whole thing from empty directory to green test

## Expected

- Every documented step works as written, against the **just-published** versions
- A brand-new project reaches a passing a11y test in **minutes**, not an afternoon
- Snapshots are stable across runs
- The deliberate failure produces a message that names the offending element — someone new to
  the library should be able to act on it without reading source
- Jest works as well as Vitest

## Why this exists

This is the adoption path. Everything else in both suites tests whether the code works; this
tests whether a stranger can _get it working_ from the docs alone — which is the only version of
"works" that grows usage.

Two rules make it meaningful:

- **Don't fill gaps from memory.** If the docs omit a peer dependency or a config line, note it
  rather than working around it. Working around it is precisely how a broken quick-start survives
  release after release — the only people who run it already know the answer.
- **Time it** (8). "It works eventually" and "it works in five minutes" are different products,
  and the second one is the claim the docs make.
