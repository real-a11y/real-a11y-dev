---
title: Core Concepts — the semantic tree model
description: Understand the SemanticNode shape, the a11y vs DOM tree modes, roles, accessible names, tab order, and stable IDs that power every Real A11y package.
---

# Core Concepts

Understanding how Real A11y models the DOM will help you use every package more effectively.

## The Semantic Tree

When you call any Real A11y API on a DOM root, it builds a **semantic tree** — a tree of `SemanticNode` objects that mirrors what assistive technologies perceive, not the raw HTML structure.

```ts
interface SemanticNode {
  id: string;           // stable WeakMap-based fingerprint
  a11y: {
    role: string;       // ARIA role (resolved from element + explicit role attr)
    name: string;       // accessible name (label, aria-label, aria-labelledby…)
    description: string;
    level?: number;     // heading level, etc.
    states: Record<string, boolean>;     // checked, expanded, selected, pressed…
    properties: Record<string, unknown>; // aria-* properties
  };
  dom: {
    tag: string;
    textContent: string;
    isHidden: boolean;  // aria-hidden or display:none subtree
    attributes: Record<string, string>;
  };
  interaction: {
    isFocusable: boolean;
    tabIndex: number;
    actions: ActionType[]; // click, focus, type, toggle, select…
  };
  childIds: string[];   // ordered child node IDs
}
```

### Two tree modes

| Mode | What it shows |
|---|---|
| `"a11y"` | Accessibility tree — roles, names, ARIA states. Mirrors what a screen reader sees. |
| `"dom"` | DOM tree — raw tag names and text content. Useful for structural audits. |

Both modes produce the same `SemanticNode` shape; only the `a11y.role` and `a11y.name` computation differs.

---

## Roles

Roles follow the [WAI-ARIA specification](https://www.w3.org/TR/wai-aria-1.2/#role_definitions). Real A11y maps every HTML element to its implicit ARIA role, then overrides with an explicit `role` attribute if present.

Examples:

| Element | Implicit role |
|---|---|
| `<button>` | `button` |
| `<a href="…">` | `link` |
| `<input type="text">` | `textbox` |
| `<input type="checkbox">` | `checkbox` |
| `<h1>` – `<h6>` | `heading` (with `level`) |
| `<nav>` | `navigation` |
| `<main>` | `main` |
| `<dialog>` | `dialog` |
| `<div>` (no role) | `generic` |

`role="presentation"` and `role="none"` strip the element's role from the tree — the element is still present, but its children are re-parented.

---

## Accessible Names

The `a11y.name` computation follows the [Accessible Name and Description Computation (ANDC)](https://www.w3.org/TR/accname-1.2/) algorithm, in priority order:

1. `aria-labelledby` — references another element's text content
2. `aria-label` — inline string
3. Native label — `<label for="…">` or wrapping `<label>`
4. Text content — for buttons, links, headings
5. `title` attribute — last-resort fallback

```html
<!-- aria-label wins -->
<button aria-label="Close dialog">✕</button>
<!-- name: "Close dialog" -->

<!-- aria-labelledby wins (even over aria-label) -->
<h2 id="dlg-title">Confirm delete</h2>
<dialog aria-labelledby="dlg-title">…</dialog>
<!-- dialog name: "Confirm delete" -->
```

::: tip Deep dive
The full rules — including multi-ID `aria-labelledby` concatenation, what *doesn't* contribute (placeholders, CSS generated content, `aria-hidden` subtrees), and a debugging checklist — live in [Accessible Names](/guide/accessible-names).
:::

---

## Stable Node IDs

Each node gets a stable `id` derived from a `WeakMap<Node, string>`. The same DOM node always gets the same ID within a page session — even across re-extractions — so `diffTrees()` can reliably report what changed vs. what's new.

IDs are **not** stable across page reloads; they're designed for in-session diffing, not persistence.

---

## Tab Order

`getTabSequence(tree)` computes the tab order using the same algorithm browsers use:

1. Elements with positive `tabindex` values, ascending by value, then in DOM order for ties.
2. Elements with `tabindex="0"` or no tabindex, in DOM order.
3. Elements with `tabindex="-1"` are skipped (reachable programmatically, not by Tab key).
4. Disabled elements and `aria-hidden` subtrees are skipped.

---

## Heading Outline

`getOutline(tree)` returns a flat list of `{ id, level, name }` entries for all `heading` nodes in DOM order. This is the data behind `outlineSnapshot()` and `assertHeadingOrder()`.

A well-structured heading outline:
- Has exactly one `h1`
- Never skips a level (e.g., `h1 → h3` with no `h2` in between)

---

## Tree Diffing

`diffTrees(before, after)` compares two serialized trees and returns:

```ts
interface TreeDiff {
  added: SemanticNode[];    // nodes present in after, absent in before
  removed: SemanticNode[];  // nodes present in before, absent in after
  changed: NodeChange[];    // nodes with the same ID but different properties
}
```

Changes detected: role, name, description, textContent, isHidden, isFocusable, aria states, aria properties, and child order.

This powers the `flow().expectTree()` assertion and the `waitForMutations()` utility in `@real-a11y-dev/testing`.
