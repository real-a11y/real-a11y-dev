// The project defaults (`configureA11y`) across the BUILT entries, not the
// source.
//
// From source, `./matchers` and `./index` share one `config.ts` module, so a
// default set through one is always seen by the other and no unit test can
// observe the failure this guards: tsup splits no chunk between CJS entries,
// so `dist/matchers.cjs` and `dist/index.cjs` each carry their own copy of the
// config module. A Jest setup file registers through the first and a test
// diffs through the second; a dual ESM/CJS load adds a third copy. Kept in
// module scope, the default would silently never apply. It lives here, like
// `built-declarations.test.ts`, because `pretest:e2e` builds `dist/` first.
//
// No browser is involved; these run under Playwright's runner in Node.

import { createRequire } from "node:module";

import { expect, test } from "@playwright/test";

import type * as Index from "../src/index.js";
import type * as Matchers from "../src/matchers.js";

const require = createRequire(import.meta.url);

// Node has no DOM: `a11yDiff` takes the plain trees below without one.
test("there is no DOM here", () => {
  expect(typeof (globalThis as { Element?: unknown }).Element).toBe(
    "undefined",
  );
});

/** A list `L` holding `items`, as a plain `ExtractionResult`. */
function list(items: string[]): Index.ExtractionResult {
  const node = (
    id: string,
    role: string,
    name: string,
    parentId: string | null,
    childIds: string[],
  ): Index.SemanticNode => ({
    id,
    parentId,
    childIds,
    depth: parentId ? 1 : 0,
    a11y: {
      role,
      name,
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
  });
  const ids = items.map((item) => `i-${item}`);
  const nodes = new Map<string, Index.SemanticNode>([
    ["l", node("l", "list", "L", null, ids)],
    ...items.map(
      (item, i) => [ids[i]!, node(ids[i]!, "listitem", item, "l", [])] as const,
    ),
  ]);
  return { nodes, rootId: "l", source: { producer: "dom" } };
}

const before = list(["a"]);
const after = list(["a", "b"]);
const COUNT = '~ list "L": childIds 1 child → 2 children';

const fakeExpect = { extend() {} };

test.afterEach(() => {
  const cjs = require("../dist/index.cjs") as typeof Index;
  cjs.configureA11y({ diff: {} });
});

test("a default registered through matchers.cjs reaches a11yDiff from index.cjs", () => {
  const matchers = require("../dist/matchers.cjs") as typeof Matchers;
  const cjs = require("../dist/index.cjs") as typeof Index;

  expect(cjs.a11yDiff(before, after).text).toBe(`+ listitem "b"\n${COUNT}`);
  matchers.registerA11yMatchers(fakeExpect, { diff: { childIds: false } });
  expect(cjs.a11yDiff(before, after).text).toBe('+ listitem "b"');
});

test("a default set from index.cjs reaches a11yDiff from index.js", async () => {
  const cjs = require("../dist/index.cjs") as typeof Index;
  const esm = (await import("../dist/index.js")) as typeof Index;

  cjs.configureA11y({ diff: { childIds: false, redact: [/b/] } });
  expect(esm.a11yDiff(before, after).text).toBe('+ listitem "[REDACTED]"');
  expect(esm.a11yDiff(before, after, { childIds: true }).text).toBe(
    `+ listitem "[REDACTED]"\n${COUNT}`,
  );
});
