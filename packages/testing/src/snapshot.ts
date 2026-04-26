import { getOutline, getTabSequence } from "@real-a11y-dev/core";

import { extract } from "./extract.js";
import { serializeTree, type SerializeOptions } from "./serialize.js";

/**
 * Produce a deterministic tree snapshot suitable for `toMatchSnapshot()`.
 * Convenience wrapper around {@link serializeTree} — accepts either a DOM
 * element or a pre-extracted tree.
 */
export function auditSnapshot(
  root: Element,
  options: SerializeOptions = {},
): string {
  return serializeTree(root, options);
}

/**
 * Produce an indented heading outline ("level N → name") in document order.
 */
export function outlineSnapshot(root: Element): string {
  const tree = extract(root, "a11y");
  const entries = getOutline(tree);
  if (entries.length === 0) return "(no headings)";
  return entries
    .map((e) => `${"  ".repeat(Math.max(0, e.level - 1))}h${e.level} ${e.name}`)
    .join("\n");
}

/**
 * Produce a snapshot of the computed tab order — role + accessible name, in
 * the order a user would encounter while pressing Tab.
 */
export function tabSequenceSnapshot(root: Element): string {
  const tree = extract(root, "a11y");
  const seq = getTabSequence(tree);
  if (seq.length === 0) return "(nothing focusable)";
  return seq
    .map((n, i) => {
      const name = n.a11y.name ? ` "${n.a11y.name}"` : "";
      return `${String(i + 1).padStart(2, "0")}. ${n.a11y.role}${name}`;
    })
    .join("\n");
}
