// Run publint and @arethetypeswrong/cli against every public package.
//
// `publint` checks for common mistakes in package.json (broken `exports`
// maps, missing types, dual-package hazards). `attw` does the same job
// from the consumer angle — it actually packs each entry and resolves
// it as Node 10 / Node 16 / bundler / etc., catching the "types
// masquerade as ESM but JS is CJS" trap that publint won't always see.
//
// Together they cover the audit's #36 (tree-shakeability + dual-package
// hygiene) gap. Wired into CI via `pnpm packaging:check`.

import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(import.meta.url), "../..");
const packagesDir = resolve(repoRoot, "packages");

// attw can't resolve CSS-only exports (it expects JS/TS for every entrypoint),
// so packages with a stylesheet subpath skip that one. Listed here so the
// exemption is visible at the top of the file rather than buried inline.
const ATTW_EXCLUDE_ENTRYPOINTS = {
  "@real-a11y-dev/semantic-navigator-ui": ["styles"],
};

async function findPublicPackages() {
  const out = [];
  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgPath = resolve(packagesDir, entry.name, "package.json");
    let pkg;
    try {
      pkg = JSON.parse(await readFile(pkgPath, "utf8"));
    } catch {
      continue;
    }
    if (pkg.private) continue;
    out.push({ dir: resolve(packagesDir, entry.name), name: pkg.name });
  }
  return out;
}

function run(cmd, args, opts = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
      ...opts,
    });
    child.on("exit", (code) => resolveRun(code ?? 1));
  });
}

const pkgs = await findPublicPackages();
if (pkgs.length === 0) {
  console.error("No public packages found under packages/.");
  process.exit(1);
}

let failures = 0;

for (const pkg of pkgs) {
  console.log(`\n──────── ${pkg.name} ────────`);

  const publintCode = await run("pnpm", ["exec", "publint", "--strict"], {
    cwd: pkg.dir,
  });
  if (publintCode !== 0) failures++;

  const attwArgs = ["exec", "attw", "--pack", ".", "--profile", "esm-only"];
  const exclude = ATTW_EXCLUDE_ENTRYPOINTS[pkg.name];
  if (exclude && exclude.length > 0) {
    attwArgs.push("--exclude-entrypoints", ...exclude);
  }
  const attwCode = await run("pnpm", attwArgs, { cwd: pkg.dir });
  if (attwCode !== 0) failures++;
}

if (failures > 0) {
  console.error(
    `\n${failures} packaging issue(s) reported by publint/attw across ${pkgs.length} package(s).`,
  );
  process.exit(1);
}

console.log(`\nAll ${pkgs.length} packages pass publint + attw.`);
