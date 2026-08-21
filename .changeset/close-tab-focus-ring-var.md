---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/react": patch
---

Point the close-tab button's focus ring at a custom property that exists. The
shared `tree.css` these packages bundle styled `.sn-close-tab-btn:focus-visible`
with `outline: 2px solid var(--sn-focus-ring)`, but no stylesheet in the repo
ever declared `--sn-focus-ring` — every other `:focus-visible` rule uses
`--sn-border-focus`. An undefined custom property is invalid at computed-value
time, so the whole `outline` declaration was discarded and the property fell
back to `none`, suppressing the browser's own focus ring along with the intended
one. The control the rule applies to is rendered by the extension's page header,
so the visible fix lands there, but the broken declaration shipped in every
bundle of the stylesheet. `tree.css.test.ts` now fails if any `var(--…)` in the
stylesheet names a property that is declared nowhere and has no fallback.
