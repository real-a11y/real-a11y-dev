---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

The `no-unlabeled-interactive` audit rule now also reports an unnamed `treeitem`, `tooltip`, `meter` or `progressbar`. WAI-ARIA 1.2 requires an accessible name for all four, yet they were skipped, so an unnamed one produced no finding. The rule id and severity (`error`) are unchanged; the message for these roles reads `Unnamed element: tooltip <div> (this role requires an accessible name)`.

`real-a11y audit` and `real-a11y snapshot` can newly exit 1 on pages with these roles unnamed, under the default `--fail-on error`. Use `--baseline` to accept existing findings, or `--fail-on` to change the threshold. `assertNoUnlabeledInteractive()` and `toHaveNoUnlabeledInteractive` fail on them too. `INTERACTIVE_ROLES` is unchanged.
