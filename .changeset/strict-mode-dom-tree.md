---
"@real-a11y-dev/testing": minor
---

`redactInput` works with the DOM tree too. `attach(page, { redactInput: true })` used to throw unless you also passed `tree: "native"`. It now runs the same strict mode on the in-page tree: no node carries a field value, and a name that would carry text typed into a rich-text editor (a heading around a composer, a button labelled by one, a heading inside one) reads `"[redacted]"` whole, as the native tree reads it. It holds for every method of the handle, the tab sequence and the `assert*` messages included, which the native tree never offered. The jsdom serializers take the same option: `treeSnapshot(root, { redactInput: true })`, and `outlineSnapshot` and `tabSequenceSnapshot` likewise. Given an already-extracted tree, they throw unless it was read in strict mode. Without the option nothing changes.
