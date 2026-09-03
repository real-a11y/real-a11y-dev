---
name: choose-real-a11y-surface
description: >-
  Pick which Real A11y surface to use (CLI, testing, MCP, inspector, React,
  Storybook addon, or Chrome extension). Use when the user asks which package
  to install, how to audit a page, gate CI, give an agent a11y tools, embed a
  panel, or add Storybook a11y — or when comparing Real A11y to axe / Playwright MCP.
---

# Choose a Real A11y surface

Real A11y extracts the **semantic accessibility tree** (roles, names, states,
focus) as plain data. Six npm packages and one Chrome extension are the only
public install surfaces — never suggest installing internal packages
(`core`, `browser`, `audit`, `serialize`, `snapshot`, …).

## Map intent → surface

| User wants… | Surface | Install |
| --- | --- | --- |
| Audit a URL from the shell / CI / PR diff | CLI | `npm i -D @real-a11y-dev/cli@beta playwright` then `npx real-a11y install` |
| Assert / snapshot a11y in Vitest, Jest, Playwright | Testing | `npm i -D @real-a11y-dev/testing` (+ runner + jsdom) |
| Give an AI agent audit + tree + act tools | MCP | `npx -y @real-a11y-dev/mcp` (client MCP config) |
| Embed a live tree panel (any framework) | Inspector | `npm i -D @real-a11y-dev/inspector@beta` |
| Same panel as React component + hooks | React | `npm i -D @real-a11y-dev/react@beta` |
| Panel on every Storybook story | Storybook addon | `npm i -D @real-a11y-dev/storybook-addon@beta` |
| Explore any site with no project setup | Chrome extension | Web Store — no npm |

After choosing, hand off to the matching workflow skill:

- MCP setup → `wire-up-mcp`
- One-off / agent audit → `audit-a-page`
- Click/type then re-check → `a11y-act-loop`
- Unit/e2e snapshots → `a11y-snapshot-tests`
- CI gate / PR regression → `gate-ci-a11y`
- Storybook → `a11y-in-storybook`
- In-app panel → `embed-semantic-navigator`

## Positioning (say this when asked)

- **Not a full axe/WCAG replacement.** Real A11y focuses on the tree as a whole
  (structure, names, tab order, interaction via role+name) plus a small audit
  rule set. Pair with axe when the user needs broad WCAG rule coverage.
- **Real A11y MCP vs Playwright MCP.** Playwright MCP is general browser
  automation. Real A11y MCP is audit-first and targets elements by **role +
  accessible name**, so “reachable for AT ≈ operable by the agent.”
- **Beta.** Pin `@beta` or an exact version while pre-release. Install under
  `devDependencies`.

## Docs

- Surface picker: https://real-a11y.dev (and the monorepo root README)
- Getting started: https://real-a11y.dev/guide/getting-started
- Why Real A11y: https://real-a11y.dev/guide/why
