# Real A11y — community Agent Skills

Workflow skills that teach coding agents how to use the published
[`@real-a11y-dev`](https://www.npmjs.com/org/real-a11y-dev) packages.

This folder is the **staging tree** for the public repo `real-a11y/skills`.
Until that repo exists, treat these files as drafts. Do **not** copy them into
`.claude/skills/` or `.cursor/skills/` inside the Real A11y monorepo — those
paths are for maintainer workflows.

## Install (once published)

```bash
npx skills add real-a11y/skills
```

Or clone and link a single skill into your project:

```bash
# project-local (Cursor / agentskills discovery)
mkdir -p .agents/skills
cp -R path/to/skills/audit-a-page .agents/skills/
```

## Skills

| Skill | When to use |
| --- | --- |
| [`choose-real-a11y-surface`](./choose-real-a11y-surface/) | Which package / surface fits the job |
| [`wire-up-mcp`](./wire-up-mcp/) | Connect Real A11y MCP to an agent client |
| [`audit-a-page`](./audit-a-page/) | Audit a live URL with MCP or CLI |
| [`a11y-act-loop`](./a11y-act-loop/) | Interact via role+name, then diff the tree |
| [`a11y-snapshot-tests`](./a11y-snapshot-tests/) | Vitest / Jest / Playwright a11y snapshots |
| [`gate-ci-a11y`](./gate-ci-a11y/) | CI gates, PR diffs, baselines |
| [`a11y-in-storybook`](./a11y-in-storybook/) | Storybook Semantic Navigator addon |
| [`embed-semantic-navigator`](./embed-semantic-navigator/) | Embed the panel in React or vanilla apps |

## Conventions

- Each skill is a folder with `SKILL.md` ([Agent Skills](https://agentskills.io) format).
- `name` in frontmatter must match the folder name.
- Prefer published docs at [real-a11y.dev](https://real-a11y.dev) over guessing APIs.
- Pin `@beta` (or an exact version) while the family is in public beta.
- Install packages under `devDependencies` — developer-time tooling, not runtime.

## Source of truth

See [docs/maintainers/community-skills.md](../docs/maintainers/community-skills.md)
in the monorepo for the plan, publishing checklist, and sync rules.
