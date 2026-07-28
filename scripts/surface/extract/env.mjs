// Environment variables the packages read.
//
// Configuration is public surface — the MCP server is configured ENTIRELY
// through env vars, deliberately, so credentials never become tool parameters.
// A variable that gets renamed and not documented is a silently broken setup
// with no error message, which is the worst kind.
//
// This is the one extractor that reads text rather than values: an env var is
// looked up by name at an arbitrary point in a function body, so there is no
// object to import. It stays structural by matching property ACCESS only —
// never a bare word that happens to be shouty, and never a name that appears
// solely inside a help string.
//
// Matching on the name's prefix rather than on `process.env` is deliberate.
// `chrome.ts` takes its environment as a parameter for testability and reads
// `env.REAL_A11Y_BROWSERS_DIR`, so a `process\.env` pattern missed a variable
// the CLI's own help text advertises. A property named `REAL_A11Y_*` is ours
// wherever it is read from.

import { readdir, readFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

/** `.REAL_A11Y_NAME` and `["REAL_A11Y_NAME"]`, on any receiver. */
const LOOKUP =
  /(?:\.|\[\s*["'])((?:REAL_A11Y|A11Y)_[A-Z0-9_]+)(?=["'\s\];,)}]|$)/g;

async function* sourceFiles(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      yield* sourceFiles(full);
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      yield full;
    }
  }
}

export async function extractEnv(repoRoot) {
  const found = new Map(); // name → Set of package dirs

  for await (const file of sourceFiles(join(repoRoot, "packages"))) {
    const pkg = relative(join(repoRoot, "packages"), file).split(sep)[0];
    const text = await readFile(file, "utf8");
    for (const match of text.matchAll(LOOKUP)) {
      const name = match[1];
      if (!found.has(name)) found.set(name, new Set());
      found.get(name).add(pkg);
    }
  }

  return [...found.entries()]
    .map(([name, packages]) => ({ name, packages: [...packages].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
