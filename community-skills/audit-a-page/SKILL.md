---
name: audit-a-page
description: >-
  Audit a live URL with Real A11y via MCP (audit_page / inspect_page) or the
  CLI (real-a11y audit / tree / outline / tabs). Use when the user wants
  screen-reader fidelity findings, a semantic tree dump, heading outline, or
  tab order for a page — public, local, or staging.
---

# Audit a page with Real A11y

Same engine, two surfaces. Prefer **MCP** when an agent session already has the
server connected; prefer **CLI** for shell/CI one-shots.

Docs: https://real-a11y.dev/packages/mcp · https://real-a11y.dev/packages/cli

## MCP path

1. Ensure MCP is wired (`wire-up-mcp`). Browser installed via `npx real-a11y install`.
2. `open_page` with the URL. For SPAs use `waitUntil: "networkidle"` and/or
   `settleMs`. Pass `device` when auditing mobile layouts.
3. Prefer `inspect_page` for a single coherent read on dynamic pages; otherwise
   `audit_page` plus views as needed:
   - `get_semantic_tree`
   - `get_heading_outline`
   - `get_tab_order`
   - `list_elements`
4. Explain findings in plain language and propose concrete fixes.
5. Optional findings loop: `checkpoint_findings` → change → `diff_findings`.
6. `close_browser` when finished.

Respect tool output caps (~40k chars). Do not invent CSS selectors for later
acts — use role + accessible name (see `a11y-act-loop`).

## CLI path

```sh
npm i -D @real-a11y-dev/cli@beta playwright
npx real-a11y install
npx real-a11y audit https://example.com
```

Useful companions:

```sh
npx real-a11y tree https://example.com
npx real-a11y outline https://example.com
npx real-a11y tabs https://example.com
npx real-a11y inspect https://example.com
```

- `audit` exits **1** on error-severity findings (CI gate).
- Unreachable URL must exit **2** (or equivalent failure) — never a clean “no
  issues” report.
- There is **no** `--producer` flag. Only `tabs` takes `--root`.
- Optional project config: `a11y.config.json` (`defaults`, `urls`).

Auth: use `real-a11y login … --save` + storage-state flags/env — never type
passwords into agent tool calls. Guide:
https://real-a11y.dev/guide/authenticated-pages

## Scope reminder

Not a full WCAG/axe suite. Say so when the user expects exhaustive rule
coverage; pair with axe when needed.

## Next

- Interact after open → `a11y-act-loop`
- CI / PR diffs → `gate-ci-a11y`
