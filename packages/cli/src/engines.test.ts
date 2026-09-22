// The CLI advertises `engines.node` — and every package it installs has to
// agree. `@puppeteer/browsers@3.x` requires Node >=22.12, so installing the
// CLI on Node 20 (the version `engines` and the docs pin) always printed
//   EBADENGINE Unsupported engine: @puppeteer/browsers@3.2.1
// which reads as a broken install while everything actually worked. Nothing
// failed, so nothing caught it; the next Dependabot major bump would bring it
// straight back. This test makes the whole class a build failure: walk the
// installed RUNTIME dependency closure (what `npm i @real-a11y-dev/cli` pulls
// in) and require each package's `engines.node` to admit the CLI's floor.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import semver from "semver";
import { describe, expect, it } from "vitest";

interface Manifest {
  name: string;
  version: string;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const cliDir = join(dirname(fileURLToPath(import.meta.url)), "..");

function readManifest(dir: string): Manifest {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

/**
 * Node's own lookup: `node_modules/<name>` in `fromDir`, then in each parent.
 * Reads the directory, not `require("<name>/package.json")` — packages with an
 * `exports` map (`@puppeteer/browsers` is one) refuse that subpath.
 */
function findPackageDir(fromDir: string, name: string): string | null {
  for (let dir = fromDir; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) {
      return realpathSync(candidate);
    }
    if (dirname(dir) === dir) return null;
  }
}

/** Every installed runtime dependency of `rootDir`, transitively, once each. */
function runtimeClosure(rootDir: string): Manifest[] {
  const seen = new Map<string, Manifest>();
  const visit = (dir: string, isRoot: boolean): void => {
    const manifest = readManifest(dir);
    const key = `${manifest.name}@${manifest.version}`;
    if (!isRoot) {
      if (seen.has(key)) return;
      seen.set(key, manifest);
    }
    const deps = {
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
    };
    for (const name of Object.keys(deps)) {
      const depDir = findPackageDir(dir, name);
      // An optional dependency for another platform is legitimately absent.
      if (depDir) visit(depDir, false);
    }
  };
  visit(rootDir, true);
  return [...seen.values()];
}

describe("runtime dependencies accept the CLI's Node floor", () => {
  const cli = readManifest(cliDir);
  const range = cli.engines?.node;
  const floor = range ? semver.minVersion(range) : null;

  it("declares a Node engines floor", () => {
    expect(floor).not.toBeNull();
  });

  it("installs nothing that warns EBADENGINE on the lowest Node it advertises", () => {
    const closure = runtimeClosure(cliDir);
    // Sanity: the walk actually found the tree, so a pass means something.
    expect(closure.some((m) => m.name === "@puppeteer/browsers")).toBe(true);

    const rejecting = closure
      .filter((m) => m.engines?.node)
      .filter((m) => !semver.satisfies(floor!, m.engines!.node!))
      .map((m) => `${m.name}@${m.version} requires node ${m.engines!.node}`);

    expect(rejecting, `CLI engines is ${range} (floor ${floor})`).toEqual([]);
  });
});
