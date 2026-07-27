/**
 * Node-side tree checkpoints against the native producer.
 *
 * The in-page checkpoint (`tree-checkpoint.ts`) holds the captured tree INSIDE
 * the page, keyed by realm-bound WeakMap ids. That works, but it ties the
 * checkpoint to the page instance and — more importantly — it diffs the DOM
 * producer's tree while the act path targets Chromium's native one. A user
 * clicks `button "Attach"` (native) and reads a diff written in a vocabulary
 * where that node is `textbox "Attach"` (DOM). One producer end to end removes
 * that seam.
 *
 * This module is the native counterpart: the captured tree lives in Node, so it
 * outlives the page, and native node ids (`ax-dom-<backendDOMNodeId>`) are
 * stable per DOM node for as long as the document is.
 *
 * ## Detecting that the document was replaced
 *
 * "For as long as the document is" is the whole problem. A click can navigate,
 * and then the ids on both sides are drawn from different documents — every id
 * differs, so a diff would report the entire page removed and an entirely new
 * page added. That is noise, not a finding.
 *
 * The obvious detector is the URL, and it is wrong. Measured across five real
 * scenarios in Chromium:
 *
 * | scenario            | shared ids | url changed |
 * | ------------------- | ---------- | ----------- |
 * | same-doc mutation   | 100%       | no          |
 * | SPA `pushState`     | 14%        | **yes**     |
 * | hash change         | 100%       | **yes**     |
 * | reload (same url)   | **0%**     | no          |
 * | real navigation     | 0%         | yes         |
 *
 * A URL comparison calls three of those five wrong: it suppresses the diff for
 * a hash change and an SPA route change (where the document — and most of the
 * tree — survived, and the diff is exactly what the user asked for), and it
 * emits a garbage diff for a reload.
 *
 * Shared node ids get all five right, and not as a tuned threshold: a replaced
 * document means Chromium allocates every `backendDOMNodeId` afresh, so the
 * overlap is *exactly* zero, while any same-document change keeps at least the
 * root. So the detector is "zero ids in common", and the URL is used only to
 * report where the page ended up.
 */

import { diffTrees, type ExtractionResult } from "@real-a11y-dev/core";
import { serializeTreeDiff } from "@real-a11y-dev/serialize";

/** What `serializeTreeDiff` renders when nothing differs. */
const EMPTY_DIFF = "(no changes)";

/** A captured native tree plus where the page was when it was captured. */
export interface NativeCheckpoint {
  readonly tree: ExtractionResult;
  /** The page's URL at capture time — reported, never used to detect anything. */
  readonly url: string;
  readonly nodeCount: number;
}

export type NativeCheckpointDiff =
  /** The document survived: `rendered` is the tree diff. */
  | { kind: "diff"; rendered: string; changed: boolean }
  /** The document was replaced; the checkpoint no longer describes anything. */
  | { kind: "replaced"; from: string; to: string };

export function captureNativeCheckpoint(
  tree: ExtractionResult,
  url: string,
): NativeCheckpoint {
  return { tree, url, nodeCount: tree.nodes.size };
}

/** How many node ids the two trees have in common. */
function sharedIdCount(a: ExtractionResult, b: ExtractionResult): number {
  // Iterate the smaller map; `has` on the larger is the same cost either way.
  const [small, large] =
    a.nodes.size <= b.nodes.size ? [a.nodes, b.nodes] : [b.nodes, a.nodes];
  let shared = 0;
  for (const id of small.keys()) if (large.has(id)) shared += 1;
  return shared;
}

/**
 * True when `after` came from a different document than `before` — every node
 * id reallocated. See the module docstring for why this beats a URL check.
 *
 * An empty checkpoint is excluded: zero shared ids is trivially true when one
 * side has no nodes, and "nothing was captured" is not evidence of navigation.
 */
export function documentWasReplaced(
  before: ExtractionResult,
  after: ExtractionResult,
): boolean {
  if (before.nodes.size === 0 || after.nodes.size === 0) return false;
  return sharedIdCount(before, after) === 0;
}

/** The node focused in `tree` — the serializer renders the focus move from it. */
function focusNode(tree: ExtractionResult) {
  return tree.focusedId ? (tree.nodes.get(tree.focusedId) ?? null) : null;
}

/**
 * Diff a live native tree against a checkpoint. Pure — the caller supplies both
 * trees and the current URL, so this is unit-testable with no browser.
 */
export function diffNativeCheckpoint(
  checkpoint: NativeCheckpoint,
  after: ExtractionResult,
  afterUrl: string,
): NativeCheckpointDiff {
  if (documentWasReplaced(checkpoint.tree, after)) {
    return { kind: "replaced", from: checkpoint.url, to: afterUrl };
  }
  const rendered = serializeTreeDiff(diffTrees(checkpoint.tree, after), {
    focusBefore: focusNode(checkpoint.tree),
    focusAfter: focusNode(after),
  });
  // Match the serializer's literal sentinel rather than re-deriving "did
  // anything change" from the diff object. If the sentinel ever changes, the
  // terse text shows through instead of this wrongly reporting no changes — and
  // a focus-only move renders a line while `diffTrees` reports nothing added,
  // removed, or changed, so re-deriving would call that "no changes" today.
  return { kind: "diff", rendered, changed: rendered !== EMPTY_DIFF };
}
