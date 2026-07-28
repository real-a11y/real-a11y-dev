// Package identity: what ships, at what version, with which entry points.
//
// The export subpaths matter as much as the names — `./matchers/vitest`
// resolving is the difference between a documented import working and throwing
// at call time. Recording them here is what lets a later phase check that every
// subpath a doc tells someone to import is one the package actually declares.

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export async function extractPackages(repoRoot) {
  const dir = join(repoRoot, "packages");
  const names = (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const packages = [];
  for (const name of names) {
    let manifest;
    try {
      manifest = JSON.parse(
        await readFile(join(dir, name, "package.json"), "utf8"),
      );
    } catch {
      continue; // a directory without a manifest isn't a package
    }

    packages.push({
      dir: name,
      name: manifest.name,
      version: manifest.version ?? null,
      private: manifest.private === true,
      description: manifest.description ?? "",
      bin: Object.keys(manifest.bin ?? {}).sort(),
      exports: Object.keys(manifest.exports ?? {})
        .filter((subpath) => subpath !== "./package.json")
        .sort(),
      // Workspace edges only — the dependency graph the architecture page
      // draws. External deps churn on every lockfile bump and would make the
      // manifest diff noise rather than signal.
      workspaceDeps: Object.entries({
        ...manifest.dependencies,
        ...manifest.peerDependencies,
      })
        .filter(([, range]) => String(range).startsWith("workspace:"))
        .map(([dep]) => dep)
        .sort(),
    });
  }
  return packages;
}
