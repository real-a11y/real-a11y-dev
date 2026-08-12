---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Share the node-id registry and the element reference map across every copy of the engine in a realm.

Both were plain module-scope state — `const elementRefs = new ElementRefMap()` and a `let counter` beside a `WeakMap<Node, string>`. That is correct while exactly one copy of the engine is loaded, and only then.

More than one copy is the normal case. `@real-a11y-dev/inspector` already bundles the engine rather than importing it, and the same is true of the extension; anything that bundles it gets a private registry. When a node crosses that boundary the ids stop meaning the same thing: `dispatch()` in `@real-a11y-dev/testing` turns a node id back into a live `Element` through the ref map, so an extraction recorded in one copy is invisible to an action performed by another. The lookup misses, `dispatch` returns without doing anything, and nothing reports an error — a Radix slider stepped with `dispatch(slider, "decrement")` simply stays at 50. The id counter has the matching failure: two copies both start at zero and both hand out `sn-0`, for different nodes.

Both now live in a realm-wide registry keyed by `Symbol.for()`, so every copy in the realm resolves the same object. Realm rather than process is the right scope — an iframe or a worker gets its own, which matches the DOM it describes, since `Element` identity does not cross those either.

> **Retargeted when `core` went private.** This entry named `core` itself while
> the engine was still published, and dependents would have cascaded from its
> bump. A private package has no version to cascade from, so the consumers are
> named directly — all six, because every published package bundles the engine
> and the fix has to reach every tarball. Left as it was, it would also have
> mixed an ignored package with non-ignored ones and thrown at
> `changeset version`, breaking the release cut.

No API change: `getElementRefs()`, `getNodeId()` and `resetIdCounter()` keep their signatures and their behaviour, including `resetIdCounter()` resetting only the counter and deliberately keeping the node→id map.
