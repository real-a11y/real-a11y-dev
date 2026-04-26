import { linearize } from "./linearize.js";
import type { QueryInput } from "./types.js";

export interface OutlineEntry {
  id: string;
  level: number;
  name: string;
}

/**
 * Return the heading outline of the tree — every node with
 * `role="heading"`, in document order, with its level and accessible name.
 *
 * Use this for structure audits ("is there exactly one h1?", "are levels
 * skipped?"). The entries are returned unordered-wise as they appear in the
 * DOM; callers can run their own structural checks.
 */
export function getOutline(input: QueryInput): OutlineEntry[] {
  const out: OutlineEntry[] = [];
  for (const node of linearize(input)) {
    if (node.a11y.role !== "heading") continue;
    const raw = node.a11y.properties?.level;
    const level = raw !== undefined ? Number(raw) : NaN;
    if (!Number.isFinite(level)) continue;
    out.push({ id: node.id, level, name: node.a11y.name });
  }
  return out;
}
