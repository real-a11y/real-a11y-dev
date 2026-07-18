# @real-a11y-dev/audit

The audit engine for [Semantic Navigator](https://real-a11y.dev) — the one place an accessibility *finding* is defined and detected. It holds the `Finding` data model, the rule set, `collectFindings` (non-throwing), and the `assert*` primitives (throwing), depending on nothing but [`@real-a11y-dev/core`](https://real-a11y.dev/packages/core).

```sh
npm install @real-a11y-dev/audit
```

Most people never install this directly — they use [`@real-a11y-dev/testing`](https://real-a11y.dev/packages/testing) (which re-exports everything here), the `real-a11y` CLI, or the MCP server. Install `audit` when you want the raw findings engine with no test-runner or renderer attached.

## `audit` vs [`@real-a11y-dev/validate`](https://real-a11y.dev/packages/validate)

Sibling packages — neither is built on the other — that answer **different questions**:

|                     | [`@real-a11y-dev/validate`](https://real-a11y.dev/packages/validate)          | `@real-a11y-dev/audit` (this package)                                     |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **Answers**         | Is it **spec-legal ARIA**?                                                    | Does it follow **best practice**?                                        |
| **Grounded in**     | [`aria-query`](https://github.com/A11yance/aria-query) — tracks the ARIA spec | Curated accessibility rules                                              |
| **Depends on**      | `aria-query` only (standalone)                                               | `@real-a11y-dev/core` only                                              |
| **Flags**           | invalid roles, a role missing its _required_ name, illegally nested controls | heading order, one `main` landmark, alt text, labeled dialogs & controls |
| **Only it catches** | `role="madeup"`, a `link` nested inside a `button`                            | three `<h1>`s — perfectly spec-legal, but bad accessibility             |

A full audit runs **both**: the `real-a11y audit` CLI command and the MCP `audit_page` tool report `validate`'s ARIA-conformance errors alongside this package's best-practice findings. Rule of thumb: reach for **`validate`** to check ARIA _correctness_, **`audit`** to check accessibility _quality_.

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
| `no-unlabeled-interactive` | An interactive control (button, link, textbox, …) with no accessible name. |
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

## Design

`collectFindings` is deliberately separate from anything that renders it. `@real-a11y-dev/testing` wraps these helpers as Vitest/Jest matchers, the `real-a11y audit` CLI command prints them, and the MCP `audit_page` tool returns them to an agent — but a rule is written **once**, here, and every surface reports it. [`@real-a11y-dev/core`](https://real-a11y.dev/packages/core) stays dependency-free; this package layers the rules on top of core's extracted tree, so consumers who only need extraction don't pay for the audit engine.
