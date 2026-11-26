---
"@real-a11y-dev/testing": patch
---

The snapshot report's records no longer say which option of a sensitive field is chosen, and keep an editor's tab stops in place.

- **A sensitive choice:** the tree withholds which option of a sensitive field's popup is chosen (a card-expiry month, say), and the tab order names its one stop `[redacted]`. A record still said which: the chosen option kept its `tabindex="0"` beside the others' `-1`, and focus on it; and where the tree marks only the chosen item (a pressed button among buttons in a dialog), the mark said so too. Every option of such a popup now reads alike in a record. A list box's or a date grid's options have no `tabindex` and aren't focusable, and elsewhere in the popup the chosen item reads as the others do. Focus on any of them shows on what the choice is made in: the list box, the grid, or the popup, never a date grid's cell, which would say the day. A tab sequence that printed such a stop as `[redacted]` opens on the tree. This applies to every boxed tree snapshot's record, not only a tab sequence's.
- **An editor's tab stops:** a record leaves out what is inside a rich-text editor, and that took a tab stop inside one with it, such as a mention chip's link. The TAB view then listed one stop fewer than the text. Each such stop now stays in its place, named `[redacted]` and carrying no text or state.
