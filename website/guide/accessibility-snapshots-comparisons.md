---
title: "How Accessibility Snapshots Compare"
description: How accessibility snapshots relate to visual regression testing, rule engines like axe, Playwright's ARIA snapshots, and real screen-reader testing — what each catches, and why they compose rather than compete.
---

# How Accessibility Snapshots Compare

An [accessibility snapshot](/guide/accessibility-snapshots) doesn't replace your other accessibility and regression tools — it sits beside them and covers a blind spot each of them has. This page walks through the four it's most often confused with, and where the lines fall.

The throughline is **jsdom**. Because Real A11y computes its own accessibility tree, the *same* snapshot runs in a millisecond-fast Vitest/Jest unit test **and** in a real browser. The other tools below either need a real browser to read its native accessibility tree, or answer a different question entirely.

## Versus visual regression testing

Screenshot testing — Playwright's `toHaveScreenshot()`, or services like Percy, Chromatic, and Argos — is the other great snapshot discipline, and it's genuinely complementary. A visual snapshot renders the page to pixels and diffs the image: when a layout shifts, a color regresses, or a component visually breaks, the diff lights up the exact region and you spot it instantly. For *appearance*, nothing beats it.

But pixels only describe what a sighted, mouse-using visitor sees. A screenshot can be pixel-perfect while the page is broken for assistive technology — and those failures move **zero pixels**:

- A real `<button>` swapped for a `<div onclick>` styled to match — identical screenshot, gone from the a11y tree.
- An icon button that lost its `aria-label` — looks the same, now announces nothing.
- A heading restyled into a plain `<span>` — same font size on screen, vanished from the outline.
- Focus order rearranged by a layout change — visually unchanged, keyboard path now illogical.

None of these show up in a screenshot diff. Every one shows up in an accessibility-snapshot diff. The reverse holds too: a purely visual regression — a broken gradient, an overlapping panel, a spacing bug — won't move an accessibility snapshot.

So they're the two halves of regression testing: **how it looks** and **what it means**. A mature suite runs both — visual snapshots for appearance, accessibility snapshots for semantics — and neither one covers the other's blind spot.

## Versus rule engines like axe

Accessibility snapshots and rule engines like [jest-axe](https://github.com/nickcolley/jest-axe) answer **different questions**, and a healthy suite runs both:

| Aspect | Rule engine (e.g. jest-axe) | Accessibility Snapshot |
|---|---|---|
| Question | "Does this violate a WCAG rule?" | "What is the structure, and did it change?" |
| Output | A pass/fail list of violations | A reviewable, diffable artifact |
| Great at | Color contrast, ARIA validity, breadth of rules | Structure, focus order, regressions over time |
| Blind to | Structural drift between commits; tab-order changes | The dozens of rules an engine encodes |

Run `toHaveNoViolations()` for rule compliance and an accessibility snapshot for structural regression. Neither subsumes the other — which is why the [matchers](/packages/testing/matchers) are designed to sit in the same suite as jest-axe, not replace it.

## Versus Playwright ARIA snapshots

The idea owes a direct debt to [Playwright's ARIA snapshots](https://playwright.dev/docs/aria-snapshots) (`expect(page).toMatchAriaSnapshot()`), which serialize the accessibility tree to YAML and popularized snapshotting *structure* instead of markup. If your tests already run in a real browser through Playwright, it's an excellent first-party tool — reach for it.

Real A11y takes the same idea somewhere Playwright structurally can't, and frames it explicitly as an audit:

| Aspect | Playwright ARIA snapshots | Real A11y accessibility snapshots |
|---|---|---|
| Runs in | A real browser (reads the browser's own accessibility tree) | **jsdom and a real browser** — no browser needed for unit tests |
| Test runners | Playwright | Vitest, Jest (jsdom) + a Playwright adapter |
| Engine | The browser's native AX tree | Real A11y's own extraction — the same tree the [extension](/guide/chrome-extension), [React panel](/packages/react), and [Storybook addon](/packages/storybook-addon) render |
| Views | Role + name tree | Tree **+** [heading outline](/packages/testing/snapshots#outlinesnapshot-root) **+** [tab order](/packages/testing/snapshots#tabsequencesnapshot-root) |
| Framing | A stable alternative to DOM / visual snapshots | An accessibility audit, paired with [assertions](/packages/testing/assertions) and [matchers](/packages/testing/matchers) |

The practical wedge is jsdom. jsdom has no accessibility tree, so a snapshot built on the browser's AX tree simply can't run in a Vitest or Jest unit test. Because Real A11y computes its own tree, the *same* snapshot runs in a millisecond-fast unit test and in a real-browser E2E run — and matches what you inspect by eye in the panel.

> Historical note: "accessibility snapshot" has lineage in Playwright and Puppeteer's older `page.accessibility.snapshot()` (a JSON AX-tree dump), which Playwright deprecated long ago and removed in v1.49, in favor of the YAML ARIA snapshots above.

## Alongside real screen-reader testing

::: tip This complements real screen-reader testing — it doesn't replace it
Nothing substitutes for hearing your app announced; lived AT experience catches things structure alone can't. What snapshots do is move the first and largest class of problems — *structural* ones — to where every developer already works: a diff in code review. Deep expertise becomes a way to go further, not the price of entry.
:::

## Next

- New to the concept? → [Accessibility Snapshots](/guide/accessibility-snapshots)
- Ready to write one? → [Snapshots reference](/packages/testing/snapshots) · [matchers](/packages/testing/matchers) · [Playwright adapter](/packages/testing/playwright)
- In CI → the [CI Diff Bot recipe](/guide/ci-diff-bot) posts tree diffs on every PR
