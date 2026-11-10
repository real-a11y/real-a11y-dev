import { fileURLToPath } from "node:url";

import { buildSync } from "esbuild";

/**
 * The tree stylesheet, minified into one string for a bundle to inline.
 *
 * The inspector and the Storybook manager inject the stylesheet as text, so
 * their tsup configs pass this through the esbuild `define` `__SN_STYLES__`.
 * A minifier leaves string literals alone, so nothing downstream shrinks it:
 * what this returns is exactly what ships. Building it here for both configs
 * keeps the two from drifting apart. The extension needs none of this, since
 * Vite already minifies the CSS it imports.
 *
 * Bundling `tree.css` follows its `@import` of `themes.css`, as Vite does, so
 * the string holds both files in order and no `@import` of its own. The change
 * marks' `tree-changes.css` comes after them, in the order the extension's
 * side panel imports the two.
 *
 * Only whitespace and comments go (`minifyWhitespace`, not `minify`). The full
 * minifier also rewrites values, turning `hsl()` colours into rounded hex and
 * `::before` into `:before`, to save only ~40 B more gzipped. Whitespace alone
 * leaves every rule exactly as written.
 *
 * Build-time only: tsup configs and tests import it, and nothing that ships
 * does. tsup bundles a config together with what it imports by relative path
 * but leaves bare imports for Node to resolve from the config's directory, so
 * each package whose config imports this declares `esbuild` itself.
 */
export function buildInlineStyles(): string {
  // One build per file, so their order is this list's, whatever order a
  // build of both would hand its outputs back in.
  return ["./tree.css", "./tree-changes.css"]
    .map(
      (file) =>
        buildSync({
          entryPoints: [fileURLToPath(new URL(file, import.meta.url))],
          bundle: true,
          minifyWhitespace: true,
          // A bundle keeps `/*! … */` comments by default; these are no
          // exception.
          legalComments: "none",
          write: false,
        }).outputFiles[0]!.text,
    )
    .join("");
}
