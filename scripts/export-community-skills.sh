#!/usr/bin/env bash
# Export community-skills/ into the Netlify-shaped layout used by real-a11y/skills.
#
# Usage:
#   scripts/export-community-skills.sh [dest-dir]
#
# Default dest is a temp directory; prints the path. To seed the empty public
# repo (needs write access to real-a11y/skills):
#
#   DEST=$(scripts/export-community-skills.sh)
#   cd "$DEST"
#   git init -b main
#   git add .
#   git commit -m "feat: initial Real A11y agent skills"
#   git remote add origin https://github.com/real-a11y/skills.git
#   git push -u origin main

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/community-skills"
DEST="${1:-$(mktemp -d)/real-a11y-skills}"

if [[ ! -d "$SRC" ]]; then
  echo "missing $SRC" >&2
  exit 1
fi

mkdir -p "$DEST/skills"
for d in "$SRC"/*/; do
  name="$(basename "$d")"
  mkdir -p "$DEST/skills/$name"
  cp "$d/SKILL.md" "$DEST/skills/$name/"
done

cp "$ROOT/LICENSE" "$DEST/LICENSE"

cat >"$DEST/README.md" <<'EOF'
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

| Skill | When to use |
| --- | --- |
| `choose-real-a11y-surface` | Which package / surface fits the job |
| `wire-up-mcp` | Connect Real A11y MCP to an agent client |
| `audit-a-page` | Audit a live URL with MCP or CLI |
| `a11y-act-loop` | Interact via role+name, then diff the tree |
| `a11y-snapshot-tests` | Vitest / Jest / Playwright a11y snapshots |
| `gate-ci-a11y` | CI gates, PR diffs, baselines |
| `a11y-in-storybook` | Storybook Semantic Navigator addon |
| `embed-semantic-navigator` | Embed the panel in React or vanilla apps |

## Source of truth

Skill bodies are authored in the
[`real-a11y/real-a11y-dev`](https://github.com/real-a11y/real-a11y-dev)
monorepo under `community-skills/`, checked against `docs/surface.json` with
`pnpm surface:check`, then mirrored here for community install. Prefer this
repo for `npx skills add` — do not install skills from the monorepo (that
tree only exposes maintainer workflows).

## License

MIT — see [LICENSE](./LICENSE).
EOF

echo "$DEST"
