import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";

import { extract } from "@real-a11y-dev/serialize";

/** A point-in-time snapshot of the a11y tree — the input to `a11yDiff`. */
export interface A11yCapture {
  /** The extracted tree at capture time. */
  tree: ExtractionResult;
  /**
   * The node focused at capture time, resolved from `tree.focusedId` — or
   * `null` when nothing inside the root was focused. Distinct from a plain
   * `ExtractionResult`, which carries no focus context: a diff renders a
   * `focus:` transition only when BOTH sides were `capture()`d.
   */
  focus: SemanticNode | null;
}

/**
 * Capture the a11y tree AND the focused node in one call — the "before" (and,
 * commonly, "after") of an interaction diff. Extract at the start, interact,
 * then diff against a fresh capture:
 *
 * ```ts
 * const before = capture(container);
 * await userEvent.click(screen.getByRole("button", { name: "Open" }));
 * expect(a11yDiff(before, container)).toMatchInlineSnapshot();
 * ```
 *
 * Capturing "before" up front is the whole point — extracting it at assert time
 * would diff the tree against itself.
 */
export function capture(root: Element): A11yCapture {
  const tree = extract(root, "a11y");
  const focus =
    tree.focusedId != null ? (tree.nodes.get(tree.focusedId) ?? null) : null;
  return { tree, focus };
}
