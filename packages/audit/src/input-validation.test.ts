/**
 * Input validation at the audit boundary.
 *
 * Every case here PASSED SILENTLY before this guard existed: `toTree` cast any
 * non-`Element` to an `ExtractionResult`, so junk became an empty tree, the
 * rules found nothing, and the assertion reported a clean page. Found running
 * the published package from npm against a fresh project (scenario R33).
 */
import { extractA11yTree } from "@real-a11y-dev/core";
import { describe, it, expect } from "vitest";

import {
  ALL_RULES,
  assertDialogsLabeled,
  assertHeadingOrder,
  assertLandmarkStructure,
  assertNoUnlabeledInteractive,
  assertRules,
  collectFindings,
  formatFindings,
  listByRole,
  type A11yRule,
} from "./index.js";

/** Values a caller has plausibly passed by mistake. */
const JUNK: Array<[string, unknown]> = [
  ["undefined", undefined],
  ["null", null],
  ["a string", "<button></button>"],
  ["a number", 42],
  ["a boolean", true],
  ["a plain object", {}],
  ["an object with a nodes array", { nodes: [] }],
  ["an empty array", []],
  ["a Date", new Date(0)],
  ["a Map", new Map()],
];

const ENTRY_POINTS: Array<[string, (root: never) => unknown]> = [
  ["assertNoUnlabeledInteractive", assertNoUnlabeledInteractive],
  ["assertHeadingOrder", assertHeadingOrder],
  ["assertDialogsLabeled", assertDialogsLabeled],
  ["assertLandmarkStructure", assertLandmarkStructure],
  ["collectFindings", (root) => collectFindings(root)],
  ["assertRules", (root) => assertRules(root, ALL_RULES)],
  ["listByRole", (root) => listByRole(root, "button")],
];

describe("rejects input that is not a tree", () => {
  for (const [entryName, fn] of ENTRY_POINTS) {
    for (const [label, value] of JUNK) {
      it(`${entryName}(${label}) throws`, () => {
        expect(() => fn(value as never)).toThrow(TypeError);
      });
    }
  }

  it("names the function the caller actually called", () => {
    expect(() => assertNoUnlabeledInteractive(42 as never)).toThrow(
      /^assertNoUnlabeledInteractive: expected a DOM Element or an extracted a11y tree/,
    );
    expect(() => assertLandmarkStructure(42 as never)).toThrow(
      /^assertLandmarkStructure:/,
    );
    expect(() => collectFindings(42 as never)).toThrow(/^collectFindings:/);
  });

  it("names the received type, and never its contents", () => {
    // The value that lands here by mistake is often page text or a token.
    const secret = "nw_live_sk_9f2b7c41d8";
    expect(() => collectFindings(secret as never)).toThrow(/received string/);
    expect(() => collectFindings(secret as never)).not.toThrow(
      new RegExp(secret),
    );
    expect(() => collectFindings([] as never)).toThrow(/received an array/);
    expect(() => collectFindings(new Date(0) as never)).toThrow(
      /received a Date/,
    );
    expect(() => collectFindings(null as never)).toThrow(/received null/);
  });

  it("throws TypeError, NOT A11yAssertionError", () => {
    // A caller catching A11yAssertionError is handling "this page has issues".
    // A wrong argument is a bug in the test, and must not be swallowed there.
    let caught: unknown;
    try {
      assertLandmarkStructure(42 as never);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as Error).name).toBe("TypeError");
  });

  it("does not report findings ABOUT the junk", () => {
    // Previously: collectFindings(42) returned heading-order +
    // landmark-structure findings, i.e. accessibility advice about a number.
    expect(() => collectFindings(42 as never)).toThrow();
  });
});

describe("still accepts what it is documented to accept", () => {
  function fixture(html: string): HTMLElement {
    document.body.innerHTML = html;
    return document.body;
  }

  it("a live DOM Element", () => {
    const root = fixture(`<main><h1>Fine</h1><button>Save</button></main>`);
    expect(() => assertNoUnlabeledInteractive(root)).not.toThrow();
    expect(collectFindings(root)).toEqual([]);
  });

  it("an already-extracted tree, the native-producer path", () => {
    const root = fixture(`<main><h1>Fine</h1><button>Save</button></main>`);
    const tree = extractA11yTree(root);
    expect(() => assertRules(tree, ALL_RULES)).not.toThrow();
    expect(collectFindings(tree)).toEqual([]);
  });

  it("a tree whose Map came from another realm (no instanceof)", () => {
    // Core runs as more than one copy; an iframe's Map fails `instanceof Map`
    // in the parent. The guard duck-types `nodes.get` precisely for this.
    const root = fixture(`<main><h1>Fine</h1></main>`);
    const real = extractA11yTree(root);
    const crossRealm = {
      ...real,
      nodes: {
        get: (id: string) => real.nodes.get(id),
        values: () => real.nodes.values(),
        keys: () => real.nodes.keys(),
        entries: () => real.nodes.entries(),
        [Symbol.iterator]: () => real.nodes[Symbol.iterator](),
        size: real.nodes.size,
      },
    };
    expect(() => collectFindings(crossRealm as never)).not.toThrow();
  });
});

describe("rejects rule ids that are not real", () => {
  function violating(): HTMLElement {
    // No <main>, and a skipped heading level: genuinely fails two rules, so a
    // silent pass can only mean the rule never ran.
    document.body.innerHTML = `<div><h1>One</h1><h3>Three</h3></div>`;
    return document.body;
  }

  it("a typo'd rule id throws instead of checking nothing", () => {
    expect(() =>
      assertRules(violating(), ["landmark_structure" as A11yRule]),
    ).toThrow(/unknown rule "landmark_structure"/);
  });

  it("the correctly-spelled rule still fires, proving the fixture violates it", () => {
    expect(() => assertRules(violating(), ["landmark-structure"])).toThrow(
      /Missing <main>/,
    );
  });

  it("lists the known rules so the typo is fixable from the message", () => {
    expect(() => collectFindings(violating(), ["nope" as A11yRule])).toThrow(
      /Known rules: no-unlabeled-interactive, image-alt, heading-order, dialog-labeled, landmark-structure/,
    );
  });

  it("reports every unknown id at once, not just the first", () => {
    expect(() =>
      collectFindings(violating(), [
        "nope" as A11yRule,
        "also-nope" as A11yRule,
      ]),
    ).toThrow(/unknown rule "nope", "also-nope"/);
  });

  it("rejects a non-array rules argument", () => {
    expect(() =>
      collectFindings(violating(), "heading-order" as never),
    ).toThrow(/expected an array of rule ids, received string/);
  });

  it("a valid subset still works", () => {
    expect(() => assertRules(violating(), ["heading-order"])).toThrow(
      /Heading level skipped/,
    );
    expect(() => assertRules(violating(), ["dialog-labeled"])).not.toThrow();
  });
});

describe("formatFindings on a clean page", () => {
  it("reads as an outcome rather than an empty heading", () => {
    expect(formatFindings([])).toBe("No accessibility issues found.");
  });

  it("still lists findings when there are some", () => {
    expect(
      formatFindings([
        {
          rule: "landmark-structure",
          severity: "error",
          message: "Missing <main>.",
        },
      ]),
    ).toBe("Found 1 accessibility issue:\n  - Missing <main>.");
  });
});
