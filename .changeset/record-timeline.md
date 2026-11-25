---
"@real-a11y-dev/testing": minor
---

Add `recordTimeline(root, options?)`: a recorder that starts before an interaction and returns, from `stop()`, a boxed snapshot of what a keyboard and screen-reader user met during it, in order. A diff sees the page at two moments; the timeline also shows what came and went between them.

```
focus     button "Delete draft"
announce  status "Deleting…"
focus     (none)
announce  status "Draft deleted."
focus     button "New draft"
```

A `focus` line names the focused node as `tabSequenceSnapshot` prints a stop, `role "name" {states}`, and `(none)` is focus resting on the page, including when the focused element is removed, which fires no event. An `announce` line is the text a live region gains (`aria-live`, or a `status`, `alert` or `log`), read as a screen reader could read it, with `{live=…}` when `aria-live` sets a politeness the role doesn't imply. Lines follow the order the page made its changes. `{ focus: false }` or `{ announcements: false }` records one half alone, and `redact` masks names and announced text as in the other snapshots.
