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
cp "$SRC/README.skills-repo.md" "$DEST/README.md"

echo "$DEST"
