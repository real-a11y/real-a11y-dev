// Every symbol the docs import from a workspace package actually exists.
//
// This is the library-API counterpart to `check/samples.mjs`, which runs the
// CLI invocations in the docs through the real parser. Same idea, other half of
// the product: eleven of the thirteen published packages are libraries, and
// until now nothing checked a single line of their documentation against them.
// `@real-a11y-dev/testing` has five doc pages and fifty-eight exported names.
//
// Only IMPORT STATEMENTS are checked, not every code span. A doc page is full of
// identifiers — parameter names, local variables, roles — and demanding that all
// of them be exports would produce a check nobody could keep green. An import is
// different: it is an unambiguous claim that a name is part of the package's
// surface, and if it is wrong the snippet is copy-paste-broken.
//
// Both halves of the surface count. `values` come from importing the built
// module, `types` from the emitted `.d.ts`. Checking against values alone flagged
// 23 correct imports as broken — `SemanticNode`, `ExtractionResult`,
// `AttachOptions` — because a type has no runtime existence. A check that fails
// on correct docs is worse than no check; it gets muted, and takes the real
// failures with it.

import { docFiles, readDoc } from "./markdown.mjs";

/** `@real-a11y-dev/testing/playwright` → the names that entry point exports. */
function surfaceIndex(manifest) {
  const index = new Map();
  for (const pkg of manifest.api ?? []) {
    for (const entry of pkg.entries) {
      const specifier = pkg.name + entry.subpath.slice(1);
      index.set(specifier, new Set([...entry.values, ...(entry.types ?? [])]));
    }
  }
  return index;
}

const IMPORT =
  /import\s*(?:type\s+)?\{([^}]+)\}\s*from\s*["'](@real-a11y-dev\/[^"']+)["']/g;

/**
 * @returns {Promise<{where: string, message: string}[]>}
 */
export async function checkApiImports(repoRoot, manifest) {
  const index = surfaceIndex(manifest);
  if (index.size === 0) {
    return [
      {
        where: "docs/surface.json",
        message:
          `has no \`api\` section, so no documented import could be checked. ` +
          `Extraction reads built artifacts — run \`pnpm build\` then ` +
          `\`pnpm surface:extract\`. Reporting this rather than passing silently: ` +
          `an empty index would make every page look verified.`,
      },
    ];
  }

  const problems = [];
  let checked = 0;

  for (const relPath of await docFiles(repoRoot)) {
    const text = await readDoc(repoRoot, relPath);

    for (const match of text.matchAll(IMPORT)) {
      const specifier = match[2];
      const known = index.get(specifier);

      // An unknown specifier is its own finding: either the subpath was removed
      // from the exports map — in which case the import fails for a reader too —
      // or it never existed.
      if (!known) {
        problems.push({
          where: relPath,
          message:
            `imports from \`${specifier}\`, which is not an entry point any ` +
            `package exports. Check the \`exports\` map — a subpath that isn't ` +
            `there fails at install time for anyone who copies this.`,
        });
        continue;
      }

      for (let name of match[1].split(",")) {
        name = name
          .trim()
          .replace(/^type\s+/, "")
          .split(/\s+as\s+/)[0]
          .trim();
        if (!name) continue;
        checked++;
        if (!known.has(name)) {
          problems.push({
            where: relPath,
            message:
              `imports \`${name}\` from \`${specifier}\`, which doesn't export ` +
              `it — not as a value and not as a type. Copying this snippet gives ` +
              `an error from a tool the reader was told to trust.`,
          });
        }
      }
    }
  }

  // The silent-success shape: a regex that stops matching reports a clean run
  // forever. The docs import from these packages on many pages, so zero means
  // the scanner broke, not that the docs got smaller — the same guard
  // `checkSamples` has for the same reason.
  if (checked === 0) {
    problems.push({
      where: "website/",
      message:
        `no imports from \`@real-a11y-dev/*\` were found in any doc page. The ` +
        `pages do import from them, so the scanner stopped matching rather than ` +
        `the docs going quiet.`,
    });
  }

  return problems;
}
