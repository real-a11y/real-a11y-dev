---
title: "Accessibility-Driven Testing"
description: Let the accessibility tree drive your test suite — structural assertions and diffable snapshots of what assistive tech perceives, running in jsdom and a real browser, on every PR.
---

# Accessibility-Driven Testing

Test-driven development treats a failing test as a contract. **Accessibility-Driven Testing** treats the **accessibility tree** the same way: the roles, names, heading outline, and focus order your users perceive become a first-class artifact your suite asserts on — and a regression in it fails the build like any other.

## The gap it closes

Look at the accessibility tools a mature team already runs, and there's a hole in the middle:

- **Rule engines** (axe, jest-axe) answer *"does this violate a WCAG rule right now?"* — they don't answer *"did the structure change?"* A button that lost its label, a heading outline that skipped a level, a new focus trap — none are rule violations, and all sail straight through.
- **DOM and visual snapshots** miss semantics entirely. A real `<button>` swapped for a styled `<div>` moves **zero pixels** and doesn't dent a screenshot — but it's gone from the accessibility tree.
- **Manual screen-reader testing** catches these, but it **doesn't run in CI**. Nothing stops the regression from landing between audits.

Accessibility-Driven Testing fills that middle: it makes *structure* a thing your pipeline checks automatically.

## Two ways to pin the tree

[`@real-a11y-dev/testing`](/packages/testing) gives you two complementary modes:

- **Snapshots — catch regressions.** [`auditSnapshot`](/packages/testing/snapshots) / `outlineSnapshot` / `tabSequenceSnapshot` serialize the tree to a deterministic string you commit and diff in review. Rename a wrapper class and it's byte-identical; drop a label or skip a heading and it changes immediately. (The concept, in depth: [Accessibility Snapshots](/guide/accessibility-snapshots).)
- **Assertions — enforce invariants.** [`assertNoUnlabeledInteractive`](/packages/testing/assertions), `assertHeadingOrder`, `assertDialogsLabeled`, … throw descriptive errors on broken structure. Prefer `expect` style? The same checks ship as [matchers](/packages/testing/matchers): `toHaveNoUnlabeledInteractive()`, `toHaveValidHeadingOrder()`, `toHaveTabSequence([...])`.

For flows, [`flow()`](/packages/testing/flow) asserts about the tree *after* an interaction — open a menu, submit a form — so you can lock in behavior like modal scoping and focus traps, not just static markup.

## It runs where your tests already run

The distinctive part: the same tree computes in **jsdom** — a millisecond-fast Vitest/Jest unit test, no browser — **and** in a real browser via the [Playwright adapter](/packages/testing/playwright) (`attach(page)`). One format, from the fastest unit test to full E2E.

```ts
// unit (jsdom)
render(<LoginForm />);
expect(container).toHaveNoUnlabeledInteractive();
expect(a11ySnapshot(container)).toMatchSnapshot();

// e2e (real browser)
const sn = await attach(page);
await sn.assertHeadingOrder();
expect(await sn.auditSnapshot()).toMatchSnapshot();
```

On every PR, the [CI diff bot](/guide/ci-diff-bot) posts the tree diff as a comment — so a change to what assistive tech perceives is as visible in review as a change to any other file.

## It composes — it doesn't replace

Run `toHaveNoViolations()` for rule compliance, an accessibility snapshot for structural regression, and a real screen reader before you ship. Accessibility-Driven Testing owns exactly one slice — *structure, and whether it changed over time* — and it's the slice nothing else in CI was watching. None of these subsumes the others.

## Closing the loop

Because it's one engine, the tree is the same everywhere it appears. A QA teammate can [copy the tree](/guide/chrome-extension) straight from the Chrome extension and paste it into a bug — and that paste is byte-identical to `auditSnapshot()`, so a developer drops it straight into a `toMatchSnapshot()` fixture. Inspect in dev, report from the extension, assert in CI — one artifact, end to end. Which is the other half of the practice: [**Accessibility-Driven Development**](/concepts/accessibility-driven-development).

## Start here

- [Snapshots](/packages/testing/snapshots) · [Assertions](/packages/testing/assertions) · [Matchers](/packages/testing/matchers) · [Flow](/packages/testing/flow) · [Playwright](/packages/testing/playwright)
- [CI Diff Bot recipe](/guide/ci-diff-bot) — tree diffs on every PR
