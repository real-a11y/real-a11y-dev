// Import a package's TypeScript source from a plain Node script.
//
// The extractors need the real `COMMANDS` table and the real MCP server, not a
// regex's impression of them. Neither is importable as shipped: the CLI's only
// build entry is a bin with a shebang and top-level side effects, so importing
// it runs the CLI.
//
// So bundle the source on the fly. esbuild is already in the tree (tsup uses
// it), it takes ~50ms, and it reads the same files the build does — there is no
// second copy of anything to keep in sync, which is the whole point of the
// exercise.
//
// Bare imports stay EXTERNAL: `@real-a11y-dev/audit` and the MCP SDK resolve
// from the package's own node_modules at import time, exactly as they do at
// runtime. That means workspace deps must be BUILT — `pnpm verify` builds
// first, and `surface check` says so when they aren't.

import { createHash } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { build } from "esbuild";

/**
 * Bundle one or more TS entries of a package and import them together.
 *
 * @param {string} pkgDir absolute path to the package root
 * @param {Record<string, string>} entries namespace name → path under pkgDir,
 *   e.g. `{ args: "src/args.ts", exit: "src/exit.ts" }`
 * @returns {Promise<Record<string, Record<string, unknown>>>} one module
 *   namespace per entry, keyed by the name you asked for
 *
 * A single synthetic entry rather than one bundle per file: separate bundles
 * would each inline their own copy of a shared module, so two namespaces could
 * disagree about the identity of the same constant.
 */
export async function loadTs(pkgDir, entries) {
  const names = Object.keys(entries).sort();

  // Import through the `.js` specifier the real source uses — esbuild applies
  // TypeScript's own `.js` → `.ts` resolution, the same way it does for tsup.
  const contents = `${names
    .map(
      (name) =>
        `import * as ${name} from "./${entries[name].replace(/\.ts$/, ".js")}";`,
    )
    .join("\n")}\nexport { ${names.join(", ")} };\n`;

  // Land the bundle in dist/, where the real build output lives. Anything that
  // reads a path relative to `import.meta.url` — the MCP server's
  // `packageVersion()` reaches for `../package.json` — then resolves exactly as
  // it does in production. A temp dir elsewhere would silently answer "0.0.0".
  const stamp = createHash("sha256")
    .update(JSON.stringify(entries))
    .digest("hex")
    .slice(0, 8);
  const outfile = join(pkgDir, "dist", `.surface-${stamp}.mjs`);

  await mkdir(join(pkgDir, "dist"), { recursive: true });
  await build({
    stdin: {
      contents,
      resolveDir: pkgDir,
      sourcefile: "surface.ts",
      loader: "ts",
    },
    outfile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node20",
    // Everything from node_modules resolves at import time, not bundle time.
    packages: "external",
    logLevel: "silent",
  });

  try {
    return await import(pathToFileURL(outfile).href);
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        `${err.message}\n\n` +
          `A workspace dependency isn't built. Run:  pnpm build`,
        { cause: err },
      );
    }
    throw err;
  } finally {
    // Node has already read the file into its module cache, so removing it now
    // costs nothing and keeps a stray .mjs out of `files: ["dist"]` if someone
    // packs right after running this.
    await rm(outfile, { force: true }).catch(() => {});
  }
}
