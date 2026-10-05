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

- **`stop()` could not stop it.** It only ever disconnects the set from the most recent `start()`, so the earlier observers kept recording mutations and re-arming the shared debounce — firing `onTreeChange` after the consumer had torn the observer down, for the life of the document, unreachable.
- The stranded `input`/`change` listeners stayed on the root for the same reason: `stop()` removes the listener identity it currently holds, and the later `start()` had already replaced it.
- While armed, every stranded set recorded the same mutation into the same `pendingMutations` buffer, so one DOM mutation arrived as **duplicate entries in `change.mutations`**. The callback still fired once per batch — the sets share one debounce timer, and each reset it — so the symptom is a payload describing one change N times, not N callbacks.

`start()` now returns early when it is already armed. A consumer that starts once is unaffected, and re-arming after a real `stop()` behaves as before.

It is a no-op rather than an internal restart on purpose: `root` is fixed at construction, so a restart has nothing new to pick up, while tearing down first would drop the deep observers for overlays that are **already open** — the portal observer adopts an overlay only on the `childList` record that mounts it, so an open one would never be re-adopted, and clearing the portal map also loses the identity-keyed teardown that an overlay emptied by an exit animation relies on.
