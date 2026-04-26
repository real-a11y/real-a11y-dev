import type { SemanticNode } from "@real-a11y-dev/core";
import { linearize } from "@real-a11y-dev/core";

import { extract } from "./extract.js";

export interface SerializeOptions {
  /** `"a11y"` (default) or `"dom"` — only used when a root Element is passed. */
  mode?: "a11y" | "dom";
  /**
   * Redact matching substrings from accessible names and text content — useful
   * for stripping user data or timestamps so snapshots stay deterministic.
   */
  redact?: RegExp[];
  /** Include generic container nodes (`role="generic"`). Default false. */
  includeGeneric?: boolean;
}

function redactText(input: string, patterns: RegExp[] | undefined): string {
  if (!patterns?.length) return input;
  let out = input;
  for (const p of patterns) out = out.replace(p, "[REDACTED]");
  return out;
}

/**
 * Serialize a tree (or a DOM root) as a deterministic indented string.
 *
 * The format is stable across runs: roles and accessible names only, no ids,
 * no timestamps. Designed for Vitest/Jest snapshot comparisons.
 */
export function serializeTree(
  input: Element | { nodes: Map<string, SemanticNode>; rootId: string },
  options: SerializeOptions = {},
): string {
  const { mode = "a11y", redact, includeGeneric = false } = options;
  const tree = input instanceof Element ? extract(input, mode) : input;

  const visible = linearize(tree);
  const lines: string[] = [];
  for (const node of visible) {
    if (!includeGeneric && node.a11y.role === "generic") continue;
    const indent = "  ".repeat(node.depth);
    const name = redactText(node.a11y.name, redact);
    const nameSuffix = name ? ` "${name}"` : "";
    const level = node.a11y.properties?.level;
    const levelSuffix = level ? ` (level ${level})` : "";
    lines.push(`${indent}${node.a11y.role}${nameSuffix}${levelSuffix}`);
  }
  return lines.join("\n");
}
