---
"@real-a11y-dev/cli": patch
---

Declare each command's producer support once, on the command table.

Which commands accept `--producer native` was recorded in three places that could disagree: a `supportsNative` boolean passed in at each of five `producerOf` call sites, a hand-written `"native works with: audit, tree, outline"` list inside the refusal hint, and the Producer column in the docs. The hint's list is the one that had already drifted — it is offered to someone who just hit a refusal, so a stale entry sends them at a command that will refuse them too.

`CommandSpec` now carries `producers` (and `group`, the command reference's section). `producerOf` reads support from the table instead of taking it as an argument, and builds the hint's alternatives from the same place — filtered to commands that both support native and actually expose `--producer`, so the act commands (native-only, no such flag) are never suggested as somewhere to pass it.

No behavior change: the same commands accept native, and the hint reads the same today. It just can't fall out of step tomorrow.

**Superseded in this same release.** `--producer` was removed entirely — each surface now has exactly one correct producer, so there is nothing to choose and no refusal hint to keep current. `producers` and `group` outlive the flag: `producers` became a description of which producer a command _reads_ (still the fact that decides whether `--root` applies, and still what `docs/surface.json` publishes), and deriving it from the table rather than a hand-written list is what kept that removal honest.
