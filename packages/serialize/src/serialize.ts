import type { ExtractionResult } from "@real-a11y-dev/core";
import { linearize, getOutline, getTabSequence } from "@real-a11y-dev/core";

import { extract } from "./extract.js";

/** A DOM root to extract from, or an already-extracted tree. */
export type SerializeInput = Element | ExtractionResult;

export interface SerializeOptions {
  /** `"a11y"` (default) or `"dom"` — only used when a root Element is passed. */
  mode?: "a11y" | "dom";
  /**
   * Redact matching substrings from accessible names and text content — useful
   * for stripping user data or timestamps so the output stays deterministic.
   */
  redact?: RegExp[];
  /** Include generic container nodes (`role="generic"`). Default false. */
  includeGeneric?: boolean;
  /**
   * Mark the element focused at extraction time with a trailing `[focused]`.
   * Default `true`. The marker appears only when something inside the tree
   * actually holds focus — a fresh page (focus on `<body>`) serializes
   * unchanged. Pass `false` for marker-free output, e.g. when diffing against a
   * tree from a source that has no focus concept (a native browser tree).
   */
  markFocus?: boolean;
}

function redactText(input: string, patterns: RegExp[] | undefined): string {
  if (!patterns?.length) return input;
  let out = input;
  for (const p of patterns) out = out.replace(p, "[REDACTED]");
  return out;
}

/** Resolve an input to a tree, extracting from the DOM only when needed. */
function toTree(input: SerializeInput, mode: "a11y" | "dom" = "a11y") {
  return input instanceof Element ? extract(input, mode) : input;
}

/**
 * Serialize the full semantic tree (or a DOM root) as a deterministic indented
 * string of roles + accessible names.
 *
 * The format is stable across runs: roles, accessible names, and a `[focused]`
 * marker on the element focused at extraction time — no node ids, no
 * timestamps. Determinism is run-to-run (same steps → same focus → same
 * output); pass `markFocus: false` to drop the marker. Suitable for snapshot
 * comparisons and shareable reports.
 */
export function serializeTree(
  input: SerializeInput,
  options: SerializeOptions = {},
): string {
  const {
    mode = "a11y",
    redact,
    includeGeneric = false,
    markFocus = true,
  } = options;
  const tree = toTree(input, mode);
  const focusedId = markFocus ? tree.focusedId : undefined;

  const visible = linearize(tree);
  const lines: string[] = [];
  for (const node of visible) {
    if (!includeGeneric && node.a11y.role === "generic") continue;
    const indent = "  ".repeat(node.depth);
    const name = redactText(node.a11y.name, redact);
    const nameSuffix = name ? ` "${name}"` : "";
    const level = node.a11y.properties?.level;
    const levelSuffix = level ? ` (level ${level})` : "";
    const focusSuffix = node.id === focusedId ? " [focused]" : "";
    lines.push(
      `${indent}${node.a11y.role}${nameSuffix}${levelSuffix}${focusSuffix}`,
    );
  }
  return lines.join("\n");
}

/**
 * Serialize the heading outline (`h1`..`h6` in document order) as an indented
 * string. Accepts a DOM root or a pre-extracted tree.
 */
export function serializeOutline(
  input: SerializeInput,
  options: SerializeOptions = {},
): string {
  const { markFocus = true } = options;
  const tree = toTree(input);
  const focusedId = markFocus ? tree.focusedId : undefined;
  const entries = getOutline(tree);
  if (entries.length === 0) return "(no headings)";
  return entries
    .map((e) => {
      const marker = e.id === focusedId ? " [focused]" : "";
      return `${"  ".repeat(Math.max(0, e.level - 1))}h${e.level} ${e.name}${marker}`;
    })
    .join("\n");
}

/**
 * Serialize the computed tab order — role + accessible name, in the order a
 * user encounters while pressing Tab. Accepts a DOM root or a pre-extracted
 * tree.
 */
export function serializeTabSequence(
  input: SerializeInput,
  options: SerializeOptions = {},
): string {
  const { markFocus = true } = options;
  const tree = toTree(input);
  const focusedId = markFocus ? tree.focusedId : undefined;
  const seq = getTabSequence(tree);
  if (seq.length === 0) return "(nothing focusable)";
  return seq
    .map((n, i) => {
      const name = n.a11y.name ? ` "${n.a11y.name}"` : "";
      const marker = n.id === focusedId ? " [focused]" : "";
      return `${String(i + 1).padStart(2, "0")}. ${n.a11y.role}${name}${marker}`;
    })
    .join("\n");
}
