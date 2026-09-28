---
"@real-a11y-dev/storybook-addon": minor
---

Storybook addon: stop re-publishing a tree that has not changed.

The preview emitted `TREE_UPDATED` on every debounced `DomObserver` fire, shipping every node with its full `dom`/`a11y`/`interaction`/`ui` sub-objects across the iframe boundary and re-rendering the whole panel — even when the mutation extracted to an identical tree. The fires this saves are the high-frequency ones: inline `style`/`transform` churn (a CSS animation, an open menu repositioned every scroll frame) and mutations inside a hidden or `aria-hidden` subtree, which the walk skips entirely.

The preview now compares each extraction against the last one it published (`mode` included, `extractedAt` excluded) and stays quiet when they are byte-identical. Extraction itself is unchanged and still runs on every fire, so highlight element refs stay fresh. The first publish after the panel opens and after a story renders is always sent, as is one whose `mode` differs from the last published (re-selecting the mode the panel is already in changes nothing, and stays quiet like any other no-op).

**Breaking change.** `TREE_UPDATED` now fires on changes to the tree rather than on every debounced DOM mutation, so code listening on the channel directly receives strictly fewer events and `payload.extractedAt` no longer advances while a story mutates without semantic effect.

_Migration:_ if you were using `TREE_UPDATED` as a DOM-mutation heartbeat or as a liveness signal, observe the DOM yourself instead — `DomObserver` from the core engine is what the addon uses. Anything that renders the payload (the normal case, including the bundled manager panel) needs no change: the events you stop receiving are the ones that would have rendered the same thing twice.

Note the limits, so this is not mistaken for a general mutation filter: `class` is a key attribute and lands in `dom.attributes`, so a class toggle still publishes, and a re-render that replaces elements rather than patching them in place mints fresh node ids and so publishes too.
