/**
 * Project a native `ExtractionResult` (Chromium's own accessibility tree, read
 * over CDP by `@real-a11y-dev/browser`'s `nativeTree`) into the same
 * `CleanSnapshot` the DOM producer yields — so every downstream sink (findings
 * report, tree/outline views, diff) consumes one shape regardless of producer.
 *
 * The DOM path serializes and audits *in the page* (the injected bundle) and
 * `session.snapshot()` hands back ready-made strings. A native tree instead
 * arrives as a node graph, so serialization + auditing happen here in Node —
 * using the same `serialize` and `audit` engines the bundle is built from, so
 * the two producers stay directly comparable.
 *
 * Native is read-only and a11y-tree-only: there is no focus/interaction data,
 * so `tabOrder` is empty by construction. Callers that need a tab sequence must
 * use the DOM producer.
 */

import { collectFindings, type A11yRule } from "@real-a11y-dev/audit";
import type { ExtractionResult } from "@real-a11y-dev/core";
import { serializeOutline, serializeTree } from "@real-a11y-dev/serialize";

import { projectSnapshot, type CleanSnapshot } from "./sanitize.js";

export interface NativeSnapshotOptions {
  /** Rule subset to run (defaults to every rule, matching the DOM path). */
  rules?: readonly A11yRule[];
  /** Include generic container nodes in the serialized tree. */
  includeGeneric?: boolean;
}

/**
 * Serialize + audit a native `ExtractionResult` into a `CleanSnapshot`.
 *
 * Findings are computed in Node over the native tree (the same rules the DOM
 * audit runs), so an audit over the native producer sees structure no in-page
 * walk reaches — e.g. a `<video controls>`'s user-agent-shadow media controls.
 * `tabOrder` is always empty: a native tree carries no focusability data.
 */
export function projectNativeTree(
  tree: ExtractionResult,
  options: NativeSnapshotOptions = {},
): CleanSnapshot {
  const includeGeneric = options.includeGeneric === true;
  // An *empty* rule array means "no filter given" — normalize it to undefined so
  // `collectFindings` runs every rule. Its default only fires for `undefined`, so
  // passing `[]` straight through would audit nothing. This matches the DOM
  // producer's guard (browser.ts) and keeps the two producers in parity: a
  // native audit must never silently pass a page the DOM audit would flag.
  const rules = options.rules?.length ? options.rules : undefined;
  return projectSnapshot({
    findings: collectFindings(tree, rules),
    tree: serializeTree(tree, { includeGeneric }),
    outline: serializeOutline(tree),
    tabOrder: "",
  });
}
