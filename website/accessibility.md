# Accessibility Statement

_Last updated: 2026-04-18_

Real A11y builds accessibility tooling. Holding our own website, docs, and products to the same standard is table stakes — and also the best dogfood there is.

## Standards we target

- **Web Content Accessibility Guidelines (WCAG) 2.2, level AA** for the website and all product UI (Chrome extension side panel, Storybook addon panel, Inspector embed).
- **WAI-ARIA Authoring Practices** for all interactive patterns (tree view, toolbar, listbox, dialog).
- **Keyboard operability** for every interactive surface. Nothing is mouse-only.

The accessibility tree the tools surface is built on top of the same HTML/ARIA semantics we expect our own surfaces to follow.

## Known gaps

- The tree view in the Chrome extension uses the WAI-ARIA `tree` pattern. On very large pages (10K+ elements) the virtualization gap can cause noticeable delay for screen-reader users. Tracked as an open issue.
- The "Curtain" mode (hide page visuals to audit purely from the tree) intentionally hides page content; this is a feature, not a regression, but it is incompatible with external screen-reader workflows that rely on sighted co-operation.
- The Storybook addon panel inherits whatever theme Storybook provides; contrast on custom Storybook themes is the theme author's responsibility.

## How we test

- Automated: `@real-a11y-dev/testing` assertions (`assertNoUnlabeledInteractive`, `assertHeadingOrder`, `assertDialogsLabeled`, `assertLandmarkStructure`) run in CI on every PR.
- Automated: a11y tree diff bot comments on PRs when the extracted tree for fixture pages changes in any measurable way.
- Manual: keyboard-only walkthrough of the website and extension side panel before every release.
- Manual: NVDA + Firefox, VoiceOver + Safari, JAWS + Chrome for major features before release.

## Reporting a problem

If you hit an accessibility barrier on our website or in any product:

1. **Preferred** — open a GitHub issue with the `a11y` label: [github.com/real-a11y/real-a11y-dev/issues/new?labels=a11y](https://github.com/real-a11y/real-a11y-dev/issues/new?labels=a11y).
2. **Email** — `a11y@real-a11y.dev` if GitHub isn't an option for you.

Please include:

- Where the barrier is (URL, extension view, story name, code snippet)
- What assistive technology / browser you're using
- What happened vs. what you expected

## Our commitment

- We acknowledge a11y reports within **72 hours**.
- Regressions from our own released code get priority over new features.
- We will post-mortem in the changelog when we ship an a11y fix that affected users.

## Scope

This statement covers:

- `real-a11y.dev` and any subdomain we operate
- Semantic Navigator Chrome extension
- `@real-a11y-dev/*` packages' default UI (shipped components — your own styling/usage is your responsibility)

It does not cover third-party content we link to from the docs.

## Feedback

This statement is a living document. If you think we're overstating our coverage, understating a gap, or missing a pattern — open an issue or email `a11y@real-a11y.dev`.
