---
title: Agent Skills
description: Workflow skills that teach coding agents how to use the published Real A11y packages — install with npx skills add real-a11y/skills.
---

# Agent Skills

[Agent Skills](https://agentskills.io) are portable folders of instructions that
coding agents (Cursor, Claude Code, Codex, and others) load on demand. Real A11y
ships a small set of **workflow** skills so an agent can pick the right package,
wire up MCP, audit a page, write snapshot tests, or gate CI — without guessing
from memory.

They complement the [MCP server](/packages/mcp): MCP exposes **tools** (audit,
tree, act); skills teach **when and how** to use those tools and the other
surfaces (CLI, testing, Storybook, embeds).

## Skills (v1)

| Skill | Use when… |
| --- | --- |
| `choose-real-a11y-surface` | You need to pick CLI vs testing vs MCP vs panel vs Storybook vs the extension |
| `wire-up-mcp` | Connecting `@real-a11y-dev/mcp` to Cursor, Claude, VS Code, or another client |
| `audit-a-page` | Auditing a live URL with MCP or the CLI |
| `a11y-act-loop` | Clicking / typing by role + accessible name, then diffing the tree |
| `a11y-snapshot-tests` | Adding Vitest / Jest / Playwright a11y snapshots and `flow()` |
| `gate-ci-a11y` | CI gates, PR snapshot → diff, baselines |
| `a11y-in-storybook` | Adding the Storybook Semantic Navigator addon |
| `embed-semantic-navigator` | Embedding the panel with `@real-a11y-dev/react` or `inspector` |

## Install

```sh
npx skills add real-a11y/skills --skill '*' --yes
```

Pin `@beta` (or an exact version) on any `@real-a11y-dev/*` package the skill
installs while the family is in public beta. Keep packages under
`devDependencies`.

## MCP + skills together

1. Connect the MCP server — see [Connect it to your client](/packages/mcp#connect-it-to-your-client).
2. Install the skills so the agent loads the audit / act-loop workflows.
3. Ask in plain language (“Audit localhost:3000”, “Open the dialog then re-check”).

Skills never replace reading the package docs. When a skill and
[real-a11y.dev](/guide/getting-started) disagree, **the docs win** — and that
disagreement is a bug to report.

## Keeping skills current

Skills are hand-written workflows. In the Real A11y monorepo they are checked
against the same public-surface inventory as the website (`docs/surface.json`):
a skill that names a removed CLI command or MCP tool fails `pnpm surface:check`,
and `pnpm surface:plan` nags when a surface change should update a skill. See
the maintainer note in the repo under `docs/maintainers/community-skills.md`.
