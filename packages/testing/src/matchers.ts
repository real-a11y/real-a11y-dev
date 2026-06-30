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

import type { SemanticNode } from "@real-a11y-dev/core";
import { getTabSequence } from "@real-a11y-dev/core";

import {
  assertNoUnlabeledInteractive,
  assertHeadingOrder,
  assertDialogsLabeled,
  assertLandmarkStructure,
  A11yAssertionError,
} from "./assertions.js";
import { extract } from "./extract.js";
import { serializeTree, type SerializeOptions } from "./serialize.js";

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
  const pass = this.equals(actual, expected);
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
};

// ─── snapshot serializer ─────────────────────────────────────────────────────

const SNAPSHOT_BRAND = "@real-a11y-dev/a11y-snapshot";

interface A11ySnapshotBox {
  readonly [SNAPSHOT_BRAND]: true;
  readonly text: string;
}

/**
 * Wrap a DOM root (or pre-extracted tree) so `expect(...).toMatchSnapshot()`
 * prints the deterministic a11y tree via the registered serializer, instead of
 * the framework's default DOM-element dump.
 */
export function a11ySnapshot(
  root: Element | Tree,
  options?: SerializeOptions,
): A11ySnapshotBox {
  return { [SNAPSHOT_BRAND]: true, text: serializeTree(root, options) };
}

/**
 * pretty-format plugin recognised by both Jest and Vitest. Register via
 * {@link registerA11yMatchers} or each framework's `snapshotSerializers` config.
 */
export const a11ySnapshotSerializer = {
  test(val: unknown): val is A11ySnapshotBox {
    return (
      typeof val === "object" &&
      val !== null &&
      (val as Record<string, unknown>)[SNAPSHOT_BRAND] === true
    );
  },
  serialize(val: A11ySnapshotBox): string {
    return val.text;
  },
};

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
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merge into Jest's matcher types
    interface Matchers<R> extends A11yMatchers<R> {}
  }
}
