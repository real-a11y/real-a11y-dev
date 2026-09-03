# Community Agent Skills (plan)

Consumer-facing [Agent Skills](https://agentskills.io) that teach coding agents
how to **use** the published `@real-a11y-dev/*` packages. Separate from the
maintainer skills under `.claude/skills/` (`pr`, `release`, `dogfood`, …).

## Decisions

| Choice | Decision |
| --- | --- |
| Home | New public repo **`real-a11y/skills`** (not this monorepo’s skill discovery paths) |
| Slice | **Workflow-oriented** skills that pick the right package, not one skill per npm package |
| Install | `npx skills add real-a11y/skills` (skills.sh / agentskills.io) once the repo exists |
| Staging | Drafts live in [`community-skills/`](../../community-skills/) in this monorepo until the public repo is cut |

## Why a separate repo

- Community installers (`npx skills add owner/repo`) expect a focused skills root,
  not a monorepo full of engine code and maintainer workflows.
- Auto-discovery under `.claude/skills/` / `.cursor/skills/` / `.agents/skills/`
  would load consumer workflows into agents working *on* Real A11y — wrong altitude.
- Versioning and release cadence for skills can lag or lead npm betas without
  coupling to `version-packages`.

## Skill series (v1)

| Skill | Job | Packages it steers toward |
| --- | --- | --- |
| `choose-real-a11y-surface` | Router: map intent → surface | none (routes only) |
| `wire-up-mcp` | Connect MCP to Cursor / Claude / VS Code | `@real-a11y-dev/mcp`, often `cli` for install/login |
| `audit-a-page` | Audit a live URL (MCP or CLI) | `mcp` or `cli` |
| `a11y-act-loop` | checkpoint → act by role+name → diff | `mcp` and/or `cli` |
| `a11y-snapshot-tests` | Vitest/Jest/Playwright tree snapshots + `flow()` | `testing` |
| `gate-ci-a11y` | CI gate, snapshot/diff, baselines, SARIF | `cli` |
| `a11y-in-storybook` | Storybook 8 Semantic Navigator addon | `storybook-addon` |
| `embed-semantic-navigator` | Embed panel in React or vanilla apps | `react` or `inspector` |

Chrome extension (no npm install) is covered only as a router tip in
`choose-real-a11y-surface`, with a link to the extension guide — not a separate
skill in v1.

## Source of truth

Skills must track **published docs**, not monorepo internals:

- Package guides: `https://real-a11y.dev/packages/{cli,mcp,testing,react,inspector,storybook-addon}`
- Dogfood pitfalls: `scenarios/dogfood/D*.md` (especially D2–D5, D7, D9–D12)
- Surface picker: root `README.md` “Pick your surface”

When a public surface changes, update the matching skill in the same PR that
updates website markdown (or open a follow-up in `real-a11y/skills` immediately
after). Skills that invent setup steps not in the published docs will fail the
same way dogfood sessions do.

## Publishing checklist (cut `real-a11y/skills`)

1. Create the empty public repo under the `real-a11y` org (human / org admin).
2. Copy `community-skills/` contents to the repo root (each skill folder + README).
3. Add MIT `LICENSE`, keep skill `name` matching folder names.
4. Tag `v0.1.0`; confirm install: `npx skills add real-a11y/skills`.
5. Link from `https://real-a11y.dev` getting-started / MCP pages (“Agent skills”).
6. Stop editing drafts in this monorepo once the public repo is the canonical tree
   (or keep a sync script — prefer one canonical home).
7. If `community-skills/` remains in this monorepo as a mirror, add it to
   `LOW_SHAPED` in `scripts/pr-risk.mjs` (inert prose, same class as `docs/` /
   `examples/`) in a dedicated PR — touching `scripts/` is high-risk on its own.

## Out of scope for v1

- Maintainer skills (`pr`, `release`, `dogfood`) — stay private to this repo.
- Packaging skills as npm packages via skillpm.
- Claude Code plugin marketplace bundle (MCP + skills + hooks) — nice follow-up
  once the skills repo exists.
- Auto-generating skills from `docs/surface.json` — keep hand-written workflows;
  the surface manifest still gates docs currency for the packages themselves.
