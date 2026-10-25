// @vitest-environment node

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

import { buildInlineStyles } from "./inline.js";

const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

/** esbuild's own printing of `css`: the same rules, laid out one way. */
const rules = (css: string) => transformSync(css, { loader: "css" }).code;

describe("buildInlineStyles", () => {
  const inlined = buildInlineStyles();

  it("carries no comments", () => {
    expect(inlined).not.toContain("/*");
  });

  it("carries no @import", () => {
    // tree.css imports themes.css. Inlined into a <style>, the import would
    // resolve against the host page's URL rather than this package.
    expect(inlined).not.toContain("@import");
  });

  it("is themes.css then tree.css, less only whitespace and comments", () => {
    const tree = read("./tree.css");
    expect(tree).toContain('@import "./themes.css";');

    const source =
      read("./themes.css") + tree.replace('@import "./themes.css";', "");
    expect(rules(inlined)).toBe(rules(source));
  });
});
