// The manifest: assemble it, and serialize it the same way every time.
//
// `docs/surface.json` is committed, so its diff is a reviewable statement of
// what moved in the public surface — that is what a later phase turns into a
// PR's doc-and-scenario obligations. A diff is only worth reading if it's
// stable, so key order is fixed here rather than left to insertion order.

import { extractApi } from "./extract/api.mjs";
import { extractCli } from "./extract/cli.mjs";
import { extractEnv } from "./extract/env.mjs";
import { extractMcp } from "./extract/mcp.mjs";
import { extractPackages } from "./extract/packages.mjs";

/**
 * Bumped when the manifest's SHAPE changes, not its content. A `check` run
 * against a manifest written by an older layout should say "regenerate it",
 * not report a hundred spurious surface changes.
 */
export const MANIFEST_VERSION = 2;

export async function buildManifest(repoRoot) {
  // Independent reads; the MCP one boots a server, so don't serialize them.
  const [cli, mcp, packages, env] = await Promise.all([
    extractCli(repoRoot),
    extractMcp(repoRoot),
    extractPackages(repoRoot),
    extractEnv(repoRoot),
  ]);
  // After `packages`, because it reads their `exports` maps — and sequential
  // on purpose: it imports every built entry point, which is side-effecting in
  // a way the other extractors are not.
  const api = await extractApi(repoRoot, packages);

  return { manifestVersion: MANIFEST_VERSION, cli, mcp, packages, api, env };
}

/** Recursively sort object keys; arrays keep the order the extractor chose. */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

/**
 * Serialize for disk. Trailing newline, and LF regardless of platform — the
 * repo normalizes line endings and a CRLF write here would show up as a whole-
 * file diff on Windows.
 */
export function serialize(manifest) {
  return `${JSON.stringify(sortKeys(manifest), null, 2)}\n`;
}
