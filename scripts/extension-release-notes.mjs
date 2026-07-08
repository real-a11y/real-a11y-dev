// Generate the "What's new" body for an extension GitHub Release.
//
// The extension is changeset-ignored (no CHANGELOG.md) and bundles its workspace
// dependencies at build time (vite), so its release notes span several packages
// — the extension plus everything it inlines — since the *previous* extension-v*
// tag. Built-in GitHub release notes can't path-filter, so they'd drag in all
// the npm-only work (validate, testing, docs) that never ships in the extension.
//
// This collects the conventional-commit subjects in that range for the bundled
// surface, keeps only the user-facing types (feat/fix/perf), groups them, and
// emits markdown for the draft release body (extension-release.yml feeds it in
// via `body_path`). It's a starting draft — the maintainer reviews it, and the
// user-facing Chrome Web Store copy is still polished by hand.
//
// Usage:
//   node scripts/extension-release-notes.mjs --version 0.1.6 \
//     [--since extension-v0.1.4] [--zip <name>] [--size <bytes>]
//
// --since overrides the auto-detected previous tag (useful when a tagged version
// was skipped on the Web Store, so notes should be cumulative).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGES = join(ROOT, "packages");
const REPO = "https://github.com/real-a11y/real-a11y-dev";
const EXTENSION = "@real-a11y-dev/semantic-navigator-extension";

const argv = process.argv.slice(2);
const arg = (name, fallback = "") => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? (argv[i + 1] ?? fallback) : fallback;
};

const version = arg("version");
const sinceOverride = arg("since");
const zip = arg("zip");
const size = arg("size");

if (!version) {
  console.error("extension-release-notes: --version is required");
  process.exit(1);
}

const git = (args) =>
  execFileSync("git", args, { encoding: "utf8", cwd: ROOT }).trim();

// Map every @real-a11y-dev package name → its repo-relative directory. Dirs
// don't always match the scoped name (semantic-navigator-ui lives in
// packages/ui), so read each manifest instead of guessing.
function packageDirsByName() {
  const byName = new Map();
  for (const dir of readdirSync(PACKAGES)) {
    const manifest = join(PACKAGES, dir, "package.json");
    if (!existsSync(manifest)) continue;
    const { name } = JSON.parse(readFileSync(manifest, "utf8"));
    if (name) byName.set(name, `packages/${dir}`);
  }
  return byName;
}

// The bundled surface = the extension itself + its workspace `dependencies`
// (vite inlines them into the build). Derived from the manifest so it never
// drifts as the extension's deps change.
function bundledPaths() {
  const byName = packageDirsByName();
  const extDir = byName.get(EXTENSION) ?? "packages/extension";
  const manifest = JSON.parse(
    readFileSync(join(ROOT, extDir, "package.json"), "utf8"),
  );
  const paths = new Set([extDir]);
  for (const dep of Object.keys(manifest.dependencies ?? {})) {
    if (byName.has(dep)) paths.add(byName.get(dep));
  }
  return [...paths];
}

const parseVersion = (v) => v.split(".").map((n) => parseInt(n, 10) || 0);
function cmpVersion(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

// Previous extension tag: the override, or the highest extension-v* strictly
// below this version.
let prevTag = sinceOverride;
if (!prevTag) {
  try {
    prevTag =
      git(["tag", "-l", "extension-v*"])
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean)
        .map((tag) => ({ tag, v: tag.replace(/^extension-v/, "") }))
        .filter((t) => cmpVersion(t.v, version) < 0)
        .sort((a, b) => cmpVersion(b.v, a.v))[0]?.tag ?? "";
  } catch {
    prevTag = "";
  }
}

// Commit subjects in range, restricted to the bundled surface.
const range = prevTag ? `${prevTag}..HEAD` : "HEAD";
let subjects = [];
try {
  const out = git([
    "log",
    range,
    "--no-merges",
    "--format=%s",
    "--",
    ...bundledPaths(),
  ]);
  subjects = out ? out.split("\n").filter(Boolean) : [];
} catch {
  subjects = [];
}

// Parse conventional commits; keep only the user-facing types.
const GROUPS = [
  { title: "New", types: ["feat"], items: [] },
  { title: "Improvements & fixes", types: ["fix", "perf"], items: [] },
];
const CONVENTIONAL = /^(\w+)(?:\([^)]*\))?!?:\s*(.+)$/;

for (const subject of subjects) {
  const m = subject.match(CONVENTIONAL);
  if (!m) continue;
  const [, type, descRaw] = m;
  const group = GROUPS.find((g) => g.types.includes(type));
  if (!group) continue; // skip chore/ci/test/docs/refactor/build/style
  // Capitalize; leave any trailing "(#123)" so GitHub auto-links it.
  group.items.push(descRaw.charAt(0).toUpperCase() + descRaw.slice(1));
}

// Assemble the markdown.
const lines = [`## What's new in ${version}`, ""];
if (GROUPS.some((g) => g.items.length)) {
  for (const g of GROUPS) {
    if (!g.items.length) continue;
    lines.push(`### ${g.title}`, "");
    for (const item of g.items) lines.push(`- ${item}`);
    lines.push("");
  }
} else {
  lines.push(
    "Maintenance release — build, dependency, and internal updates.",
    "",
  );
}

lines.push(
  "---",
  "",
  "**Manual upload to the Chrome Web Store is still required** — see " +
    `[\`docs/maintainers/publishing.md\`](${REPO}/blob/main/docs/maintainers/publishing.md).`,
);
if (zip) lines.push("", `Zip: \`${zip}\`${size ? ` (${size} bytes)` : ""}`);
if (prevTag)
  lines.push(
    "",
    `**Full diff:** ${REPO}/compare/${prevTag}...extension-v${version}`,
  );

process.stdout.write(lines.join("\n") + "\n");
