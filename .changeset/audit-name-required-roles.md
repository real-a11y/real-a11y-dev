---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
"@real-a11y-dev/testing": minor
---

The `no-unlabeled-interactive` audit rule now also reports an unnamed `treeitem`, `tooltip`, `meter` or `progressbar`. WAI-ARIA 1.2 requires an accessible name for all four, yet they were skipped, so an unnamed one produced no finding. The rule id and severity (`error`) are unchanged; the message for these roles reads `Unlabeled element: tooltip <div> (this role requires an accessible name)`.

**Breaking change.** Checks that passed before can now fail on pages with one of these four roles unnamed (for example a bare `<progress>` or `role="meter"`):

- `real-a11y audit` exits 1 under the default `--fail-on error`. Migrate by naming the element (`aria-label` or a label), or pass `--fail-on` to change the threshold, or `--rules` to leave `no-unlabeled-interactive` out.
- `real-a11y snapshot` lists the new findings, but only gates on them when `--fail-on error` is set (it defaults to `never`).
- The MCP `audit_page` tool returns the new findings.
- `assertNoUnlabeledInteractive()` and `toHaveNoUnlabeledInteractive` now throw for them. Name the element to fix it.

`INTERACTIVE_ROLES` is unchanged.
