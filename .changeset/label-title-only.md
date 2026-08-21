---
"@real-a11y-dev/testing": minor
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": minor
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
---

Add `label-title-only`, an axe-aligned warning for form controls whose only label is `title` or `aria-describedby`.

`no-unlabeled-interactive` still fails only on an empty accessible name — glyph buttons and `title=` on a `<button>` pass, matching axe `button-name`. Placeholder-only inputs are out of scope for the new rule, matching axe. The new id is selectable via `collectFindings` / `--rules` / `audit_page`; `assertNoUnlabeledInteractive` is unchanged.
