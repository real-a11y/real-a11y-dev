---
title: "@real-a11y-dev/testing — a11y audits for Vitest, Jest, Playwright"
description: Deterministic snapshots and structural assertions for the accessibility tree. Works in jsdom out of the box; Playwright adapter ships for real-browser E2E.
---

# @real-a11y-dev/testing

> **TL;DR** — Accessibility-tree snapshots, structural assertions, custom `expect` matchers, and a fluent `flow()` interaction chain. Works in jsdom (Vitest / Jest) out of the box; add `@real-a11y-dev/testing/playwright` for real-browser E2E. Reach for this **in your test suite** — unit and e2e alike.

Headless accessibility audit helpers for Vitest, Jest, and Playwright. No browser required for the core helpers — they work in jsdom.

## Install

```sh
npm install -D @real-a11y-dev/testing
```

## What's in the box

| Area | What it does | Page |
|---|---|---|
| **Snapshots** | Deterministic strings of the a11y tree, heading outline, and tab order — diff-friendly, safe to commit. | [Snapshots →](/packages/testing/snapshots) |
| **Assertions** | `assert*` functions that throw descriptive errors on broken structure. | [Assertions →](/packages/testing/assertions) |
| **Matchers** | The same checks as ergonomic `expect` matchers, plus the `a11ySnapshot()` serializer. Vitest + Jest. | [Matchers →](/packages/testing/matchers) |
| **Flow API** | Fluent interaction chains that assert about the tree after each step. | [Flow API →](/packages/testing/flow) |
| **Playwright adapter** | Run every helper against a real browser page via `attach(page)`. | [Playwright →](/packages/testing/playwright) |

New to the idea of snapshotting the accessibility tree? Start with the concept: [**Accessibility Snapshots**](/guide/accessibility-snapshots).

## Which do I reach for?

- **Catch regressions in CI** → [Snapshots](/packages/testing/snapshots) (`auditSnapshot`, `outlineSnapshot`, `tabSequenceSnapshot`) committed with `toMatchSnapshot()`. For **headless page-set audits** of a deployed site — no test suite — reach for [`@real-a11y-dev/cli`](/packages/cli)'s `snapshot` / `diff` instead.
- **Assert a specific invariant** ("one `<h1>`", "no unlabeled buttons") → [Assertions](/packages/testing/assertions) or, for `expect` style, [Matchers](/packages/testing/matchers).
- **Test an interaction** (open a menu, submit a form, dismiss a modal) → [Flow API](/packages/testing/flow).
- **Assert what an interaction _changed_** (options appeared, `aria-expanded` flipped, focus moved) → [`capture` + `a11yDiff` or `flow().expectChanges`](/packages/testing/flow#asserting-what-an-interaction-changed).
- **Audit a real, rendered page** (not jsdom) → [Playwright adapter](/packages/testing/playwright).

## See it running

- **Vitest + jsdom** — [`examples/testing-vitest/`](https://github.com/real-a11y/real-a11y-dev/tree/main/examples/testing-vitest): snapshot tests, the custom matchers, `flow()` interactions, tab-sequence structure assertions.
- **Jest + ts-jest** — [`examples/testing-jest/`](https://github.com/real-a11y/real-a11y-dev/tree/main/examples/testing-jest): the minimal Jest setup for the matchers.
- **Playwright E2E** — [`examples/playwright/`](https://github.com/real-a11y/real-a11y-dev/tree/main/examples/playwright): a "good fixture" where every assertion passes and a "broken fixture" where each throws — the pattern to keep in CI.
- **CI tree-diff bot** — the [CI Diff Bot recipe](/guide/ci-diff-bot) runs [`@real-a11y-dev/cli`](/packages/cli)'s `real-a11y snapshot` (each audited page → one diffable JSON artifact) and `real-a11y diff` (new / changed / fixed findings) in a PR workflow.
