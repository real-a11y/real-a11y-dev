# Real A11y — Agent Skills

Workflow [Agent Skills](https://agentskills.io) that teach coding agents how to
use the published [`@real-a11y-dev`](https://www.npmjs.com/org/real-a11y-dev)
packages.

## Install

```bash
npx skills add real-a11y/skills --skill '*' --yes
```

Docs: [Agent Skills on real-a11y.dev](https://real-a11y.dev/guide/agent-skills)
(or [next.real-a11y.dev](https://next.real-a11y.dev/guide/agent-skills) while
following `main`).

## Skills

| Skill                      | When to use                                |
| -------------------------- | ------------------------------------------ |
| `choose-real-a11y-surface` | Which package / surface fits the job       |
| `wire-up-mcp`              | Connect Real A11y MCP to an agent client   |
| `audit-a-page`             | Audit a live URL with MCP or CLI           |
| `a11y-act-loop`            | Interact via role+name, then diff the tree |
| `a11y-snapshot-tests`      | Vitest / Jest / Playwright a11y snapshots  |
| `gate-ci-a11y`             | CI gates, PR diffs, baselines              |
| `a11y-in-storybook`        | Storybook Semantic Navigator addon         |
| `embed-semantic-navigator` | Embed the panel in React or vanilla apps   |

## Source of truth

Skill bodies are authored in the
[`real-a11y/real-a11y-dev`](https://github.com/real-a11y/real-a11y-dev)
monorepo under `community-skills/`, checked against `docs/surface.json` with
`pnpm surface:check`, then mirrored here for community install. Prefer this
repo for `npx skills add` — do not install skills from the monorepo (that
tree only exposes maintainer workflows).

## License

MIT — see [LICENSE](./LICENSE).
