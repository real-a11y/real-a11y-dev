---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/mcp": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": minor
"@real-a11y-dev/testing": minor
---

The DOM producer no longer reports date, time, color and file inputs as `textbox`. HTML-AAM gives these input types "No corresponding role", so a screen reader never announces a text field for them.

A `file` input is now a `button`, which is what Chromium and the native producer already report. `color`, `date`, `datetime-local`, `month`, `week` and `time` inputs now print HTML-AAM's computed-role strings: `html-input-color`, `html-input-date`, `html-input-datetime-local`, `html-input-month`, `html-input-week` and `html-input-time`. These are engine vocabulary, not authored ARIA, so an authored `role="html-input-date"` is still ignored and `validate` still rejects it. `text` inputs and unknown types stay `textbox`. A readonly date or time input keeps its `readonly` state; a color or file input does not get one.

**Breaking change.** Role output for these inputs moves, so saved snapshots and contracts of a page with them will churn, and a `findByRole("textbox")` (or a Playwright `getByRole("textbox")`, which still falls back to `textbox` for the six non-file types) no longer matches them in the DOM tree. Migration: query a file input as `button` and the others by their `html-input-*` role, then regenerate saved snapshots and `toMatchA11yContract` contracts. A labelled `aria-labelledby` or `aria-describedby` reference to a file input now reads its name, not the chosen file names, since a `button` lends its name. The `tabs` command and `get_tab_order` tool list these inputs under the new roles, and the `no-unlabeled-interactive` audit rule now reports an unlabeled one under its new role. `cli`, `mcp`, `inspector`, `react`, `storybook-addon` and `testing` all bundle the engine; the native tree (`tree`, `audit` over CDP) is unchanged by this release.
