---
title: "Accessibility Snapshots"
description: Snapshot the accessibility tree — roles, names, heading outline, and tab order — as a deterministic, diff-friendly artifact. The structural counterpart to rule-based a11y audits.
---

# Accessibility Snapshots

An **accessibility snapshot** is a deterministic, human-readable capture of what assistive technology perceives on a page — roles, accessible names, heading outline, and tab order — serialized to a string you can commit and diff in code review.

```
main
  heading "Sign in" (level 1)
  form "Sign-in form"
    textbox "Email"
    button "Sign in"
```

It's the structural counterpart to rule-based audits. Where a tool like [axe](https://github.com/dequelabs/axe-core) answers *"does this violate a WCAG rule right now?"*, an accessibility snapshot answers *"what is the semantic structure — and did it change?"* For how it stacks up against axe, visual regression testing, and Playwright's ARIA snapshots, see [How Accessibility Snapshots Compare](/guide/accessibility-snapshots-comparisons).

## Why this exists

Accessibility is hard to get right. Building — and *testing* — an accessible web app demands fluency in WCAG, ARIA, and the accessible-name algorithm, plus the quirks of real screen readers, which behave differently across NVDA on Windows, VoiceOver on macOS and iOS, and TalkBack on Android. That's a steep wall, and it's a big reason teams ship accessibility bugs they never notice.

An accessibility snapshot lowers the bar. Because it shows your page exactly as assistive technology structures it — roles, names, headings, focus order — you can read it and answer the questions that matter *without* being a screen-reader expert:

- *Does this snapshot match what I think my page contains?*
- *Would this structure make sense to someone who can't see it?*
- *Is anything unlabeled, mis-roled, or out of order?*

You don't need NVDA, VoiceOver, and TalkBack open across three machines to catch a missing label or a heading that jumps from `<h1>` to `<h3>`. You read the snapshot in your editor, or in a pull-request diff. It doesn't *replace* real screen-reader testing — [more on that](/guide/accessibility-snapshots-comparisons#alongside-real-screen-reader-testing) — it moves the largest, most mechanical class of problems to where every developer already works.

## The problem with DOM snapshots

A normal `toMatchSnapshot()` on rendered HTML captures the **DOM**: every wrapper `<div>`, class name, and inline style. Two problems follow:

1. **Noise.** A purely visual refactor — renaming a class, nesting another `<div>` — churns the snapshot even though nothing a screen-reader user perceives has changed.
2. **Blind spots.** The DOM snapshot says nothing about the *accessible name* computed from `aria-labelledby`, whether headings skip a level, or what order elements receive focus.

An accessibility snapshot inverts both. It captures **only** what reaches the accessibility tree — the tree at the top of this page — so it's stable against cosmetic change and surfaces exactly the semantics that matter. Rename every wrapper class and the snapshot is byte-identical. Drop the form's `aria-label`, skip from `<h1>` to `<h3>`, or leave a button unlabeled — and it changes immediately.

## Three views, one tree

Real A11y snapshots the same tree three ways, so you pick the grain that fits the test:

| Snapshot | Captures | Catches |
|---|---|---|
| **Tree** ([`auditSnapshot`](/packages/testing/snapshots#auditsnapshot-root-options)) | Full role + name structure | Missing labels, wrong roles, structural drift |
| **Outline** ([`outlineSnapshot`](/packages/testing/snapshots#outlinesnapshot-root)) | Heading hierarchy only | Missing `<h1>`, skipped levels |
| **Tab order** ([`tabSequenceSnapshot`](/packages/testing/snapshots#tabsequencesnapshot-root)) | Focus sequence | Focus traps, illogical tab order, positive-`tabindex` surprises |

## Deterministic by construction

The same DOM always produces the same string — no timestamps, generated IDs, or ordering surprises — so `toMatchSnapshot()` is safe in CI without flakes. For genuinely dynamic content (timestamps, tokens, currency), [`redact`](/packages/testing/snapshots#using-redact) replaces the noisy bits while keeping the structure intact:

```ts
expect(
  a11ySnapshot(container, { redact: [/\d+ (minutes?|hours?) ago/] }),
).toMatchSnapshot();
```

## It models real AT behavior

Because the snapshot reflects the *extracted* accessibility tree — not raw markup — it captures semantics a DOM dump can't. The clearest example is **modal scoping**: when a dialog is open, content behind it is inert to assistive tech, so it drops out of the tree. Open a modal and the snapshot (and tab order) collapse to just the dialog — a precise artifact for that state:

```ts
await flow(container).findByRole("button", { name: "Delete account" }).click();
expect(container).toHaveTabSequence(['button "Cancel"', 'button "Delete"']);
```

## It catches what a screenshot can't

A screenshot can be pixel-perfect while the page is broken for assistive technology. Swap a real `<button>` for a `<div onclick>` styled to match: identical screenshot, gone from the accessibility tree. That regression moves **zero pixels**, so a visual snapshot sails right past it — an accessibility snapshot catches it immediately.

Visual snapshots and accessibility snapshots are the two halves of regression testing — *how it looks* and *what it means* — and neither covers the other's blind spot. [See the full comparison →](/guide/accessibility-snapshots-comparisons#versus-visual-regression-testing)

## The same tree, everywhere

An accessibility snapshot is the serialized form of the tree you can also *see* live across Real A11y's surfaces — the [Chrome extension](/guide/chrome-extension), the [React panel](/packages/react), and the [Storybook addon](/packages/storybook-addon) all render the same extraction. What you inspect by eye in the panel is what you commit as a snapshot in tests.

## Start snapshotting

- **In Vitest / Jest** → [Snapshots reference](/packages/testing/snapshots), or the ergonomic [`a11ySnapshot()` matcher](/packages/testing/matchers#a11ysnapshot-root-options-snapshot-serializer)
- **In Playwright** → [the `attach()` adapter](/packages/testing/playwright)
- **In CI** → the [CI Diff Bot recipe](/guide/ci-diff-bot) posts tree diffs on every PR
- **Comparing it to axe, visual testing, or Playwright?** → [How Accessibility Snapshots Compare](/guide/accessibility-snapshots-comparisons)
