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
  id: string;                    // stable WeakMap-based fingerprint
  parentId: string | null;       // null only for the root node
  childIds: string[];            // ordered child node IDs
  depth: number;                 // 0 at the root, child = parent + 1
  a11y: {
    role: string;                // ARIA role (resolved from element + explicit role attr)
    name: string;                // accessible name (label, aria-label, aria-labelledby…)
    description: string;
    value?: string;              // what a screen reader announces for a field ("Spain", not "es");
                                 // "[redacted]" for a filled password / card / one-time-code field
    states: Record<string, string | boolean>; // checked, expanded, selected, pressed…
                                              // each true/false, "mixed" (checked, pressed)
                                              // or an aria-current token ("page"…), read as
                                              // Chromium reads it: aria-disabled="TRUE" is
                                              // true, aria-disabled="" leaves it unset.
                                              // An element's own semantics win over its
                                              // attribute: a native checkbox or radio
                                              // reports its checkedness, true or false
                                              // ("mixed" when indeterminate), a drop-down
                                              // <select> is expanded only while its picker
                                              // is open, a <details>' summary follows
                                              // the details' `open`, and a button that
                                              // invokes a popover (popovertarget, or
                                              // commandfor with a popover command) is
                                              // expanded only while the popover shows —
                                              // each on a role that has the state, as
                                              // in Chromium. `expanded` exists only on
                                              // a role Chromium gives it (button, link,
                                              // tab, combobox, treeitem, row, listitem…):
                                              // any other ignores aria-expanded, and a
                                              // <details> has none, only its summary
    properties: Record<string, string>;       // aria-* properties (incl. heading "level")
    isExposedToAT: boolean;      // false when aria-hidden, role="presentation", etc.
  };
  dom: {
    tagName: string;
    attributes: Record<string, string>;
    textContent: string | null;  // direct text-node children only
    descendantText: string;      // truncated recursive text — useful for elements whose
                                 // accessible name is empty by spec (<code>, <pre>, <svg>).
                                 // Neither reads a <textarea>'s markup text: that is its
                                 // default value, and a value lives in a11y.value alone
    isHidden: boolean;           // not visible: visibility:hidden, or the visually-hidden
                                 // ("sr-only") pattern, which AT still reads. display:none
                                 // subtrees are never extracted at all.
  };
  interaction: {
    isInteractive: boolean;
    isFocusable: boolean;        // Chromium would focus it: never an <a> without
                                 // href, a disabled control, or a bad tabindex
    isEditable: boolean;
    actions: ActionType[];       // click, focus, type, toggle, select…
  };
}
```

::: tip Heading level lives on `properties`
Heading level isn't a typed field — it's stored as a string (`"1"`–`"6"`) on `a11y.properties.level`. You don't usually read it directly; `outlineSnapshot()`, `getOutline()`, and `findByRole(tree, "heading", { level: 2 })` parse it for you.
:::

### Two tree modes

| Mode | What it shows |
|---|---|
| `"a11y"` | Accessibility tree — roles, names, ARIA states. Mirrors what a screen reader sees. |
| `"dom"` | DOM tree — raw tag names and text content. Useful for structural audits. |

Both modes produce the same `SemanticNode` shape; only the `a11y.role` and `a11y.name` computation differs.

### Two producers

Two different engines can build that tree, and every tree records which one built it in `source.producer`.

| Producer | What it is | Where you meet it |
|---|---|---|
| `dom` | This project's own in-page walk, with its own ARIA role and accessible-name rules | the inspector, `react`, and the browser extension's tab order, or its whole tree with native mode off |
| `native` | Chromium's own accessibility tree, read over the DevTools protocol | the CLI and MCP server, and the browser extension's default view |

They agree on most of a page, but never byte for byte, by design. Chromium names some controls differently (a file input is a `button`, `<details>` is a disclosure), places names differently, and sees content the in-page walk can't reach, such as the built-in media controls inside `<video>`. So compare a tree only with one from the same producer. Tab order is the exception that only `dom` can answer: Chromium's tree knows whether a node can take focus, but not the order Tab visits them in.

---

## Roles

Roles follow the [WAI-ARIA specification](https://www.w3.org/TR/wai-aria-1.2/#role_definitions). Real A11y maps every HTML element to its implicit ARIA role, then overrides it with an explicit `role` attribute — read the way Chromium reads it, so the DOM producer and Chromium's own tree agree on what the element is.

Examples:

| Element | Implicit role |
|---|---|
| `<button>` | `button` |
| `<a href="…">` | `link` |
| `<input type="text">` | `textbox` |
| `<input list="fruits">` with `<datalist id="fruits">` | `combobox` |
| `<input type="checkbox">` | `checkbox` |
| `<h1>` – `<h6>` | `heading` (with `level`) |
| `<nav>` | `navigation` |
| `<main>` | `main` |
| `<dialog>` | `dialog` |
| `<div>` (no role) | `generic` |

An `<input>` whose `list` names a `<datalist>` is a `combobox`, because typing in it offers the datalist's suggestions in a popup. That holds for the text, search, email, tel, url, number, date and time types, as in Chromium's own tree. The datalist has to be in the input's own document or shadow root. A `list` naming anything else leaves the input a `textbox` (or `searchbox`, or `spinbutton`).

**The first token Chromium recognises wins.** `role` is a token list: an unknown or abstract token is skipped for the next one, and with none left the element keeps its own role. `<div role="foo button">Save</div>` is `button "Save"`, `<div role="widget">` is a `generic`, and `<button role="foo">` is still a `button`. Tokens are compared ASCII-case-insensitively (`role="BUTTON"` is a button), and `directory`, deprecated in ARIA 1.2, is a `list`.

**`listitem`, `option` and `treeitem` need their container.** Chromium drops each one outside its required context, for the next token or the element's own role:

| Role | Kept inside | Otherwise, for example |
|---|---|---|
| `listitem` | `<ul>`, `<ol>`, `<menu>` (whatever their role), `role="list"`, `role="group"` | `<div role="listitem">` alone is a `generic` |
| `option` | `<select>`, `role="listbox"`, `role="group"` | `<li role="option">` in a list is a `listitem` |
| `treeitem` | `role="tree"`, `role="group"`, through parent `treeitem`s | `<details role="treeitem">` alone is a `group` |

The container may sit behind role-less `div`, `span` or custom-element wrappers, or behind presentational elements, and an `aria-owns` owner with one of those roles counts too. Anything else in between ends the search: `<div role="listbox"><section><div role="option">` is no option. No other role is dropped for its context — a `tab` outside a `tablist` is still a `tab`.

`role="presentation"` and `role="none"` strip the element's role from the tree — the element is still present, but its children are re-parented. An `<li>` whose `<ul>`, `<ol>` or `<menu>` carries any role but `list` goes the same way, which is how `<ul role="none">` strips its items as well as itself.

`role="image"`, ARIA 1.3's synonym for `img`, extracts as `img` — the role Chromium's own tree reports for it — so role queries, snapshots and the `image-alt` rule see one role, not two. Like any `img`, it is named only by `aria-label`, `aria-labelledby` or `title`, never by its text.

Per ARIA's [presentational roles conflict resolution](https://www.w3.org/TR/wai-aria-1.2/#conflict_resolution_presentation_none), that role is **ignored** when the element is focusable or carries a global ARIA state or property, and the element keeps its implicit role instead. `<a href="/about" role="presentation">` is a `link`, and `<h2 role="presentation" aria-label="Q3">` is still a `heading` — a decorative role can't hide a control from the keyboard or a heading from heading order. `aria-hidden="true"` is the exception: it removes the element outright, so it never restores a role.

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
