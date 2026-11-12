---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Strict mode now reaches the tab order. `real-a11y tabs --redact-input` and `get_tab_order` under `REAL_A11Y_REDACT_INPUT=1` read the in-page walk, where strict mode used to mean only "print no values". Text typed into a rich-text editor still reached a stop's name: `<button aria-labelledby="draft">` over a composer printed `button "<what was typed>"`, and so did a link around an editable span. Those names now read `[redacted]` whole, as `tree` prints them. Outside strict mode nothing changes.
