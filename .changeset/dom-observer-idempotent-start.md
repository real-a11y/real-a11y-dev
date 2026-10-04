---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

`DomObserver.start()` is now idempotent, instead of stranding a whole set of observers on every call after the first.

`start()` builds the primary `MutationObserver`, the portal and popover observers, and the `input`/`change`/`toggle` listeners, assigning each to a field it overwrites unconditionally. Calling it again on an already-armed observer therefore left the previous set connected with nothing holding a reference to it:

- Both sets recorded into the same `pendingMutations` buffer, so one DOM mutation reached `onTreeChange` twice, and each re-armed the same debounce.
- `stop()` could only disconnect the set from the most recent `start()`. The earlier ones kept observing — and kept re-arming the debounce — for the life of the document, unreachable.
- The stranded `input`/`change` listeners stayed on the root for the same reason: `stop()` removes the listener identity it currently holds, and the later `start()` had already replaced it.

`start()` now returns early when it is already armed. A consumer that starts once is unaffected, and re-arming after a real `stop()` behaves as before.

It is a no-op rather than an internal restart on purpose: `root` is fixed at construction, so a restart has nothing new to pick up, while tearing down first would drop the deep observers for overlays that are **already open** — the portal observer adopts an overlay only on the `childList` record that mounts it, so an open one would never be re-adopted, and clearing the portal map also loses the identity-keyed teardown that an overlay emptied by an exit animation relies on.
