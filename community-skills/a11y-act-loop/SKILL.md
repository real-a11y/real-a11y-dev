---
name: a11y-act-loop
description: >-
  Drive Real A11y interact-then-diff loops: checkpoint the semantic tree, click
  or type by role + accessible name, then diff. Use for MCP checkpoint_tree /
  click_element / type_text / focus_element / diff_tree, or CLI interact / click
  / type / focus with --session.
---

# Accessibility act loop

Target elements the way assistive tech does: **role + accessible name** (optional
`nth`). If the agent cannot find the control that way, that is usually an a11y
finding — do not fall back to inventing CSS selectors.

Docs: https://real-a11y.dev/packages/mcp/tools · https://real-a11y.dev/packages/cli

## MCP canonical loop

1. `open_page` (settle for SPAs as in `audit-a-page`).
2. Optionally `get_semantic_tree` to learn role+name vocabulary on the page.
3. `checkpoint_tree`
4. Act: `click_element` | `type_text` | `focus_element` with role + name (+ `nth`)
5. `diff_tree` — report what changed for a screen reader
6. On full navigation, re-`checkpoint_tree` (new document)
7. Then `audit_page` / `inspect_page` on the post-interaction state if needed

Ambiguous matches: use the printed `nth=N · role "name"` candidates. Never invent
selectors. Do not act without a checkpoint when the goal is “what changed” —
that wastes the loop.

`type_text` must not echo secrets; never use it for login credentials (use
storage-state from `wire-up-mcp` / CLI `login` instead).

## CLI path

```sh
npx real-a11y tree https://example.com
# copy role+name vocabulary into steps:
npx real-a11y interact https://example.com --step 'click button "Sign in"'
# or one-shot:
npx real-a11y click https://example.com --role button --name "Sign in"
```

Use `--session` to keep one live page across commands. Capture snapshot baselines
in a fresh session when combining with `snapshot`/`diff` so session state does
not contaminate regression artifacts. Prefer `--step-settle` / settle flags when
UI updates are async.

Missed role+name targets fail loudly (CLI exit 2 territory) — treat as a finding,
not a tool bug. Disabled targets are refused.

## Safety

Prefer the user’s own site or local fixtures for write actions. Do not drive
destructive clicks on third-party production sites during exploratory dogfood.

## Related

- Setup MCP → `wire-up-mcp`
- Audit only → `audit-a-page`
