---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

The native tree no longer shows a payment card, password or other sensitive field's value in that field's own name. Chromium reads a field listed in its own `aria-labelledby` by value, so `<input id="card" aria-labelledby="card-label card" autocomplete="cc-number">` was printed as `textbox "Card 4111111111111111"` and a password field as `textbox "PIN ••••"`. Such a name now reads `[redacted]`, as any other name built from a sensitive field already did, and a description that reaches the field's own value (an `aria-describedby` pointing at the field, or at an element around it) is dropped. The same goes for an `aria-labelledby` pointing at an element around a date or month input, where Chromium reads the input's parts into the name. In strict mode (`redactInput`) this holds for every field and rich-text editor, which also covers a select-only combobox named by its own text (`combobox "Age Ten"`). Names Chromium builds without the value, such as a `<label>` around the field, are unchanged.
