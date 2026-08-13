---
id: R13
suite: regression
scenario: "Testing pkg — all 4 assertions + the matchers entry points, pass AND fail correctly"
area: Testing
type: Automated
priority: P0
status: Active
validFrom: "testing ≥ 0.1.0-beta.11. Exercise both matcher entry points: ./matchers and ./matchers/vitest. The engine behind these lives in `audit`, which is now PRIVATE and bundled — so assert against `@real-a11y-dev/testing` only; there is no `audit` version to pin, and importing it is the failure."
validUntil: ""
expected: "each assert* passes on good markup and throws A11yAssertionError naming the offender on bad; matchers register and read well"
twin: D5
covers:
  - packages.@real-a11y-dev/testing
  - packages.@real-a11y-dev/audit
notion: "https://app.notion.com/p/3aa1c354b0b581a18eb8e2d4266bbc66"
---

## Steps

For each of the four assertions, run it **twice** — once on markup that should pass,
once on markup that should fail:

| Assertion                        | Fails on                                                       |
| -------------------------------- | -------------------------------------------------------------- |
| `assertNoUnlabeledInteractive`   | an icon-only `<button>`                                        |
| `assertHeadingOrder`             | a page whose first heading is `<h2>`, and one that skips h2→h4 |
| `assertDialogsLabeled`           | `role="dialog"` with no accessible name                         |
| `assertLandmarkStructure`        | no `<main>`, and two `<main>`s                                  |

1. Each assertion on good markup
2. Each assertion on bad markup — read the **message**, not just the throw
3. `assertRules(root, [...])` with a rule subset
4. Register the matchers from `@real-a11y-dev/testing/matchers` (and the
   `/matchers/vitest` entry) and exercise: `toHaveNoUnlabeledInteractive`,
   `toHaveValidLandmarks`, `toHaveValidHeadingOrder`, `toHaveLabeledDialogs`,
   `toHaveTabSequence`. The remaining two — `toBeValidA11yTree` and
   `toMatchA11yContract` — are **R34**, which is where their behaviour lives;
   here just confirm all seven register
5. Each matcher **negated** (`.not`) on markup where that reads true
6. Feed a matcher something that isn't an element — then feed the **same** value
   to the bare `assert*` function behind it, and compare. That gap is **R33**
7. Read a failure message as if you'd never seen the codebase
8. `assertNoUnlabeledInteractive` on the three icon-button shapes that ship in
   real products: an `<svg>` child, a glyph or emoji as the button's text
   (`⬇`, `🗑`), and `title=` with no other name

## Expected

- **1** — passes silently
- **2** — throws `A11yAssertionError` **naming the offending element** — role, tag,
  and locator. "Assertion failed" is a failure of this test even though the
  assertion technically fired
- **4** — all register and pass/fail correctly under both Vitest and Jest
- **5** — negation reports sensibly; a matcher that only works positively is
  half-built
- **6** — throws on bad input rather than silently passing. A matcher that quietly
  accepts `undefined` reports every page as clean. The matcher half of this
  always passed; the `assert*` half did not until the release after
  0.1.0-beta.15, which is the whole reason R33 exists — both halves reject now
- **7** — the message says what's wrong, where, and ideally what to do. These are
  read by people who did not write the rule
- **8** — the `<svg>` case is caught. The glyph and `title=` cases are **not**,
  and both are correct per accname: `⬇` is a non-empty name, and `title` is the
  last-resort name source. Record the verdict rather than assuming it — the
  table above says this assertion "fails on an icon-only `<button>`", and for
  the most common icon-only shape in real products it does not

## Why this exists

An assertion library's failure message _is_ its product — the pass path is trivially
right and tells nobody anything. Step 2 is the real test.

Step 6 guards the worst outcome available here: a matcher that accepts junk and
passes turns an entire suite into decoration, and it does so silently and
permanently.
