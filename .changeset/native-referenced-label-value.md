---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

The native tree no longer shows a field's value that Chromium reads into a name through another control's `<label>`. When a control has no value of its own to lend, Chromium reads its labels into any name that takes it in, field values and all. So `<label for="c">Code <input autocomplete="one-time-code" value="482913"></label><input type="checkbox" id="c">` made `<button aria-labelledby="c">` print as `button "Code 482913"`, even without strict mode, and an `aria-describedby` pointing at the checkbox carried the code into a description. Such a name now reads `[redacted]` and such a description is dropped, through a `<label for>` or a label around the control, for a hidden control, for a control labelled inside another control's label, and for a cell, link or heading named from content that holds the control. In strict mode (`redactInput`) this holds for any entered value or editor text in such a label. Names from markup alone are unchanged: a label's own text, an `aria-label` on the control (which Chromium reads first), and a label that holds no value. One case is withheld though Chromium skips the label: a reference to a `<select>` or a meter whose label holds a sensitive value, where Chromium reads the control's own value instead.
