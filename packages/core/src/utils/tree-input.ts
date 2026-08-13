import type { ExtractionResult } from "../types.js";

/**
 * Is `value` an already-extracted tree?
 *
 * Every entry point that accepts `Element | ExtractionResult` has the same
 * shape: extract when it's a DOM root, otherwise treat it as a tree. The
 * "otherwise" branch used to be an unchecked cast, so anything that wasn't an
 * `Element` — a number, a string, `{}` — sailed through as a tree, produced
 * zero nodes, and came back reported as a clean page.
 *
 * The check is **structural, never `instanceof`**. Core runs as more than one
 * copy (`inspector` and the extension bundle their own), and an iframe or
 * worker gets its own realm, so a `Map` built by one copy fails `instanceof
 * Map` in another — and a tree crossing a realm boundary is exactly the case
 * this has to keep working. Duck-typing `nodes.get` holds everywhere.
 *
 * Deliberately shallow: it separates "a tree" from "not a tree at all", which
 * is the mistake that reports clean. It does not validate node contents — a
 * structurally-sound tree with bad nodes is a different problem, and walking
 * every node on every call would make the guard cost more than the audit.
 */
export function isExtractionResult(value: unknown): value is ExtractionResult {
  if (typeof value !== "object" || value === null) return false;
  const { nodes, rootId } = value as Partial<ExtractionResult>;
  return (
    typeof rootId === "string" &&
    typeof (nodes as { get?: unknown } | undefined)?.get === "function"
  );
}

/**
 * Name a rejected value's **type** for an error message — never its contents.
 *
 * These messages land in test output and CI logs, and the value that arrived
 * here by mistake is frequently page text, a form value, or an object holding
 * a token. Printing the type is enough to fix the call; printing the value is
 * how an audit tool leaks the thing it was auditing.
 */
export function describeTreeInput(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") {
    // `Object.create(null)` has no constructor — don't dereference blindly.
    const name = Object.getPrototypeOf(value)?.constructor?.name;
    return name && name !== "Object" ? `a ${name}` : "a plain object";
  }
  return typeof value;
}

/**
 * The rejection every `Element | ExtractionResult` entry point throws.
 *
 * Built here so `audit` and `serialize` cannot drift: they are separate
 * packages that a consumer meets as one API, and R33 asserts the wording, so a
 * reworded message has to change in one place or not at all.
 *
 * Not a size optimization — measured, hoisting the shared string and adding a
 * call costs marginally *more* than inlining it at both sites. The reason is
 * consistency.
 */
export function treeInputError(fn: string, received: unknown): TypeError {
  return new TypeError(
    `${fn}: expected a DOM Element or an extracted a11y tree, received ${describeTreeInput(received)}`,
  );
}
