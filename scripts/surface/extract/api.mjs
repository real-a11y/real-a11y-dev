// What the library packages export — by importing them, not by reading source.
//
// Phase 1 established the rule: the CLI extractor imports the real `COMMANDS`
// table and the MCP one boots the server and calls `tools/list`, because a value
// you can read cannot disagree with itself the way a regex over source can. This
// is the same move for the eleven packages that are libraries rather than bins.
// It closes a real hole: `@real-a11y-dev/testing` alone has five documentation
// pages and twenty-eight exports, and until now nothing checked one against the
// other.
//
// ── TWO SOURCES, BECAUSE ONE ISN'T ENOUGH ──────────────────────────────────
//
// `values` come from importing the built module. `types` come from the emitted
// `.d.ts`, and that second half is not optional cosmetics — it was measured.
//
// With runtime exports alone, the useful direction of the check ("everything the
// docs import actually exists") produced 23 failures against the CURRENT docs,
// and every one was correct documentation: `SemanticNode`, `TreeChange`,
// `ExtractionResult`, `AttachOptions`, `PlaywrightPage`. All type exports. They
// vanish at compile time, so `Object.keys` cannot see them, and a runtime-only
// model has no way to tell "this is a type" from "this does not exist". A check
// that fails on correct docs gets switched off within a week, and rightly.
//
// So the `.d.ts` is read for NAMES only — what is exported, not what its shape
// is. No generics, no overloads, no signatures. That is a fraction of the work
// of real type extraction and it is enough to make both directions honest.
//
// Still not modelled, and worth knowing: signatures. Nothing here can tell you a
// parameter was added or a return type changed. `api-extractor` and `typedoc`
// are what that problem is called.

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// No binary special-case. A package's importable surface is whatever its
// `exports` map declares, and "is it a bin?" turns out to be the wrong question:
// `cli` declares no exports and contributes nothing on its own, while `mcp`
// declares `.` and is importable despite its surface being mostly the tool set.
// Excluding by name meant the index couldn't tell "this package has no API" from
// "I chose not to look", which made an unknown-subpath report unusable.

/**
 * Resolve one `exports` entry to the ESM file it serves.
 *
 * Deliberately follows the same conditions Node would for an `import`, rather
 * than guessing at a path convention — the whole point of reading the real
 * artifact is not to reimplement resolution badly.
 */
function esmEntry(value) {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return null;
  return (
    esmEntry(value.import) ??
    esmEntry(value.node) ??
    esmEntry(value.default) ??
    null
  );
}

/**
 * The `types` condition for an entry, so declarations are found the same way.
 *
 * Recurses to a STRING or null and never returns the conditions object it found
 * it in — `"types"` is itself sometimes a map (`{ import, require }`), and
 * returning that object handed `path.resolve` a non-string and turned every
 * package into "could not be imported".
 */
function typesEntry(value) {
  if (typeof value === "string") {
    return /\.d\.[cm]?ts$/.test(value) ? value : null;
  }
  if (!value || typeof value !== "object") return null;
  return (
    typesEntry(value.types) ??
    typesEntry(value.import) ??
    typesEntry(value.node) ??
    typesEntry(value.default) ??
    null
  );
}

/**
 * Exported NAMES from a `.d.ts`. Names only — never shapes.
 *
 * The emitted declarations are a flat bundle whose public surface is stated in
 * `export { … }` lists, either re-exporting from a dependency or closing the
 * file. Both forms are read, plus the `export declare` / `export interface`
 * style in case a package's build emits that instead.
 *
 * `A as B` contributes B, because B is the name a consumer imports. `type X` is
 * stripped of its modifier for the same reason.
 *
 * `export type { … }` counts too, and the `type\s+` in the pattern is the whole
 * reason. Without it the block form was invisible — `export\s*\{` needs the brace
 * straight after `export`, and the keyword blocks it — so a package emitting that
 * style would contribute ZERO type names. Nothing emits it today, which is why
 * this passed: it was a trap set for whichever build tool changed next, and it
 * would have surfaced as "doesn't export it" against documentation that was
 * right. That is the exact failure the `.d.ts` half exists to prevent, so leaving
 * it to chance would have been a poor joke.
 */
async function declaredNames(file) {
  const text = await readFile(file, "utf8");
  const names = new Set();

  const BLOCK = /export\s+type\s*\{([^}]*)\}|export\s*\{([^}]*)\}/g;
  for (const list of text.matchAll(BLOCK)) {
    // Group 1 is the `export type { … }` form, group 2 the plain one; exactly
    // one is set per match.
    for (let part of (list[1] ?? list[2]).split(",")) {
      part = part.trim();
      if (!part) continue;
      const aliased = /\s+as\s+(.+)$/.exec(part);
      const name = (aliased ? aliased[1] : part).replace(/^type\s+/, "").trim();
      if (/^[A-Za-z_$][\w$]*$/.test(name)) names.add(name);
    }
  }

  for (const decl of text.matchAll(
    /^export\s+(?:declare\s+)?(?:abstract\s+)?(?:function|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm,
  )) {
    names.add(decl[1]);
  }

  return [...names].sort();
}

/**
 * @returns {Promise<{name: string, entries: {subpath: string, values: string[], types: string[]}[], problems: string[]}[]>}
 */
export async function extractApi(repoRoot, packages) {
  const out = [];

  for (const pkg of packages) {
    if (pkg.private) continue;

    const dir = join(repoRoot, "packages", pkg.dir);
    const manifest = JSON.parse(
      await readFile(join(dir, "package.json"), "utf8"),
    );

    const entries = [];
    const problems = [];

    for (const [subpath, condition] of Object.entries(manifest.exports ?? {})) {
      const file = esmEntry(condition);
      // A CSS-only subpath (the UI package's `./styles`) has nothing to import
      // and is not a gap. Skipping quietly is right; skipping a *JS* entry
      // would not be, which is why the two cases are separated.
      if (!file || /\.css$/.test(file)) continue;

      const abs = resolve(dir, file);
      if (!existsSync(abs)) {
        problems.push(
          `${pkg.name}${subpath.slice(1)} → ${file} does not exist. Run \`pnpm build\` ` +
            `first; extraction reads the built artifact on purpose, because that is ` +
            `what a consumer imports.`,
        );
        continue;
      }

      try {
        const mod = await import(pathToFileURL(abs).href);
        // `default` is excluded: it is a shape, not a named surface, and the
        // docs never refer to it by name.
        const values = Object.keys(mod)
          .filter((k) => k !== "default")
          .sort();

        // Type-ONLY names: declared in the `.d.ts` but absent at runtime. Kept
        // as a separate list rather than merged, so the manifest stays honest
        // about which half of the surface each name lives in — and so a future
        // reader can see at a glance that signatures are still unmodelled.
        const dts = typesEntry(condition);
        let types = [];
        if (dts) {
          const dtsAbs = resolve(dir, dts);
          if (existsSync(dtsAbs)) {
            const declared = await declaredNames(dtsAbs);
            types = declared.filter((n) => !values.includes(n));
          } else {
            problems.push(
              `${pkg.name}${subpath.slice(1)} → ${dts} does not exist, so type ` +
                `exports can't be read. Every type this entry point publishes ` +
                `would look like it doesn't exist.`,
            );
          }
        }

        entries.push({ subpath, values, types });
      } catch (error) {
        problems.push(
          `${pkg.name}${subpath.slice(1)} could not be imported: ` +
            `${String(error?.message ?? error).split("\n")[0]}. An entry point that ` +
            `throws on import is broken for every consumer, so this is a finding, ` +
            `not a reason to skip it.`,
        );
      }
    }

    if (entries.length || problems.length) {
      out.push({
        name: pkg.name,

        entries,
        ...(problems.length ? { problems } : {}),
      });
    }
  }

  return out;
}
