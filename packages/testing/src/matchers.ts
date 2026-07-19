// Custom `expect` matchers — the jest-axe-style ergonomic layer over the
// plain assertion + snapshot functions.
//
// Two mechanisms ship here, deliberately kept separate:
//
//   1. Assertion matchers (`toHaveNoUnlabeledInteractive`, …) wrap the
//      existing `assertX` functions. A failed assertion becomes a matcher
//      failure with the assertion's own message, and `.not` works for free.
//
//   2. A *snapshot serializer* (not a custom snapshot matcher). Wrapping the
//      tree in `a11ySnapshot(el)` and registering the serializer means plain
//      `expect(a11ySnapshot(el)).toMatchSnapshot()` /
//      `.toMatchInlineSnapshot()` stay fully native to each framework's
//      snapshot tooling — `-u`/`--update` and obsolete-snapshot detection
//      keep working, with no reach into private snapshot-state internals.
//
// Registration is opt-in (jest-axe pattern): the consumer calls
// `registerA11yMatchers(expect)` from their test setup file. Nothing here runs
// on import, so the package's main entry stays `sideEffects: false`.

import {
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
  assertDialogsLabeled,
  assertLandmarkStructure,
  A11yAssertionError,
} from "@real-a11y-dev/audit";
import type { SemanticNode } from "@real-a11y-dev/core";
import { getTabSequence } from "@real-a11y-dev/core";
import {
  extract,
  serializeTree,
  type SerializeOptions,
} from "@real-a11y-dev/serialize";
import {
  validateNode,
  validateTree,
  type ValidatedNode,
} from "@real-a11y-dev/validate";

import { foldTypography } from "./normalize.js";
import {
  a11ySnapshotSerializer,
  boxSnapshot,
  type A11ySnapshotBox,
} from "./snapshot-box.js";

type Tree = { nodes: Map<string, SemanticNode>; rootId: string };

// Both Jest and Vitest accept this shape back from a matcher.
interface MatcherResult {
  pass: boolean;
  message: () => string;
}

// The slice of the matcher context we rely on. Both frameworks provide these.
interface MatcherContext {
  isNot: boolean;
  equals(a: unknown, b: unknown): boolean;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (value instanceof Element) return `<${value.tagName.toLowerCase()}>`;
  return typeof value;
}

// ─── assertion matchers ──────────────────────────────────────────────────────

function runAssertion(
  received: unknown,
  assert: (root: Element) => void,
  name: string,
): MatcherResult {
  if (!(received instanceof Element)) {
    return {
      pass: false,
      message: () =>
        `${name}: expected a DOM Element, received ${describe(received)}`,
    };
  }

  let failure: A11yAssertionError | null = null;
  try {
    assert(received);
  } catch (err) {
    if (err instanceof A11yAssertionError) failure = err;
    else throw err; // a real bug — don't swallow it as a soft assertion
  }

  const pass = failure === null;
  return {
    pass,
    message: () =>
      pass
        ? `expected element to violate ${name}, but it satisfied it`
        : failure!.message,
  };
}

// ─── tab-sequence matcher ────────────────────────────────────────────────────

/** `role "name"` token per focusable node, in Tab order. */
function tabTokens(root: Element): string[] {
  const tree = extract(root, "a11y");
  return getTabSequence(tree).map((n) => {
    const name = n.a11y.name ? ` "${n.a11y.name}"` : "";
    return `${n.a11y.role}${name}`;
  });
}

function toHaveTabSequence(
  this: MatcherContext,
  received: unknown,
  expected: string[],
): MatcherResult {
  if (!(received instanceof Element)) {
    return {
      pass: false,
      message: () =>
        `toHaveTabSequence: expected a DOM Element, received ${describe(received)}`,
    };
  }
  const actual = tabTokens(received);
  // Compare with typography folded so a hand-typed straight quote matches a
  // rendered curly one (a name like `link "Don't save"`). The message still
  // shows the raw tokens, so the committed record stays faithful.
  const pass = this.equals(
    actual.map(foldTypography),
    expected.map(foldTypography),
  );
  return {
    pass,
    message: () =>
      pass
        ? `expected tab sequence NOT to equal\n  ${JSON.stringify(expected)}`
        : [
            "Tab sequence mismatch.",
            `  expected: ${JSON.stringify(expected)}`,
            `  actual:   ${JSON.stringify(actual)}`,
          ].join("\n"),
  };
}

// ─── ARIA validity matcher ───────────────────────────────────────────────────

/** Adapt a core `SemanticNode` tree to the validator's minimal node shape,
 *  reconstructing `aria-*` attribute names from the split states/properties. */
function toValidatedNodes(tree: Tree): Map<string, ValidatedNode> {
  const out = new Map<string, ValidatedNode>();
  for (const [id, n] of tree.nodes) {
    const attrs: Record<string, string | boolean> = {};
    for (const [k, v] of Object.entries(n.a11y.states)) attrs[`aria-${k}`] = v;
    for (const [k, v] of Object.entries(n.a11y.properties))
      attrs[`aria-${k}`] = v;
    out.set(id, {
      id,
      parentId: n.parentId,
      role: n.a11y.role,
      name: n.a11y.name,
      attrs,
    });
  }
  return out;
}

/**
 * Assert the extracted accessibility tree has no ARIA *errors* — invalid roles,
 * missing required names/attributes, and the relationship violations
 * `@real-a11y-dev/validate` catches (interactive nesting, presentational-children
 * misuse). Advisory warnings don't fail the matcher.
 */
function toBeValidA11yTree(received: unknown): MatcherResult {
  if (!(received instanceof Element)) {
    return {
      pass: false,
      message: () =>
        `toBeValidA11yTree: expected a DOM Element, received ${describe(received)}`,
    };
  }
  const nodes = toValidatedNodes(extract(received, "a11y"));
  const label = (n: ValidatedNode) =>
    n.name ? `${n.role} "${n.name}"` : n.role;
  const errors: string[] = [];
  for (const node of nodes.values()) {
    for (const issue of validateNode(node, nodes)) {
      if (issue.severity === "error")
        errors.push(`${label(node)} — ${issue.message}`);
    }
  }
  for (const [id, list] of validateTree(nodes)) {
    const node = nodes.get(id);
    if (!node) continue;
    for (const issue of list) {
      if (issue.severity === "error")
        errors.push(`${label(node)} — ${issue.message}`);
    }
  }
  const pass = errors.length === 0;
  return {
    pass,
    message: () =>
      pass
        ? "expected the accessibility tree to have ARIA violations, but it was valid"
        : [
            `Accessibility tree has ${errors.length} ARIA violation(s):`,
            ...errors.map((e) => `  ✖ ${e}`),
          ].join("\n"),
  };
}

// ─── the matcher bundle ──────────────────────────────────────────────────────

export const a11yMatchers = {
  toHaveNoUnlabeledInteractive(received: unknown) {
    return runAssertion(
      received,
      assertNoUnlabeledInteractive,
      "toHaveNoUnlabeledInteractive",
    );
  },
  toHaveValidHeadingOrder(received: unknown) {
    return runAssertion(
      received,
      assertHeadingOrder,
      "toHaveValidHeadingOrder",
    );
  },
  toHaveLabeledDialogs(received: unknown) {
    return runAssertion(received, assertDialogsLabeled, "toHaveLabeledDialogs");
  },
  toHaveValidLandmarks(received: unknown) {
    return runAssertion(
      received,
      assertLandmarkStructure,
      "toHaveValidLandmarks",
    );
  },
  toHaveTabSequence,
  toBeValidA11yTree,
};

// ─── snapshot serializer ─────────────────────────────────────────────────────

/**
 * Wrap a DOM root (or pre-extracted tree) so `expect(...).toMatchSnapshot()`
 * prints the deterministic a11y tree via the registered serializer, instead of
 * the framework's default DOM-element dump. (`a11yDiff` produces the same box
 * shape for a change list — one serializer renders both.)
 */
export function a11ySnapshot(
  root: Element | Tree,
  options?: SerializeOptions,
): A11ySnapshotBox {
  return boxSnapshot(serializeTree(root, options));
}

// The pretty-format plugin lives in ./snapshot-box (shared with a11yDiff);
// re-exported here so existing `registerA11yMatchers` / import sites are unchanged.
export { a11ySnapshotSerializer };

// ─── registration ────────────────────────────────────────────────────────────

interface ExpectApi {
  extend(matchers: Record<string, unknown>): void;
  addSnapshotSerializer?(serializer: unknown): void;
}

/**
 * Register the matchers and snapshot serializer against an `expect` instance.
 * Call once from a test setup file:
 *
 * ```ts
 * import { expect } from "vitest"; // or "@jest/globals"
 * import { registerA11yMatchers } from "@real-a11y-dev/testing/matchers";
 * registerA11yMatchers(expect);
 * ```
 */
export function registerA11yMatchers(expect: ExpectApi): void {
  expect.extend(a11yMatchers);
  expect.addSnapshotSerializer?.(a11ySnapshotSerializer);
}

// ─── type augmentation ───────────────────────────────────────────────────────
//
// The matcher signatures, shared by every framework's augmentation. Jest's
// augmentation lives here (a global `namespace jest` merge needs no module
// resolution). Vitest's lives in the opt-in `./matchers/vitest` entry, because
// `declare module "vitest"` would force a Jest-only consumer — who has no
// `vitest` installed — to resolve a module that isn't there.

export interface A11yMatchers<R = unknown> {
  /** Every interactive node has a non-empty accessible name. */
  toHaveNoUnlabeledInteractive(): R;
  /** Exactly one `<h1>` and no skipped heading levels. */
  toHaveValidHeadingOrder(): R;
  /** Every dialog/alertdialog has an accessible name. */
  toHaveLabeledDialogs(): R;
  /** Exactly one `main`; at most one `banner`/`contentinfo`. */
  toHaveValidLandmarks(): R;
  /** Focusable nodes, in Tab order, equal the given `role "name"` tokens. */
  toHaveTabSequence(expected: string[]): R;
  /** The extracted a11y tree has no ARIA errors (roles, names, relationships). */
  toBeValidA11yTree(): R;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merge into Jest's matcher types
    interface Matchers<R> extends A11yMatchers<R> {}
  }
}
