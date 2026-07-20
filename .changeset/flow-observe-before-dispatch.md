---
"@real-a11y-dev/testing": patch
---

Make every `flow()` step resolve as soon as its action settles instead of always waiting out `waitTimeout`. `ActionDispatcher.dispatch` is fully synchronous, so a handler's DOM writes (and the `input`/`change` events from `type()`) landed _before_ the mutation observer was created — the observer never saw them, and each step could only end at the timeout, giving a 10-step chain a hard 2-second floor. The observer now starts before the action is dispatched, so a step settles one ~50ms debounce after its own mutations; measured on a step whose handler mutates synchronously, this drops from the full timeout (1016ms at `waitTimeout: 1000`) to the debounce.
