---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

The in-page tree now reads a form control's value into the name around it, as Chromium does (AccName step 2C). `<label><input type="checkbox"> Flash the screen <input value="3"> times</label>` used to name the checkbox "Flash the screen times"; it is now "Flash the screen 3 times", like Chromium's own tree. A heading around a `<select>` reads its chosen option ("Sort by Date"), a button labelled by a text field reads what it holds, and a slider, spinbutton, progress bar or meter lends its value. A control never lends its own `aria-label` or an option nobody chose, and is never named after its own value. This reaches every surface built on the in-page walk: the inspector panel, `@real-a11y-dev/react`, the Storybook addon, `@real-a11y-dev/testing`'s DOM tree and snapshots, the CLI's `tabs` and the MCP server's `get_tab_order`. Snapshots of such markup change. A password, one-time code or payment field that holds anything makes the whole name built from it read `[redacted]` and drops a description built from it; strict mode (`redactInput`) does the same for any value a user entered, while a progress bar's or meter's value, the page's own state, stays. A live panel renames the checkbox or heading as you type.
