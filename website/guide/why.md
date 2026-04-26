---
title: Why Real A11y? — positioning vs axe-core and Testing Library
description: Where Real A11y fits between rule-checkers and element-queriers. Honest trade-offs, design principles, and how to use it alongside axe and Testing Library.
---

# Why Real A11y?

Existing accessibility tools check rules. Real A11y checks experience.

## The gap

**axe-core** and similar rule engines are excellent for catching violations — missing labels, invalid ARIA, color contrast failures. They tell you when something is broken.

But they don't tell you:

- What does a screen reader user actually hear when they navigate this page?
- Is the heading structure coherent enough to skim?
- Does tab order follow a logical sequence?
- After I interact with this dropdown, is the right element focused?
- Did the modal close and restore focus to the trigger?

Those questions require reasoning about the **semantic tree as a whole**, not individual-element rule checks.

**Testing Library** is excellent for querying individual elements by role and name — the way users find them. But it doesn't reason about tree-level structure, tab sequences, or how the tree changes after user interactions.

Real A11y fills the space between rule-checking and element-querying: it exposes the full semantic tree so you can assert on the complete picture.

---

## How they complement each other

| Tool | Strength | Real A11y difference |
|---|---|---|
| axe-core | Rule violations | Tree-level structure + flow assertions |
| Testing Library | Finding elements | Tab order, outline, tree diffing |
| Playwright A11y snapshot | Browser accessibility tree | Works in jsdom too, plus assertions |
| Manual screen reader testing | Real user experience | Automates the structural checks |

**Use all of them.** Real A11y is not a replacement for axe — it's a complement. Run axe for rule violations; use Real A11y for structural assertions; use Testing Library for user-interaction tests.

---

## Design principles

**1. One engine, every context.**
The same extraction logic runs in jsdom (Vitest), in a real browser (Playwright), inside the Storybook preview iframe, and in the interactive tree panel. There's no "jsdom mode" with different behavior.

**2. Deterministic output.**
`auditSnapshot()` produces a stable string — same DOM, same string, every time, on every machine. No timestamps, no generated IDs, no ordering surprises. Safe to commit to version control.

**3. Fail loudly with context.**
`assertNoUnlabeledInteractive()` doesn't return `true/false`. It throws an `A11yAssertionError` with the specific element, its location in the tree, and a fix suggestion — because you're reading a test failure message at 2am and you need the answer, not a boolean.

**4. No CSS side effects by default.**
Shadow DOM isolation is the default. The embed panel can't break your app's layout; your app's styles can't break the panel. Every configuration that could cause a side effect (hover highlights, scroll-into-view, focus theft) is opt-in.

**5. Framework-agnostic core.**
`@real-a11y-dev/core` has zero non-standard dependencies. The React and Storybook packages are wrappers — the extraction engine is the same code.
