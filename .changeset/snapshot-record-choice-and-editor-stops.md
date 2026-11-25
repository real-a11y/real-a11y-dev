---
"@real-a11y-dev/testing": patch
---

The snapshot report's records no longer say which option of a sensitive field is chosen, and keep an editor's tab stops in place.

- **A sensitive choice:** the tree withholds which option of a sensitive field's popup is chosen (a card-expiry month, say), and the tab order names its one stop `[redacted]`. A record still said which: the chosen option kept its `tabindex="0"` beside the others' `-1`, and focus on it. Every option of such a popup now reads alike in a record, with no `tabindex` and no focus, and focus on one shows on the list it is in. The TAB view leaves that stop out. This applies to every boxed tree snapshot's record, not only a tab sequence's.
- **An editor's tab stops:** a record leaves out what is inside a rich-text editor, and that took a tab stop inside one with it, such as a mention chip's link. The TAB view then listed one stop fewer than the text. Each such stop now stays in its place, named `[redacted]` and carrying no text.
