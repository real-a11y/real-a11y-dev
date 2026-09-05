# Community Agent Skills (plan)

Consumer-facing [Agent Skills](https://agentskills.io) that teach coding agents
how to **use** the published `@real-a11y-dev/*` packages. Separate from the
maintainer skills under `.claude/skills/` (`pr`, `release`, `dogfood`, …).

## Decisions

| Choice | Decision |
| --- | --- |
| Home | New public repo **`real-a11y/skills`** (not this monorepo’s skill discovery paths) |
| Slice | **Workflow-oriented** skills that pick the right package, not one skill per npm package |
| Install | `npx skills add real-a11y/skills --skill '*' --yes` once the repo exists |
| Staging | Drafts live in [`community-skills/`](../../community-skills/) in this monorepo until the public repo is cut |
| Public docs | [`website/guide/agent-skills.md`](../../website/guide/agent-skills.md) — linked from getting-started + MCP |

## Sync contract — skills ↔ docs ↔ code

Same split the rest of the repo uses. **Do not generate skills from the
manifest or from website markdown.**

| Layer | Role | Gate |
| --- | --- | --- |
| Code | Source of truth for what exists | extract → `docs/surface.json` |
| Docs | How to use it (hand-written prose) | `pnpm surface:check` (names, samples, anchors, …) |
| Community skills | Agent workflows over those packages | `pnpm surface:check` ghost CLI/MCP names in `community-skills/**/SKILL.md` |
| Plan | What a PR must update | `pnpm surface:plan` / `docs-currency` maps surface diffs → website pages **and** skill files |
| Dogfood | Does the published path still work? | `scenarios/dogfood/D*` (especially D2–D5, D7, D9–D12); D8 for prose/output |

Practical rules:

1. A public-surface change updates website markdown **and** the matching skill in
   the **same PR** (or the sticky docs-currency comment will keep naming the
   skill as untouched).
2. Skills may only cite shipped CLI commands and MCP tools — inventing a name
   fails `surface:check` the same way a ghost tool in `mcp/tools.md` does.
3. Skills must track **published docs** for steps and install lines, not
   monorepo internals. Gaps in the docs are findings, not things to paper over
   in the skill.

Implementation:

- Blocking: [`scripts/surface/check/skills.mjs`](../../scripts/surface/check/skills.mjs) (wired into `surface:check` → `pnpm verify`)
- Advisory: `SKILL_RULES` in [`scripts/surface/plan/obligations.mjs`](../../scripts/surface/plan/obligations.mjs)
- CI refresh: `community-skills/**` on [`.github/workflows/docs-currency.yml`](../../.github/workflows/docs-currency.yml)

## Why a separate repo

- Community installers (`npx skills add owner/repo`) expect a focused skills root,
  not a monorepo full of engine code and maintainer workflows.
- Auto-discovery under `.claude/skills/` / `.cursor/skills/` / `.agents/skills/`
  would load consumer workflows into agents working *on* Real A11y — wrong altitude.
- Versioning and release cadence for skills can lag or lead npm betas without
  coupling to `version-packages`.
- Until that repo is cut, **this monorepo stays the sync source of truth** so
  `surface:check` / `surface:plan` can see skills next to code and docs.

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

## Publishing checklist (cut `real-a11y/skills`)

1. ~~Create the public repo under the `real-a11y` org~~ — done:
   https://github.com/real-a11y/skills
2. ~~Seed Netlify-shaped layout~~ (`skills/<name>/SKILL.md` + README + LICENSE) —
   done. Re-export from this monorepo with
   [`scripts/export-community-skills.sh`](../../scripts/export-community-skills.sh)
   when skill bodies change (cloud agents still lack write access to that repo).
3. Prefer keeping `skills/<name>/SKILL.md` in the public repo; keep a sync path
   from this monorepo’s `community-skills/` (script or CI) so `surface:check`
   still runs against the monorepo copy. **Mirror automation is still TODO.**
4. Tag `v0.1.0` on `real-a11y/skills` (optional but useful for dogfood notes).
5. Confirm `npx skills add real-a11y/skills --skill '*' --yes` still installs all
   eight skills after each mirror push.
6. Land the monorepo PR that adds `community-skills/` + website guide, then cut
   the public mirror **before or with** the npm release that promotes the Agent
   Skills guide to [real-a11y.dev](https://real-a11y.dev).
   `next.real-a11y.dev` shows the page from `main` earlier.
7. Prefer **one canonical authoring home** (this monorepo) and publish a mirror,
   rather than editing both by hand.
8. `community-skills/` is in `LOW_SHAPED` in `scripts/pr-risk.mjs`.

## Out of scope for v1

- Maintainer skills (`pr`, `release`, `dogfood`) — stay private to this repo.
- Packaging skills as npm packages via skillpm.
- Claude Code / Cursor plugin marketplace bundle (MCP + skills + hooks) — follow
  Netlify’s `context-and-tools` packaging after the skills repo exists.
- Auto-generating skill bodies from `docs/surface.json` or website markdown.
