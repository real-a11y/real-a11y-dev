# @real-a11y-dev/validate

ARIA semantics validation for the [Semantic Navigator](https://real-a11y.dev) accessibility tree. It catches the structural mistakes a per-node check can't — an interactive control nested inside another, composite content inside a `button`, a container that must own children but doesn't — using [`aria-query`](https://github.com/A11yance/aria-query) so the rules never drift from the spec.

```sh
npm install @real-a11y-dev/validate
```

```ts
import { validateTree } from "@real-a11y-dev/validate";

// Any tree of { id, parentId, role, name, attrs } nodes, keyed by id.
const nodes = new Map([
  ["btn", { id: "btn", parentId: null, role: "button", name: "Save", attrs: {} }],
  ["a", { id: "a", parentId: "btn", role: "link", name: "Docs", attrs: {} }],
]);

validateTree(nodes);
// Map { "a" => [{ severity: "error",
//   message: 'interactive "link" is nested inside "button" — nested controls aren't operable…' }] }
```

Two layers:

- **`validateNode(node, nodesById)`** — per-node rules: valid role, required accessible name and attributes, direct required context.
- **`validateTree(nodesById)`** — relationship rules that need the whole tree: interactive nesting, presentational-children misuse, and required-owned containers.

Both run over a minimal `ValidatedNode` shape (`id, parentId, role, name, attrs`), so the _same_ engine validates a tree authored ahead of code or one extracted from a live DOM.

## In tests

[`@real-a11y-dev/testing`](https://real-a11y.dev/packages/testing) ships a matcher built on this package:

```ts
import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
registerA11yMatchers(expect);

expect(container).toBeValidA11yTree();
```

It extracts the element's accessibility tree, runs both validators, and fails on ARIA errors — invalid roles, missing required names/attributes, and the relationship violations above.

## Design

[`@real-a11y-dev/core`](https://real-a11y.dev/packages/core) stays dependency-free; this package layers the `aria-query`-backed rules on top of core's tree, so consumers who only need extraction don't pay for the rules.
