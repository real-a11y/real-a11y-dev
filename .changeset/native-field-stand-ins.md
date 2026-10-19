---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

The native tree no longer names what holds a field after the field's value when the field has no node of its own. A `role="none"` or `"presentation"` on a disabled field takes the field's node out of Chromium's tree, and Chromium still names the cell, link, button or `<label>` holding the field from what it holds, and a region the field labels by `aria-labelledby`. The value policy looked for the field's node and found nothing to withhold:

- `<td><input disabled role="none" autocomplete="cc-number" value="4111…"></td>` read `LayoutTableCell "4111111111111111"`;
- a password inside a button gave its length away as `button "•••••••"`;
- a disabled card-expiry `<input type="month" role="none">` printed `spinbutton "Month" = "April"` and `spinbutton "Year" = "2030"`, in MCP's default output too.

What stands in for such a field in the tree, its inner box or its parts, is now classified by the field's own markup, as the field would be. Around a sensitive field, those names read `[redacted]`, and so do the parts' values. In strict mode (`--redact-input`, `REAL_A11Y_REDACT_INPUT`) every such field counts: `<label><input type="checkbox"> Use <input disabled role="none" value="…"></label>` no longer names the checkbox after the value. An empty field still gives nothing away, so a cell Chromium names after its placeholder keeps that name.

A text box the DOM walk never saw, because the page replaced it between the two reads, may be such a field's, and is withheld the same way: a name built around it reads `[redacted]` for that read.

**Expect snapshot changes** only on pages with such fields.
