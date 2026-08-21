# @real-a11y-dev/audit

The audit engine for [Semantic Navigator](https://real-a11y.dev) — the one place an accessibility *finding* is defined and detected. It holds the `Finding` data model, the rule set, `collectFindings` (non-throwing), and the `assert*` primitives (throwing), depending on nothing but [`@real-a11y-dev/core`](../core).

> **Internal package — not published to npm.** It is bundled into
> [`@real-a11y-dev/testing`](../testing), the `real-a11y` CLI, the MCP server,
> and the internal [`browser`](../browser) driver's page-bundle — every surface
> that reports a finding already carries it. There is nothing to install and nothing
> to import by this name. The examples below are written from inside the
> workspace, for anyone working on the rules themselves.
>
> It was published up to `0.1.0-beta.12` before becoming internal. If you
> depended on it directly,
> [`@real-a11y-dev/testing`](https://real-a11y.dev/packages/testing) re-exports
> this vocabulary under the same names — `Finding`, `A11yRule`, `RoleFilter`,
> `ALL_RULES`, `INTERACTIVE_ROLES`, `collectFindings`, `listByRole`,
> `A11yAssertionError`, and the four `assert*` helpers below. Only
> `formatFindings` and `assertRules` are left behind, with no published
> replacement.

## `audit` vs `@real-a11y-dev/validate`

`validate` is workspace-internal — it isn't published to npm. You meet it bundled inside `@real-a11y-dev/testing`, whose ARIA matchers run it, rather than as an install of its own. The split below is still worth knowing, because a matcher failure names one or the other.

Sibling packages — neither is built on the other — that answer **different questions**:

|                     | `@real-a11y-dev/validate` (internal)                                          | `@real-a11y-dev/audit` (this package, internal too)                                     |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Answers**         | Is it **spec-legal ARIA**?                                                    | Does it follow **best practice**?                                        |
| **Grounded in**     | [`aria-query`](https://github.com/A11yance/aria-query) — tracks the ARIA spec | Curated accessibility rules                                              |
| **Depends on**      | `aria-query` only (standalone)                                               | `@real-a11y-dev/core` only                                              |
| **Flags**           | invalid roles, a role missing its _required_ name, illegally nested controls | heading order, one `main` landmark, alt text, labeled dialogs & controls |
| **Only it catches** | `role="madeup"`, a `link` nested inside a `button`                            | three `<h1>`s — perfectly spec-legal, but bad accessibility             |

A full audit runs **both**: the `real-a11y audit` CLI command and the MCP `audit_page` tool report `validate`'s ARIA-conformance errors alongside this package's best-practice findings. Rule of thumb: ARIA _correctness_ is **`validate`**'s question, accessibility _quality_ is **`audit`**'s.

## Collect findings

`collectFindings(root)` walks the extracted accessibility tree and returns a flat, structured list — it never throws, so it suits JSON reporters, dashboards, and agents:

```ts
import { collectFindings } from "@real-a11y-dev/audit";

const findings = collectFindings(document.body);
// [
//   { rule: "no-unlabeled-interactive", severity: "error",
//     message: "Unlabeled interactive element: button <button>", role: "button" },
//   { rule: "heading-order", severity: "warning",
//     message: 'Heading level skipped: "Details" is h4 but the previous heading was h2.',
//     role: "heading" },
// ]
```

Every `Finding` is self-contained — `rule`, `severity` (`"error"` blocks use, `"warning"` is triage-later), a human-readable `message`, and, when node-scoped, `role`/`name`. The same object drives the throwing helpers below (which format it into an assertion message) and non-throwing consumers (which return it as-is).

The rules, in run order (`ALL_RULES`):

| Rule | Catches |
|---|---|
| `no-unlabeled-interactive` | An interactive control (button, link, textbox, …) with no accessible name. Glyph / `title=` buttons pass — the name is non-empty, matching axe `button-name`. |
| `label-title-only` | A form control (`input` / `select` / `textarea`) whose only label is `title` or `aria-describedby`. Warning, matching axe `label-title-only`. Placeholder-only and title-only **buttons** are out of scope. |
| `image-alt` | An image with no text alternative. |
| `heading-order` | More than one `h1`, or a skipped heading level. |
| `dialog-labeled` | A `dialog`/`alertdialog` with no accessible name. |
| `landmark-structure` | Missing/duplicate `main`, or more than one `banner`/`contentinfo`. |

## Assert (throwing)

Each rule also has a throwing `assert*` helper for test bodies. On a violation it throws an `A11yAssertionError` whose message names the offending nodes:

```ts
import {
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
  assertDialogsLabeled,
  assertLandmarkStructure,
} from "@real-a11y-dev/audit";

assertNoUnlabeledInteractive(container); // throws A11yAssertionError if any control is unnamed
```

## By role

`listByRole(root, filter)` returns a token-efficient text listing of one category at a time — `role "name"` plus a best-effort locator — for reviewing a single kind of element. The filter is one of the extension's role groups: `link`, `button`, `form`, `heading`, `landmark`, or `image`.

```ts
import { listByRole } from "@real-a11y-dev/audit";

listByRole(document.body, "button");
// button "Save"       [#save-btn]
// button "Cancel"     [.modal-actions > button]

listByRole(document.body, "landmark"); // every landmark region, one per line
```

It never returns an empty string, so no caller needs a sentinel of its own. An empty category explains itself instead — "none" alone answers three different questions the same way, and the fix differs for each:

```ts
listByRole(document.body, "image");
// (none — filter "image" matched 0 of 412 nodes; it looks for role img)

listByRole({ nodes: new Map(), rootId: "" }, "image");
// (none — the tree is empty, so nothing could match filter "image"; the page
//  may not have loaded, or extraction failed)
```

The node count separates *"this page has none"* from *"nothing was read"*. The role list is the other half: `image` looks for exactly `img`, so a page whose graphics are `figure`s reports none — and `landmark` includes the `form` role while the `form` filter does **not**, because that one looks for the fields.

## Design

`collectFindings` is deliberately separate from anything that renders it. `@real-a11y-dev/testing` wraps these helpers as Vitest/Jest matchers, the `real-a11y audit` CLI command prints them, and the MCP `audit_page` tool returns them to an agent — but a rule is written **once**, here, and every surface reports it. [`@real-a11y-dev/core`](../core) stays dependency-free; this package layers the rules on top of core's extracted tree, so consumers who only need extraction don't pay for the audit engine.
