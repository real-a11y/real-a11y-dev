---
"@real-a11y-dev/testing": minor
---

Add `{ interactions: true }` to `recordTimeline`: the timeline also prints what the user did, among the lines for what the page did. Off by default, so a timeline you already committed reads the same.

```
press     Tab
focus     button "Delete draft"
click     button "Delete draft"
announce  status "Deleting…"
type      textbox "Email"
```

A `press` line is a key that types no text (`Tab`, `Shift+Tab`, `Escape`, an arrow, `Space` outside a text field, a `Ctrl` or `Meta` shortcut), one line per press. A `click` line is a `click` event the page received, named as a focus line names its node, so `fireEvent.click` prints a click with no focus move and a pointer click prints its focus line first. A `type` line is typing into a field, one line however many keystrokes, naming the field and never what was typed: no typed character, `input` data or clipboard content reaches a line, and a sensitive field prints its role and name alone.
