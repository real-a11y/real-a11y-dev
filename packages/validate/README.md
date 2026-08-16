# @real-a11y-dev/validate

ARIA semantics validation for the [Semantic Navigator](https://real-a11y.dev) accessibility tree. It catches the structural mistakes a per-node check can't — an interactive control nested inside another, composite content inside a `button`, a container that must own children but doesn't — using [`aria-query`](https://github.com/A11yance/aria-query) so the rules never drift from the spec.

> **Internal package — not published to npm.** It is bundled into
> [`@real-a11y-dev/testing`](../testing), which is where its rules reach you: the
> `toBeValidA11yTree` matcher runs them. There is nothing to install and nothing
> to import by this name. The examples below are written from inside the
> workspace, for anyone working on the rules themselves.
>
> It was published up to `0.1.0-beta.7` before becoming internal. If you depended
> on that version directly, `toBeValidA11yTree` covers the validation itself; the
> role-metadata helpers below (`roleMeta`, `isValidRole`, `attributesForRole`,
> `requiredOwnedRoles`, …) have no published replacement.

```ts
import { validateTree } from "@real-a11y-dev/validate";

// Any tree of { id, parentId, role, name, attrs } nodes, keyed by id.
// `implicitRole` and `uaSuppliedAttrs` are optional — see below, and note that
// omitting them is not neutral.
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

Two further fields let a producer that knows the underlying element say so. Both are optional, and both **fail closed** — an adapter that omits them gets _more_ errors, not fewer:

| Field                          | Says                                                                      | Absent means                       |
| ------------------------------ | ------------------------------------------------------------------------- | ---------------------------------- |
| `implicitRole?: boolean`       | the role came from the element (`<select>` → `combobox`), not an authored `role=` | treated as authored                |
| `uaSuppliedAttrs?: string[]`   | ARIA states the user agent supplies, so the author owes nothing           | treated as supplying nothing       |

`implicitRole` governs structure: only an authored role can be invalid ARIA, and the interactive-nesting rule reads native structure rather than the computed role. `uaSuppliedAttrs` is per-attribute, because an element can supply one state and still owe another — `<input type="checkbox" role="switch">` is authored, non-redundant, and still has UA-supplied checkedness.

So a tree authored by hand validates as written, while a tree extracted from a live DOM can exempt what the platform already guarantees. `@real-a11y-dev/testing` populates both from the extracted `dom.tagName` / `dom.attributes`.

## In tests

[`@real-a11y-dev/testing`](https://real-a11y.dev/packages/testing) ships a matcher built on this package:

```ts
import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
registerA11yMatchers(expect);

expect(container).toBeValidA11yTree();
```

It extracts the element's accessibility tree, runs both validators, and fails on ARIA errors — invalid roles, missing required names/attributes, and the relationship violations above.

That matcher is currently the only thing that runs these rules. `@real-a11y-dev/testing` is the sole dependent — the `real-a11y audit` CLI command and the MCP `audit_page` tool do **not** run `validateTree`/`validateNode`; they run the best-practice rules from [`@real-a11y-dev/audit`](../audit) instead. ARIA-conformance findings reach you through the matcher, not through a page audit.

## Not `@real-a11y-dev/audit`

[`@real-a11y-dev/audit`](../audit) supplies the **best-practice** findings — heading order, landmark structure, unlabeled controls, missing alt text — and is what the `real-a11y audit` command and `audit_page` run. It is internal too, so like this package you meet it bundled inside the surfaces that run it. The two are complementary siblings, neither built on the other: `validate` answers _is the ARIA spec-legal?_, `audit` answers _does the page follow accessibility best practice?_ A page can pass one and fail the other (three `<h1>`s are spec-legal but bad practice). ARIA *correctness* is **`validate`**'s question, accessibility *quality* is **`audit`**'s.

They also reach you through different surfaces, which is the practical difference: `audit`'s rules run over a live page from the CLI, MCP and CI, while `validate`'s run in tests via `toBeValidA11yTree`.

## Design

[`@real-a11y-dev/core`](../core) stays dependency-free; this package layers the `aria-query`-backed rules on top of core's tree, so consumers who only need extraction don't pay for the rules.
